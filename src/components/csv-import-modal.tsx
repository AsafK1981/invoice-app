"use client";

import { useMemo, useRef, useState } from "react";
import { Upload, Users, Package, Wallet, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ImportAnalysisPanel } from "@/components/import-analysis-panel";
import { analyzeRows } from "@/lib/import-analyze";
import { clientStore } from "@/lib/client-store";
import { productStore } from "@/lib/product-store";
import { expenseStore } from "@/lib/expense-store";
import { supabase } from "@/lib/supabase";
import { getBusinessId } from "@/lib/business-init";
import { bumpDocumentCounters } from "@/lib/document-counters";
import { todayInIsrael } from "@/lib/date";
import { mapHeaders } from "@/lib/import-headers";
import {
  mapDocumentRow,
  createSkipAccumulator,
  createUnmappedTypeCollector,
} from "@/lib/import-documents";
import { parseCsvFile } from "@/lib/import-decode";
import { mapImportedClientRow, unrecognizedTermsNote } from "@/lib/import-clients";
import type { Product, Expense } from "@/lib/types";

type EntityType = "clients" | "products" | "expenses" | "documents";

interface Props {
  open: boolean;
  onClose: () => void;
  entityType: EntityType;
}

interface ParsedRow {
  [key: string]: string;
}

const labels: Record<EntityType, { title: string; icon: typeof Users; columns: string[] }> = {
  clients: {
    title: "ייבוא לקוחות",
    icon: Users,
    columns: ["שם", "ח.פ / ת.ז", "כתובת", "טלפון", "אימייל", "הערות", "תנאי תשלום"],
  },
  products: {
    title: "ייבוא מוצרים",
    icon: Package,
    columns: ["שם", "תיאור", "מחיר", "יחידה"],
  },
  expenses: {
    title: "ייבוא הוצאות",
    icon: Wallet,
    columns: ["תאריך", "קטגוריה", "ספק", "סכום", "תיאור"],
  },
  documents: {
    title: "ייבוא מסמכים היסטוריים",
    icon: FileText,
    columns: ["סוג", "מספר", "תאריך", "לקוח", "תיאור", "סכום", 'מע"מ', "סטטוס"],
  },
};

export function CsvImportModal({ open, onClose, entityType }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ParsedRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [termsNote, setTermsNote] = useState<string | null>(null);

  const config = labels[entityType];
  const Icon = config.icon;

  // Documents-only dry-run preview. analyzeRows defers every decision to the
  // shared mapDocumentRow, so these numbers equal the real import outcome.
  const analysis = useMemo(
    () =>
      entityType === "documents" && preview.length > 0
        ? analyzeRows(preview, mapHeaders(headers))
        : null,
    [entityType, preview, headers],
  );

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccess(null);
    setTermsNote(null);

    try {
      const { rows, headers: parsedHeaders } = await parseCsvFile(file);
      setPreview(rows);
      setHeaders(parsedHeaders);
    } catch (err) {
      setError("שגיאה בקריאת הקובץ: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleImport() {
    if (preview.length === 0) return;
    setImporting(true);
    setError(null);
    setSuccess(null);
    setTermsNote(null);

    try {
      const importBatchId = crypto.randomUUID();
      let imported = 0;
      let termsUnrecognized = 0;
      const today = todayInIsrael();
      const skips = createSkipAccumulator();
      const unmappedTypes = createUnmappedTypeCollector();
      // Resolve document columns once via the shared cross-vendor header-alias
      // layer, so exports from any Israeli invoicing app map to the same fields.
      // Use the headers returned by parseCsvFile (they include columns that are
      // empty in the first data row, which Object.keys(preview[0]) would miss).
      const docHeadersMap = mapHeaders(headers);
      // Cache of clients we've already created in this batch; avoids
      // creating the same client twice when two rows share a name and
      // the supabase select hasn't seen the in-flight insert yet.
      const clientCache = new Map<string, string>();
      // Track the highest imported number per (type) so we can bump
      // document_counters once at the end. Without this, the next live
      // create_document_atomic would hand out a number that already
      // exists in the DB.
      const maxNumberByType = new Map<string, number>();
      let importBusinessId: string | null = null;
      if (entityType === "documents") {
        importBusinessId = getBusinessId();
        if (!importBusinessId) {
          setError("אין עסק פעיל - רענן את הדף ונסה שוב");
          setImporting(false);
          return;
        }
      }
      // The row loop is allowed to abort (a refused duplicate check now
      // throws), but documents are inserted one at a time, so by then some are
      // already in the database. Whatever was written still has to be covered
      // by the counter bump below - see the CRITICAL note there - so the error
      // is held and rethrown after it, not instead of it.
      let loopError: unknown = null;
      try {
      for (const row of preview) {
        if (entityType === "clients") {
          // Always a fresh id, so clientStore.save takes its INSERT path and
          // can never overwrite an existing client's columns.
          const mappedClient = mapImportedClientRow(row, {
            id: crypto.randomUUID(),
            createdAt: todayInIsrael(),
          });
          if (!mappedClient) continue;
          await clientStore.save(mappedClient.client, { importBatchId });
          if (mappedClient.termsUnrecognized) termsUnrecognized++;
          imported++;
        } else if (entityType === "products") {
          const name = (row["שם"] || row["name"] || "").trim();
          const price = parseFloat(row["מחיר"] || row["price"] || "0");
          if (!name || isNaN(price)) continue;
          const product: Product = {
            id: crypto.randomUUID(),
            name,
            description: (row["תיאור"] || row["description"] || "").trim() || undefined,
            price,
            unit: (row["יחידה"] || row["unit"] || "יחידה").trim(),
          };
          await productStore.save(product, { importBatchId });
          imported++;
        } else if (entityType === "expenses") {
          const supplier = (row["ספק"] || row["supplier"] || "").trim();
          const amount = parseFloat(row["סכום"] || row["amount"] || "0");
          if (!supplier || isNaN(amount) || amount <= 0) continue;
          const expense: Expense = {
            id: crypto.randomUUID(),
            date: (row["תאריך"] || row["date"] || todayInIsrael()).trim(),
            category: (row["קטגוריה"] || row["category"] || "אחר").trim(),
            supplier,
            amount,
            description: (row["תיאור"] || row["description"] || "").trim() || undefined,
          };
          await expenseStore.save(expense, { importBatchId });
          imported++;
        } else if (entityType === "documents") {
          const businessId = importBusinessId!;
          const mapped = mapDocumentRow(row, docHeadersMap, today);
          if (!mapped.ok) {
            skips.add(mapped.skipReason);
            continue;
          }
          const { record, typeMatched } = mapped;
          const { description, ...docFields } = record;
          const { type, number, client_name: clientName, subtotal } = record;
          if (!typeMatched) unmappedTypes.add(mapped.typeRaw);

          // Skip duplicates: same business, same type, same number.
          // The error is checked, not dropped: an empty result from a refused
          // read is indistinguishable from "no such document", and treating it
          // as the latter imports the same tax document twice. Better to stop
          // the import with a message than to duplicate silently.
          const { data: existing, error: dupError } = await supabase
            .from("documents")
            .select("id")
            .eq("business_id", businessId)
            .eq("type", type)
            .eq("number", number)
            .maybeSingle();
          if (dupError) {
            throw new Error(
              `לא הצלחנו לבדוק אם ${type} מספר ${number} כבר קיים, והייבוא נעצר כדי לא לכפול מסמכים. נסה שוב (${dupError.message})`,
            );
          }
          if (existing) continue;

          // Find or create the client by name. Check the in-batch cache
          // first so two rows with the same client name don't create
          // duplicate client records.
          let clientId: string | null = clientCache.get(clientName) ?? null;
          if (!clientId) {
            // limit(1), not maybeSingle: two clients may legitimately share a
            // name, and maybeSingle calls that an error - which would now abort
            // the whole import instead of just picking one.
            const { data: matchClients, error: matchError } = await supabase
              .from("clients")
              .select("id")
              .eq("business_id", businessId)
              .eq("name", clientName)
              .limit(1);
            // Same rule as the duplicate-document check above: a read that
            // failed is not proof the client is missing, and acting on it
            // splits one client's history across two records.
            if (matchError) {
              throw new Error(
                `לא הצלחנו לחפש את הלקוח "${clientName}", והייבוא נעצר כדי לא ליצור לקוח כפול. נסה שוב (${matchError.message})`,
              );
            }
            const matchClient = matchClients?.[0];
            if (matchClient) {
              clientId = matchClient.id;
            } else {
              const newClient = {
                id: crypto.randomUUID(),
                business_id: businessId,
                import_batch_id: importBatchId,
                name: clientName,
                created_at: new Date().toISOString(),
              };
              const { error: cErr } = await supabase.from("clients").insert(newClient);
              if (!cErr) clientId = newClient.id;
            }
            if (clientId) clientCache.set(clientName, clientId);
          }

          // Insert document directly (bypassing the atomic-numbering RPC so
          // we can preserve the original invoice4u/legacy number).
          const docId = crypto.randomUUID();
          const { error: dErr } = await supabase.from("documents").insert({
            id: docId,
            business_id: businessId,
            import_batch_id: importBatchId,
            client_id: clientId,
            ...docFields,
          });
          if (dErr) continue;

          // Single line item summarizing the row
          await supabase.from("document_items").insert({
            id: crypto.randomUUID(),
            document_id: docId,
            description,
            quantity: 1,
            unit_price: subtotal,
            total: subtotal,
            sort_order: 0,
          });
          maxNumberByType.set(type, Math.max(maxNumberByType.get(type) ?? 0, number));
          imported++;
        }
      }
      } catch (err) {
        loopError = err;
      }
      // CRITICAL: after importing historical docs, bump document_counters
      // past the highest imported number per type. Without this, the next
      // create_document_atomic call would hand out a number we just imported,
      // creating a silent duplicate. Runs even when the loop above aborted,
      // because the documents it managed to write are already committed.
      let bumpError: unknown = null;
      if (entityType === "documents" && importBusinessId && maxNumberByType.size > 0) {
        try {
          // Every type is attempted, and every failure is reported: one type
          // failing must not leave the others un-bumped.
          await bumpDocumentCounters(supabase, importBusinessId, maxNumberByType);
        } catch (err) {
          bumpError = err;
        }
      }
      if (loopError || bumpError) {
        throw new Error(
          [loopError, bumpError]
            .filter(Boolean)
            .map((e) => (e instanceof Error ? e.message : String(e)))
            .join(" · "),
        );
      }

      // Build the skip summary from the canonical per-reason labels so the
      // wording can never drift from the analyzer / other import paths.
      const skipNotes = skips.toSkipSummary().map((s) => `${s.count} ${s.label}`);
      const skipSuffix = skipNotes.length > 0 ? ` (דילוג על ${skipNotes.join(" · ")})` : "";
      // Rows whose document-type cell wasn't recognized are still imported (as
      // קבלה) rather than dropped; surface the count so the user can review.
      const typeWarn =
        unmappedTypes.count > 0 ? ` · ${unmappedTypes.count} עם סוג לא מזוהה (יובאו כקבלה)` : "";
      setSuccess(`יובאו ${imported} רשומות בהצלחה${skipSuffix}${typeWarn}`);
      const note = unrecognizedTermsNote(termsUnrecognized);
      setTermsNote(note);
      setPreview([]);
      setHeaders([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      // A warning stays on screen until the user closes the dialog; a clean
      // import closes itself as before.
      if (!note) setTimeout(() => onClose(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בייבוא");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={config.title}
      subtitle="העלה קובץ CSV לייבוא בכמות גדולה"
      icon={Icon}
      maxWidth="lg"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-stone-700 hover:bg-white"
          >
            סגור
          </button>
          <button
            onClick={handleImport}
            disabled={preview.length === 0 || importing}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-orange-500 to-orange-700 text-white hover:shadow-md hover:shadow-orange-200 disabled:from-stone-300 disabled:to-stone-300 disabled:shadow-none"
          >
            {importing ? "מייבא..." : `ייבא ${preview.length} רשומות`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-stone-700">
          <p className="font-semibold mb-2">עמודות נתמכות בקובץ CSV:</p>
          <p className="text-xs text-stone-600">{config.columns.join(" · ")}</p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold bg-white border-2 border-dashed border-orange-300 text-stone-800 hover:bg-orange-50"
        >
          <Upload className="w-4 h-4" />
          בחר קובץ CSV
        </button>

        {error && (
          <div role="alert" className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-xl">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div role="status" className="flex items-start gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-xl">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              {success}
              {termsNote && <span className="block mt-1 text-amber-800">{termsNote}</span>}
            </span>
          </div>
        )}

        {analysis && <ImportAnalysisPanel analysis={analysis} />}

        {preview.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-stone-700 mb-2">
              תצוגה מקדימה ({preview.length} רשומות):
            </p>
            <div className="max-h-60 overflow-auto rounded-xl border border-orange-100 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-orange-50 sticky top-0">
                  <tr>
                    {Object.keys(preview[0]).map((key) => (
                      <th scope="col" key={key} className="text-right px-3 py-2 font-semibold text-stone-700">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 10).map((row, idx) => (
                    <tr key={idx} className="border-t border-orange-50">
                      {Object.values(row).map((val, i) => (
                        <td key={i} className="px-3 py-2 text-stone-600 truncate max-w-[120px]">
                          {val}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.length > 10 && (
                <div className="text-xs text-stone-500 p-2 text-center">
                  ועוד {preview.length - 10} רשומות...
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
