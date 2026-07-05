"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  Upload,
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
import type { Client, Product, Expense, DocumentType } from "@/lib/types";

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

interface DetectedFile {
  /** Display name shown to the user — could be the file name or "<file>: <sheet>" for xlsx sheets */
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
 * products, then clients (most generic — just needs a name + identifier).
 */
function detectEntity(headers: string[]): EntityType | null {
  const set = new Set(headers.map((h) => h.toLowerCase().trim()));
  const has = (...keys: string[]) => keys.some((k) => set.has(k.toLowerCase()));

  // Documents — must have a number + a client + a total
  if (has("מספר", "number") && has("לקוח", "client", "client_name") && has("סכום", "total")) {
    return "documents";
  }
  // Expenses — supplier + amount
  if (has("ספק", "supplier") && has("סכום", "amount")) {
    return "expenses";
  }
  // Products — price column is a strong signal
  if (has("מחיר", "price") && has("שם", "name")) {
    return "products";
  }
  // Clients — name + at least one contact field
  if (has("שם", "name") && (has("ח.פ / ת.ז", "ח.פ", "ת.ז", "tax_id", "טלפון", "phone", "אימייל", "email", "כתובת", "address"))) {
    return "clients";
  }
  return null;
}

function resolveDocumentType(raw: string): DocumentType {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return "receipt";
  if (t === "tax_invoice_receipt" || t.includes("חשבונית מס/קבלה") || t.includes("חשבונית מס קבלה")) return "tax_invoice_receipt";
  if (t === "credit_note" || t.includes("זיכוי")) return "credit_note";
  if (t === "quote" || t.includes("חשבון עסקה") || t.includes("הצעת מחיר") || t.includes("הצעה")) return "quote";
  if (t === "tax_invoice" || t === "invoice" || (t.includes("חשבונית") && t.includes("מס"))) return "tax_invoice";
  return "receipt";
}

export function BulkImportZone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [detected, setDetected] = useState<DetectedFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<Record<EntityType, { imported: number; skipped: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function parseCsv(file: File): Promise<DetectedFile[]> {
    return new Promise((resolve, reject) => {
      Papa.parse<ParsedRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const headers = results.meta.fields || [];
          resolve([
            {
              label: file.name,
              entity: detectEntity(headers),
              rows: results.data,
              headers,
            },
          ]);
        },
        error: (err) => reject(err),
      });
    });
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
          // Convert all cell values to strings — matches the CSV path.
          const obj: ParsedRow = {};
          for (const k of Object.keys(r)) obj[k] = String(r[k] ?? "").trim();
          return obj;
        }),
        headers,
      });
    }
    return out;
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setError(null);
    setResult(null);
    setProgress(null);
    const collected: DetectedFile[] = [];
    try {
      for (const file of files) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        const more = ext === "xlsx" || ext === "xls" ? await parseXlsx(file) : await parseCsv(file);
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
    const totals: Record<EntityType, { imported: number; skipped: number }> = {
      clients: { imported: 0, skipped: 0 },
      products: { imported: 0, skipped: 0 },
      expenses: { imported: 0, skipped: 0 },
      documents: { imported: 0, skipped: 0 },
    };

    // Import in a sensible order: clients first (so docs can find them),
    // then products, expenses, finally documents.
    const ordered = [...usable].sort((a, b) => {
      const order: EntityType[] = ["clients", "products", "expenses", "documents"];
      return order.indexOf(a.entity!) - order.indexOf(b.entity!);
    });

    try {
      for (const file of ordered) {
        setProgress(`מייבא ${ENTITY_META[file.entity!].label} מ-${file.label}...`);
        const result = await importOneFile(file);
        totals[file.entity!].imported += result.imported;
        totals[file.entity!].skipped += result.skipped;
      }
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
  ): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;
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
        const priceStr = pick(row, "מחיר", "price").replace(/[₪,\s]/g, "");
        const price = parseFloat(priceStr);
        if (!name || !Number.isFinite(price)) {
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
        const amountStr = pick(row, "סכום", "amount").replace(/[₪,\s]/g, "");
        const amount = parseFloat(amountStr);
        if (!supplier || !Number.isFinite(amount) || amount <= 0) {
          skipped++;
          continue;
        }
        const expense: Expense = {
          id: crypto.randomUUID(),
          date: pick(row, "תאריך", "date") || todayInIsrael(),
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
        throw new Error("אין עסק פעיל — רענן את הדף ונסה שוב");
      }
      const clientCache = new Map<string, string>();
      const maxNumberByType = new Map<string, number>();

      for (const row of file.rows) {
        const numberRaw = pick(row, "מספר", "number");
        const clientName = pick(row, "לקוח", "client", "client_name");
        const totalStr = pick(row, "סכום", "total").replace(/[₪,\s]/g, "");
        const total = parseFloat(totalStr);
        if (!/^\d+$/.test(numberRaw)) {
          skipped++;
          continue;
        }
        const number = parseInt(numberRaw, 10);
        if (!clientName || !Number.isFinite(total) || total <= 0) {
          skipped++;
          continue;
        }
        const type = resolveDocumentType(pick(row, "סוג", "type"));
        const date = pick(row, "תאריך", "date") || todayInIsrael();
        const description = pick(row, "תיאור", "description") || "שירות";
        const vatStr = pick(row, 'מע"מ', "מעמ", "vat").replace(/[₪,\s]/g, "");
        const vat = parseFloat(vatStr) || 0;
        if (vat > total) {
          skipped++;
          continue;
        }
        const subtotal = total - vat;
        const statusRaw = pick(row, "סטטוס", "status").toLowerCase();
        let status: "draft" | "sent" | "paid" | "cancelled" = "paid";
        if (statusRaw === "draft" || statusRaw.includes("טיוטה")) status = "draft";
        else if (statusRaw === "sent" || statusRaw.includes("נשלח")) status = "sent";
        else if (statusRaw === "cancelled" || statusRaw.includes("בוטל")) status = "cancelled";
        else if (type === "quote") status = "sent";

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
          type,
          number,
          date,
          client_id: clientId,
          client_name: clientName,
          status,
          subtotal,
          vat,
          total,
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
    return { imported, skipped };
  }

  const usable = detected.filter((d) => d.entity !== null);
  const unknown = detected.filter((d) => d.entity === null);

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <label className="block">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv"
          multiple
          onChange={handleFiles}
          disabled={importing}
          className="hidden"
        />
        <div className="card-soft border-2 border-dashed border-orange-300 bg-gradient-to-br from-orange-50/60 to-amber-50/40 p-8 text-center cursor-pointer hover:border-orange-400 transition-colors">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-md mx-auto mb-3">
            <Upload className="w-7 h-7 text-white" />
          </div>
          <p className="font-bold text-stone-900">גרור לכאן את כל הקבצים — או לחץ לבחירה</p>
          <p className="text-sm text-stone-700 mt-1">
            CSV של לקוחות / מוצרים / הוצאות / מסמכים, או קובץ Excel אחד עם כמה גיליונות
          </p>
          <p className="text-xs text-stone-500 mt-2">המערכת תזהה אוטומטית מה כל קובץ</p>
        </div>
      </label>

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
                          לא זוהה אוטומטית ({d.rows.length} שורות) — בחר ידנית:
                        </>
                      )}
                    </p>
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
              {unknown.length} {unknown.length === 1 ? "קובץ" : "קבצים"} לא זוהה אוטומטית — בחר סוג
              ידנית או הסר.
            </p>
          )}

          {usable.length > 0 && (
            <button
              onClick={handleImportAll}
              disabled={importing}
              className="w-full btn-glow inline-flex items-center justify-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200/60 disabled:opacity-50"
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
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
