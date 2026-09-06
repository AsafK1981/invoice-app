"use client";

import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  FolderOpen,
  Users as UsersIcon,
  Package,
  FileText,
  Wallet,
  CheckCircle2,
  AlertCircle,
  X,
  HelpCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { clientStore } from "@/lib/client-store";
import { productStore } from "@/lib/product-store";
import { expenseStore } from "@/lib/expense-store";
import { getBusinessId } from "@/lib/business-init";
import { todayInIsrael } from "@/lib/date";
import { mapHeaders, isDocumentsHeaderSet } from "@/lib/import-headers";
import {
  mapDocumentRow,
  createSkipAccumulator,
  type SkipAccumulator,
  type SkipSummaryEntry,
} from "@/lib/import-documents";
import { parseAmount } from "@/lib/import-mapping";
import { parseCsvFile } from "@/lib/import-decode";
import { looksLikeUniformStructure, parseUniformStructureFile } from "@/lib/uniform-structure/parse";
import { analyzeRows, type AnalyzeResult } from "@/lib/import-analyze";
import { ImportAnalysisPanel } from "@/components/import-analysis-panel";
import type { Client, Product, Expense } from "@/lib/types";

/**
 * One-click bulk import. The user drops multiple CSV files OR a
 * single multi-sheet Excel (.xlsx) file. Each file/sheet is
 * inspected for its header columns to auto-detect what kind of
 * data it contains (clients / products / expenses / documents).
 * One button imports all of them in sequence into the calling
 * user's business.
 *
 * The detection + per-row builders mirror the logic in
 * csv-import-modal.tsx so behavior is identical to the per-entity
 * import flow.
 */

type EntityType = "clients" | "products" | "expenses" | "documents";
type ParsedRow = Record<string, string>;

interface EntityTotals {
  imported: number;
  skipped: number;
  unmappedType: number;
  /** Per-reason labelled skip breakdown (documents only; empty otherwise). */
  skipSummary: SkipSummaryEntry[];
}

interface DetectedFile {
  /** Display name shown to the user: could be the file name or "<file>: <sheet>" for xlsx sheets */
  label: string;
  entity: EntityType | null;
  rows: ParsedRow[];
  /** Original headers, for the "unknown type" fallback message */
  headers: string[];
}

const ENTITY_META: Record<EntityType, { label: string; icon: typeof UsersIcon; color: string }> = {
  clients: { label: "לקוחות", icon: UsersIcon, color: "from-blue-400 to-indigo-500" },
  products: { label: "מוצרים", icon: Package, color: "from-amber-400 to-orange-500" },
  expenses: { label: "הוצאות", icon: Wallet, color: "from-rose-400 to-pink-500" },
  documents: { label: "מסמכים", icon: FileText, color: "from-emerald-400 to-teal-500" },
};

/**
 * Look at the column headers and decide what entity this sheet/file is.
 * Documents are tried first (most specific schema), then expenses, then
 * products, then clients (most generic, just needs a name + identifier).
 */
function detectEntity(headers: string[]): EntityType | null {
  const set = new Set(headers.map((h) => h.toLowerCase().trim()));
  const has = (...keys: string[]) => keys.some((k) => set.has(k.toLowerCase()));

  // Documents: must have a number + a client + a total. Uses the shared
  // cross-vendor header-alias layer so a Morning / iCount / Rivhit /
  // Hashavshevet export (ספרור / שם חשבון / סה"כ / Document Number …) is
  // detected, not just the Invoice4U short keys.
  if (isDocumentsHeaderSet(headers)) {
    return "documents";
  }
  // Expenses: supplier + amount
  if (has("ספק", "supplier") && has("סכום", "amount")) {
    return "expenses";
  }
  // Products: price column is a strong signal
  if (has("מחיר", "price") && has("שם", "name")) {
    return "products";
  }
  // Clients: name + at least one contact field
  if (has("שם", "name") && (has("ח.פ / ת.ז", "ח.פ", "ת.ז", "tax_id", "טלפון", "phone", "אימייל", "email", "כתובת", "address"))) {
    return "clients";
  }
  return null;
}

export function BulkImportZone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [detected, setDetected] = useState<DetectedFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<Record<EntityType, EntityTotals> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // True while a file is being dragged over the square. Drives the "you can
  // let go now" highlight; there was no drop handling at all before
  // 2026-08-25, so "גרור לכאן" made the browser open the file instead.
  const [dragging, setDragging] = useState(false);

  async function parseCsv(file: File): Promise<DetectedFile[]> {
    const { rows, headers } = await parseCsvFile(file);
    return [
      {
        label: file.name,
        entity: detectEntity(headers),
        rows,
        headers,
      },
    ];
  }

  async function parseXlsx(file: File): Promise<DetectedFile[]> {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const out: DetectedFile[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<ParsedRow>(sheet, { defval: "", raw: false });
      if (rows.length === 0) continue;
      const headers = Object.keys(rows[0]);
      out.push({
        label: `${file.name} → ${sheetName}`,
        entity: detectEntity(headers),
        rows: rows.map((r) => {
          // Convert all cell values to strings; matches the CSV path.
          const obj: ParsedRow = {};
          for (const k of Object.keys(r)) obj[k] = String(r[k] ?? "").trim();
          return obj;
        }),
        headers,
      });
    }
    return out;
  }

  // מבנה אחיד (OPENFORMAT) ZIP / BKMVDATA.TXT: for most Israeli vendors this
  // is the only export that holds EVERY document ever issued, so it is what
  // a switcher actually brings. One row per document, already in the same
  // column vocabulary as a CSV, and always the documents entity.
  async function parseUniform(file: File): Promise<DetectedFile[]> {
    const parsed = await parseUniformStructureFile(file);
    const note = parsed.cancelledCount ? `, מתוכם ${parsed.cancelledCount} מבוטלים` : "";
    return [
      {
        label: `${file.name} → מבנה אחיד (${parsed.docCount} מסמכים${note})`,
        entity: "documents",
        rows: parsed.rows,
        headers: parsed.headers,
      },
    ];
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    await ingest(Array.from(e.target.files || []));
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!dragging && !importing) setDragging(true);
  }
  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Children fire leave/enter pairs while the pointer crosses them; only a
    // real exit of the square should drop the highlight.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragging(false);
  }
  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (importing) return;
    await ingest(Array.from(e.dataTransfer.files || []));
  }

  async function ingest(files: File[]) {
    if (files.length === 0) return;
    setError(null);
    setResult(null);
    setProgress(null);
    const collected: DetectedFile[] = [];
    try {
      for (const file of files) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        const more =
          ext === "xlsx" || ext === "xls"
            ? await parseXlsx(file)
            : looksLikeUniformStructure(file.name)
              ? await parseUniform(file)
              : await parseCsv(file);
        collected.push(...more);
      }
      setDetected(collected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בקריאת הקבצים");
    }
  }

  function removeDetected(idx: number) {
    setDetected((arr) => arr.filter((_, i) => i !== idx));
  }

  function setDetectedType(idx: number, entity: EntityType | null) {
    setDetected((arr) => arr.map((d, i) => (i === idx ? { ...d, entity } : d)));
  }

  async function handleImportAll() {
    const usable = detected.filter((d) => d.entity !== null);
    if (usable.length === 0) return;
    setImporting(true);
    setError(null);
    const totals: Record<EntityType, EntityTotals> = {
      clients: { imported: 0, skipped: 0, unmappedType: 0, skipSummary: [] },
      products: { imported: 0, skipped: 0, unmappedType: 0, skipSummary: [] },
      expenses: { imported: 0, skipped: 0, unmappedType: 0, skipSummary: [] },
      documents: { imported: 0, skipped: 0, unmappedType: 0, skipSummary: [] },
    };
    // One shared accumulator for every document file's skip reasons, so the
    // final breakdown uses the canonical labels from import-documents.
    const docSkips = createSkipAccumulator();

    // Import in a sensible order: clients first (so docs can find them),
    // then products, expenses, finally documents.
    const ordered = [...usable].sort((a, b) => {
      const order: EntityType[] = ["clients", "products", "expenses", "documents"];
      return order.indexOf(a.entity!) - order.indexOf(b.entity!);
    });

    try {
      for (const file of ordered) {
        setProgress(`מייבא ${ENTITY_META[file.entity!].label} מ-${file.label}...`);
        const result = await importOneFile(file, docSkips);
        totals[file.entity!].imported += result.imported;
        totals[file.entity!].skipped += result.skipped;
        totals[file.entity!].unmappedType += result.unmappedType;
      }
      totals.documents.skipSummary = docSkips.toSkipSummary();
      setProgress(null);
      setResult(totals);
      setDetected([]);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בייבוא");
    } finally {
      setImporting(false);
    }
  }

  async function importOneFile(
    file: DetectedFile,
    docSkips: SkipAccumulator,
  ): Promise<{ imported: number; skipped: number; unmappedType: number }> {
    let imported = 0;
    let skipped = 0;
    // Rows whose document-type cell wasn't recognized: imported as receipt but
    // flagged so the count is surfaced (previously dropped on the floor here).
    let unmappedType = 0;
    const today = todayInIsrael();
    const businessId = getBusinessId();

    const pick = (row: ParsedRow, ...keys: string[]): string => {
      for (const k of keys) {
        const v = row[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return "";
    };

    if (file.entity === "clients") {
      for (const row of file.rows) {
        const name = pick(row, "שם", "name");
        if (!name) {
          skipped++;
          continue;
        }
        const client: Client = {
          id: crypto.randomUUID(),
          name,
          taxId: pick(row, "ח.פ / ת.ז", "ח.פ", "ת.ז", "tax_id") || undefined,
          address: pick(row, "כתובת", "address") || undefined,
          phone: pick(row, "טלפון", "phone") || undefined,
          email: pick(row, "אימייל", "email") || undefined,
          notes: pick(row, "הערות", "notes") || undefined,
          createdAt: todayInIsrael(),
        };
        await clientStore.save(client);
        imported++;
      }
    } else if (file.entity === "products") {
      for (const row of file.rows) {
        const name = pick(row, "שם", "name");
        const price = parseAmount(pick(row, "מחיר", "price"));
        if (!name || price == null) {
          skipped++;
          continue;
        }
        const product: Product = {
          id: crypto.randomUUID(),
          name,
          description: pick(row, "תיאור", "description") || undefined,
          price,
          unit: pick(row, "יחידה", "unit") || "יחידה",
        };
        await productStore.save(product);
        imported++;
      }
    } else if (file.entity === "expenses") {
      for (const row of file.rows) {
        const supplier = pick(row, "ספק", "supplier");
        const amount = parseAmount(pick(row, "סכום", "amount"));
        if (!supplier || amount == null || amount <= 0) {
          skipped++;
          continue;
        }
        const expense: Expense = {
          id: crypto.randomUUID(),
          date: pick(row, "תאריך", "date") || today,
          category: pick(row, "קטגוריה", "category") || "אחר",
          supplier,
          amount,
          description: pick(row, "תיאור", "description") || undefined,
        };
        await expenseStore.save(expense);
        imported++;
      }
    } else if (file.entity === "documents") {
      if (!businessId) {
        throw new Error("אין עסק פעיל, רענן את הדף ונסה שוב");
      }
      const clientCache = new Map<string, string>();
      const maxNumberByType = new Map<string, number>();
      // Resolve document columns once via the shared cross-vendor alias layer.
      const headersMap = mapHeaders(file.headers);

      for (const row of file.rows) {
        const mapped = mapDocumentRow(row, headersMap, today);
        if (!mapped.ok) {
          docSkips.add(mapped.skipReason);
          skipped++;
          continue;
        }
        const { record, typeMatched } = mapped;
        const { description, ...docFields } = record;
        const { type, number, client_name: clientName, subtotal } = record;
        if (!typeMatched) unmappedType++;

        // Find or create client (same pattern as csv-import-modal)
        let clientId: string | undefined = clientCache.get(clientName);
        if (!clientId) {
          const { data: existing } = await supabase
            .from("clients")
            .select("id")
            .eq("business_id", businessId)
            .ilike("name", clientName)
            .maybeSingle();
          if (existing) {
            clientId = existing.id;
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

        const docId = crypto.randomUUID();
        const { error: dErr } = await supabase.from("documents").insert({
          id: docId,
          business_id: businessId,
          client_id: clientId,
          ...docFields,
        });
        if (dErr) {
          skipped++;
          continue;
        }
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

      // Bump counters so live docs don't collide with imported numbers
      for (const [type, maxNum] of maxNumberByType) {
        const { data: counterRow } = await supabase
          .from("document_counters")
          .select("next_number")
          .eq("business_id", businessId)
          .eq("doc_type", type)
          .maybeSingle();
        const target = maxNum + 1;
        if (!counterRow) {
          await supabase.from("document_counters").insert({
            business_id: businessId,
            doc_type: type,
            next_number: target,
          });
        } else if (counterRow.next_number < target) {
          await supabase
            .from("document_counters")
            .update({ next_number: target })
            .eq("business_id", businessId)
            .eq("doc_type", type);
        }
      }
    }
    return { imported, skipped, unmappedType };
  }

  const usable = detected.filter((d) => d.entity !== null);
  const unknown = detected.filter((d) => d.entity === null);

  // Documents-only dry-run previews, keyed by the detected-file index. Computed
  // lazily here (rather than widening DetectedFile) so we don't re-run
  // analyzeRows on every render. Each equals its file's real import outcome.
  const analyses = useMemo(() => {
    const out: Record<number, AnalyzeResult> = {};
    detected.forEach((d, idx) => {
      if (d.entity === "documents") {
        out[idx] = analyzeRows(d.rows, mapHeaders(d.headers));
      }
    });
    return out;
  }, [detected]);

  return (
    <div className="space-y-4">
      {/* Drop zone: a square you can actually drop on (onDrop), plus an
          explicit button for people who never drag anything. Clicking
          anywhere in the square also opens the picker. */}
      <div
        role="button"
        tabIndex={0}
        aria-label="העלאת קבצים: גרור לכאן או לחץ לבחירה"
        onClick={() => !importing && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!importing) inputRef.current?.click();
          }
        }}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`rounded-3xl border-[3px] border-dashed px-6 py-10 sm:py-12 text-center cursor-pointer select-none transition-all duration-200 ${
          dragging
            ? "border-orange-500 bg-orange-100/80 shadow-xl shadow-orange-200/60 scale-[1.01]"
            : "border-orange-300 bg-gradient-to-br from-orange-50/70 to-amber-50/50 hover:border-orange-400 hover:bg-orange-50"
        } ${importing ? "opacity-60 cursor-wait" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls,.zip,.txt,text/csv,application/zip"
          multiple
          onChange={handleFiles}
          disabled={importing}
          className="hidden"
        />
        <div
          className={`w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center shadow-md mx-auto mb-4 transition-transform ${
            dragging ? "scale-110" : ""
          }`}
        >
          <Upload className="w-8 h-8 text-white" />
        </div>
        <p className="text-lg font-bold text-stone-900">
          {dragging ? "אפשר לשחרר!" : "גרור את הקבצים לתוך הריבוע הזה"}
        </p>
        <p className="text-sm text-stone-500 mt-2">או</p>
        <button
          type="button"
          disabled={importing}
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
          className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-l from-orange-500 to-orange-700 text-white shadow-md hover:shadow-lg hover:shadow-orange-200 transition-shadow disabled:opacity-60"
        >
          <FolderOpen className="w-4 h-4" />
          בחר קבצים מהמחשב
        </button>
        <p className="text-xs text-stone-600 mt-5 leading-relaxed">
          אפשר לבחור כמה קבצים בבת אחת: Excel, CSV, או ה-ZIP של &quot;מבנה אחיד&quot; מהתוכנה הישנה
        </p>
        <p className="text-xs text-stone-500 mt-1">
          המערכת מזהה לבד מה כל קובץ: לקוחות / מוצרים / הוצאות / מסמכים
        </p>
      </div>

      {error && (
        <div className="card-soft p-4 bg-rose-50 border-rose-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-700 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-rose-800">{error}</p>
        </div>
      )}

      {/* Detected files list */}
      {detected.length > 0 && (
        <div className="card-soft p-5 space-y-3">
          <h3 className="font-semibold text-stone-900">קבצים שזוהו</h3>
          <ul className="space-y-2">
            {detected.map((d, idx) => {
              const Meta = d.entity ? ENTITY_META[d.entity] : null;
              return (
                <li
                  key={idx}
                  className={`rounded-xl border p-3 flex items-center gap-3 ${
                    d.entity
                      ? "border-emerald-200 bg-emerald-50/40"
                      : "border-amber-200 bg-amber-50/40"
                  }`}
                >
                  {Meta ? (
                    <div
                      className={`w-9 h-9 rounded-xl bg-gradient-to-br ${Meta.color} flex items-center justify-center shadow-sm flex-shrink-0`}
                    >
                      <Meta.icon className="w-4 h-4 text-white" />
                    </div>
                  ) : (
                    <div className="w-9 h-9 rounded-xl bg-amber-200 flex items-center justify-center flex-shrink-0">
                      <HelpCircle className="w-4 h-4 text-amber-800" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-900 truncate">{d.label}</p>
                    <p className="text-xs text-stone-600 mt-0.5">
                      {d.entity ? (
                        <>
                          זוהה כ-<strong>{Meta!.label}</strong> · {d.rows.length} שורות
                        </>
                      ) : (
                        <>
                          לא זוהה אוטומטית ({d.rows.length} שורות), בחר ידנית:
                        </>
                      )}
                    </p>
                    {analyses[idx] && (
                      <div className="mt-2">
                        <ImportAnalysisPanel analysis={analyses[idx]} />
                      </div>
                    )}
                    {!d.entity && (
                      <div className="flex gap-1 mt-2">
                        {(Object.keys(ENTITY_META) as EntityType[]).map((e) => (
                          <button
                            key={e}
                            onClick={() => setDetectedType(idx, e)}
                            className="text-xs px-2 py-1 rounded-lg bg-white border border-amber-200 hover:bg-amber-100"
                          >
                            {ENTITY_META[e].label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => removeDetected(idx)}
                    aria-label="הסר"
                    className="text-stone-400 hover:text-stone-700 flex-shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </li>
              );
            })}
          </ul>

          {unknown.length > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
              {unknown.length} {unknown.length === 1 ? "קובץ" : "קבצים"} לא זוהה אוטומטית, בחר סוג
              ידנית או הסר.
            </p>
          )}

          {usable.length > 0 && (
            <button
              onClick={handleImportAll}
              disabled={importing}
              className="w-full btn-glow inline-flex items-center justify-center gap-2 bg-gradient-to-l from-orange-500 to-orange-700 text-white py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200/60 disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {importing
                ? progress || "מייבא..."
                : `ייבא את הכל (${usable.length} ${usable.length === 1 ? "קובץ" : "קבצים"})`}
            </button>
          )}
        </div>
      )}

      {/* Result panel */}
      {result && (
        <div className="card-soft p-5 bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200">
          <div className="flex items-center gap-2 text-emerald-700 font-semibold mb-3">
            <CheckCircle2 className="w-5 h-5" />
            הייבוא הסתיים בהצלחה
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(Object.keys(ENTITY_META) as EntityType[]).map((e) => {
              const Meta = ENTITY_META[e];
              const t = result[e];
              if (t.imported === 0 && t.skipped === 0) return null;
              return (
                <div key={e} className="rounded-xl bg-white p-3">
                  <div className="flex items-center gap-1.5 text-xs text-stone-600 mb-1">
                    <Meta.icon className="w-3.5 h-3.5" />
                    {Meta.label}
                  </div>
                  <p className="text-xl font-bold text-stone-900">{t.imported}</p>
                  {t.skipped > 0 && (
                    <p className="text-xs text-amber-700">+{t.skipped} דולגו</p>
                  )}
                  {t.skipSummary.map((s) => (
                    <p key={s.reason} className="text-[11px] text-amber-600">
                      {s.count} {s.label}
                    </p>
                  ))}
                  {t.unmappedType > 0 && (
                    <p className="text-xs text-amber-700">{t.unmappedType} סוג לא מזוהה (כקבלה)</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
