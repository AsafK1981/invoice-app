"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import { Upload, Users, Package, Wallet, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { clientStore } from "@/lib/client-store";
import { productStore } from "@/lib/product-store";
import { expenseStore } from "@/lib/expense-store";
import { supabase } from "@/lib/supabase";
import { getBusinessId } from "@/lib/business-init";
import type { Client, Product, Expense, DocumentType } from "@/lib/types";

type EntityType = "clients" | "products" | "expenses" | "documents";

// Maps Hebrew (and English) document-type labels seen in invoice4u/Morning/etc.
// exports to our internal DocumentType. Anything we don't recognize falls
// through to "receipt" — historical imports usually skew that way.
function resolveDocumentType(raw: string): DocumentType {
  const t = raw.trim().toLowerCase();
  if (!t) return "receipt";
  if (t === "receipt" || t.includes("קבלה") && !t.includes("חשבונית")) return "receipt";
  if (t === "tax_invoice_receipt" || t.includes("חשבונית מס/קבלה") || t.includes("חשבונית מס קבלה")) return "tax_invoice_receipt";
  if (t === "tax_invoice" || t === "invoice" || (t.includes("חשבונית") && t.includes("מס"))) return "tax_invoice";
  if (t === "credit_note" || t.includes("זיכוי")) return "credit_note";
  if (t === "quote" || t.includes("חשבון עסקה") || t.includes("הצעת מחיר") || t.includes("הצעה")) return "quote";
  return "receipt";
}

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
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const config = labels[entityType];
  const Icon = config.icon;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccess(null);

    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          setError("שגיאה בקריאת הקובץ: " + results.errors[0].message);
          return;
        }
        setPreview(results.data);
      },
    });
  }

  async function handleImport() {
    if (preview.length === 0) return;
    setImporting(true);
    setError(null);
    setSuccess(null);

    try {
      let imported = 0;
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
            createdAt: new Date().toISOString().slice(0, 10),
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
            date: (row["תאריך"] || row["date"] || new Date().toISOString().slice(0, 10)).trim(),
            category: (row["קטגוריה"] || row["category"] || "אחר").trim(),
            supplier,
            amount,
            description: (row["תיאור"] || row["description"] || "").trim() || undefined,
          };
          await expenseStore.save(expense);
          imported++;
        } else if (entityType === "documents") {
          const businessId = getBusinessId();
          if (!businessId) {
            setError("אין עסק פעיל - רענן את הדף ונסה שוב");
            break;
          }
          const numberRaw = (row["מספר"] || row["number"] || "").trim();
          const clientName = (row["לקוח"] || row["client"] || row["client_name"] || "").trim();
          const totalRaw = (row["סכום"] || row["total"] || "0").replace(/[₪,\s]/g, "");
          const total = parseFloat(totalRaw);
          const number = parseInt(numberRaw, 10);
          if (!clientName || !Number.isFinite(number) || !Number.isFinite(total) || total <= 0) continue;

          const type = resolveDocumentType(row["סוג"] || row["type"] || "");
          const date = (row["תאריך"] || row["date"] || new Date().toISOString().slice(0, 10)).trim();
          const description = (row["תיאור"] || row["description"] || "").trim() || "שירות";
          const vat = parseFloat((row['מע"מ'] || row["מעמ"] || row["vat"] || "0").replace(/[₪,\s]/g, "")) || 0;
          const subtotal = total - vat;
          const statusRaw = (row["סטטוס"] || row["status"] || "").trim().toLowerCase();
          // Historical imports are usually paid receipts; default to "paid"
          // for receipts/tax_invoice_receipt and "sent" for everything else
          // unless explicitly given.
          let status: "draft" | "sent" | "paid" | "cancelled" = "paid";
          if (statusRaw === "draft" || statusRaw.includes("טיוטה")) status = "draft";
          else if (statusRaw === "sent" || statusRaw.includes("נשלח")) status = "sent";
          else if (statusRaw === "cancelled" || statusRaw.includes("בוטל")) status = "cancelled";
          else if (statusRaw === "paid" || statusRaw.includes("שולם")) status = "paid";
          else if (type === "quote") status = "sent";

          // Skip duplicates: same business, same type, same number
          const { data: existing } = await supabase
            .from("documents")
            .select("id")
            .eq("business_id", businessId)
            .eq("type", type)
            .eq("number", number)
            .maybeSingle();
          if (existing) continue;

          // Find or create the client by name
          let clientId: string | null = null;
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

          // Insert document directly (bypassing the atomic-numbering RPC so
          // we can preserve the original invoice4u/legacy number).
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
          imported++;
        }
      }
      setSuccess(`יובאו ${imported} רשומות בהצלחה`);
      setPreview([]);
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
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-orange-500 to-rose-500 text-white hover:shadow-md hover:shadow-orange-200 disabled:from-stone-300 disabled:to-stone-300 disabled:shadow-none"
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

        {preview.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-stone-700 mb-2">
              תצוגה מקדימה ({preview.length} רשומות):
            </p>
            <div className="max-h-60 overflow-y-auto rounded-xl border border-orange-100 bg-white">
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
