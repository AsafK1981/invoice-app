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
import { todayInIsrael } from "@/lib/date";
import { mapHeaders } from "@/lib/import-headers";
import {
  mapDocumentRow,
  createSkipAccumulator,
  createUnmappedTypeCollector,
} from "@/lib/import-documents";
import { parseCsvFile } from "@/lib/import-decode";
import type { Client, Product, Expense } from "@/lib/types";

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
    columns: ["שם", "ח.פ / ת.ז", "כתובת", "טלפון", "אימייל", "הערות"],
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

    try {
      let imported = 0;
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
      for (const row of preview) {
        if (entityType === "clients") {
          const name = (row["שם"] || row["name"] || "").trim();
          if (!name) continue;
          const client: Client = {
            id: crypto.randomUUID(),
            name,
            taxId: (row["ח.פ / ת.ז"] || row["ח.פ"] || row["tax_id"] || "").trim() || undefined,
            address: (row["כתובת"] || row["address"] || "").trim() || undefined,
            phone: (row["טלפון"] || row["phone"] || "").trim() || undefined,
            email: (row["אימייל"] || row["email"] || "").trim() || undefined,
            notes: (row["הערות"] || row["notes"] || "").trim() || undefined,
            createdAt: todayInIsrael(),
          };
          await clientStore.save(client);
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
          await productStore.save(product);
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
          await expenseStore.save(expense);
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

          // Skip duplicates: same business, same type, same number
          const { data: existing } = await supabase
            .from("documents")
            .select("id")
            .eq("business_id", businessId)
            .eq("type", type)
            .eq("number", number)
            .maybeSingle();
          if (existing) continue;

          // Find or create the client by name. Check the in-batch cache
          // first so two rows with the same client name don't create
          // duplicate client records.
          let clientId: string | null = clientCache.get(clientName) ?? null;
          if (!clientId) {
            const { data: matchClient } = await supabase
              .from("clients")
              .select("id")
              .eq("business_id", businessId)
              .eq("name", clientName)
              .maybeSingle();
            if (matchClient) {
              clientId = matchClient.id;
            } else {
              const newClient = {
                id: crypto.randomUUID(),
                business_id: businessId,
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
      // CRITICAL: after importing historical docs, bump document_counters
      // past the highest imported number per type. Without this, the next
      // create_document_atomic call would hand out a number we just imported,
      // creating a silent duplicate.
      if (entityType === "documents" && importBusinessId && maxNumberByType.size > 0) {
        for (const [type, maxNum] of maxNumberByType) {
          const { data: counterRow } = await supabase
            .from("document_counters")
            .select("next_number")
            .eq("business_id", importBusinessId)
            .eq("doc_type", type)
            .maybeSingle();
          const target = maxNum + 1;
          if (!counterRow) {
            await supabase.from("document_counters").insert({
              business_id: importBusinessId,
              doc_type: type,
              next_number: target,
            });
          } else if (counterRow.next_number < target) {
            await supabase
              .from("document_counters")
              .update({ next_number: target })
              .eq("business_id", importBusinessId)
              .eq("doc_type", type);
          }
        }
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
      setPreview([]);
      setHeaders([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTimeout(() => onClose(), 1500);
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
          <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-xl">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-start gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-xl">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{success}</span>
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
                      <th key={key} className="text-right px-3 py-2 font-semibold text-stone-700">
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
