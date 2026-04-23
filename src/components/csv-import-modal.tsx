"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import { Upload, Users, Package, Wallet, AlertCircle, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { clientStore } from "@/lib/client-store";
import { productStore } from "@/lib/product-store";
import { expenseStore } from "@/lib/expense-store";
import type { Client, Product, Expense } from "@/lib/types";

type EntityType = "clients" | "products" | "expenses";

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
