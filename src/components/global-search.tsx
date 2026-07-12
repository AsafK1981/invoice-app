"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Building2, Package, ReceiptText, Wallet, Plus, BarChart3 } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useClients } from "@/lib/client-store";
import { useProducts } from "@/lib/product-store";
import { useExpenses } from "@/lib/expense-store";
import { formatCurrency, formatDate } from "@/lib/format";
import { matchDocument } from "@/lib/document-search";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";

interface Result {
  id: string;
  kind: "document" | "client" | "product" | "expense";
  title: string;
  subtitle?: string;
  meta?: string;
  href: string;
}

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const { documents } = useDocuments();
  const { items: clients } = useClients();
  const { items: products } = useProducts();
  const { items: expenses } = useExpenses();

  // Cmd+K / Ctrl+K to open search; "N" for new doc; Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
        return;
      }
      // "N" for new doc - only when not focused on an input/textarea/select and palette isn't open
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isInput = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
      if (!isInput && !open && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        router.push("/documents/new");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, router]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const docs: Result[] = documents
      .filter((d) => matchDocument(d, q))
      .slice(0, 6)
      .map((d) => ({
        id: `doc-${d.id}`,
        kind: "document",
        title: `#${d.number} · ${DOCUMENT_TYPE_LABELS[d.type]}`,
        subtitle: `${d.clientName}${d.subject ? ` · ${d.subject}` : ""}`,
        meta: `${formatDate(d.date)} · ${formatCurrency(d.total)}`,
        href: `/documents/${d.id}`,
      }));

    const cls: Result[] = clients
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.taxId?.includes(q) ?? false) ||
          (c.email?.toLowerCase().includes(q) ?? false) ||
          (c.phone?.includes(q) ?? false)
      )
      .slice(0, 6)
      .map((c) => ({
        id: `client-${c.id}`,
        kind: "client",
        title: c.name,
        subtitle: [c.taxId, c.email, c.phone].filter(Boolean).join(" · "),
        href: "/clients",
      }));

    const prods: Result[] = products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 5)
      .map((p) => ({
        id: `prod-${p.id}`,
        kind: "product",
        title: p.name,
        subtitle: p.description,
        meta: `${formatCurrency(p.price)} / ${p.unit}`,
        href: "/products",
      }));

    const exps: Result[] = expenses
      .filter(
        (e) =>
          e.supplier.toLowerCase().includes(q) ||
          (e.category?.toLowerCase().includes(q) ?? false) ||
          (e.description?.toLowerCase().includes(q) ?? false) ||
          String(e.amount).includes(q),
      )
      .slice(0, 5)
      .map((e) => ({
        id: `exp-${e.id}`,
        kind: "expense",
        title: `${e.supplier} · ${formatCurrency(e.amount)}`,
        subtitle: [e.category, e.description].filter(Boolean).join(" · "),
        meta: formatDate(e.date),
        href: "/expenses",
      }));

    return [...docs, ...cls, ...prods, ...exps];
  }, [query, documents, clients, products, expenses]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function selectResult(result: Result) {
    router.push(result.href);
    setOpen(false);
  }

  function goTo(href: string) {
    router.push(href);
    setOpen(false);
  }

  const quickActions = [
    { label: "מסמך חדש", icon: Plus, href: "/documents/new" },
    { label: "כל המסמכים", icon: ReceiptText, href: "/documents" },
    { label: "לקוחות", icon: Building2, href: "/clients" },
    { label: "דוחות", icon: BarChart3, href: "/reports" },
  ];

  const quickActionsRow = (
    <div className="mt-5 flex flex-wrap justify-center gap-2">
      {quickActions.map((a) => {
        const Icon = a.icon;
        return (
          <button
            key={a.href}
            onClick={() => goTo(a.href)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-orange-100 bg-white/60 text-sm text-stone-700 hover:bg-orange-50 hover:border-orange-200 hover:text-orange-700 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-200"
          >
            <Icon className="w-3.5 h-3.5" />
            {a.label}
          </button>
        );
      })}
    </div>
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault();
      selectResult(results[activeIndex]);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/70 border border-orange-100 hover:bg-white hover:border-orange-200 text-sm text-stone-600 transition-colors"
        aria-label="חיפוש"
        title="חיפוש"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">חיפוש</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
      <div
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm animate-fade-in"
        onClick={() => setOpen(false)}
      />
      <div className="card-soft relative w-full max-w-2xl overflow-hidden animate-scale-in">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-orange-100">
          <Search className="w-5 h-5 text-orange-500 flex-shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="חפש לפי מספר, לקוח, סכום, תיאור פריט..."
            className="flex-1 bg-transparent outline-none text-stone-900 placeholder:text-stone-400"
          />
          <button
            onClick={() => setOpen(false)}
            className="w-7 h-7 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 flex items-center justify-center"
            aria-label="סגור"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {!query.trim() && (
            <div className="px-5 py-10 text-center">
              <p className="text-base font-semibold text-stone-800">מה תרצה למצוא?</p>
              <p className="text-sm mt-1.5 text-stone-500">חפש לפי מספר מסמך, לקוח, סכום או תאריך</p>
              {quickActionsRow}
            </div>
          )}

          {query.trim() && results.length === 0 && (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-stone-600">
                לא נמצא כלום עבור &rsquo;{query}&rsquo;
              </p>
              <p className="text-xs mt-1.5 text-stone-400">אפשר לנסות חיפוש אחר, או לקפוץ ישר אל:</p>
              {quickActionsRow}
            </div>
          )}

          {results.length > 0 && (
            <div className="py-2">
              {results.map((r, idx) => {
                const Icon =
                  r.kind === "document"
                    ? ReceiptText
                    : r.kind === "client"
                    ? Building2
                    : r.kind === "expense"
                    ? Wallet
                    : Package;
                const iconBg =
                  r.kind === "document"
                    ? "bg-orange-100 text-orange-700"
                    : r.kind === "client"
                    ? "bg-rose-100 text-rose-700"
                    : r.kind === "expense"
                    ? "bg-pink-100 text-pink-700"
                    : "bg-amber-100 text-amber-700";
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={r.id}
                    onClick={() => selectResult(r)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full text-right px-5 py-3 flex items-center gap-3 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-200 ${
                      isActive ? "bg-orange-50" : "hover:bg-orange-50/50"
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-stone-900 truncate">{r.title}</p>
                      {r.subtitle && (
                        <p className="text-xs text-stone-600 truncate">{r.subtitle}</p>
                      )}
                    </div>
                    {r.meta && (
                      <p className="text-xs text-stone-500 flex-shrink-0">{r.meta}</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-orange-100 bg-orange-50/30 text-xs text-stone-400 flex items-center justify-between">
          <span>אפשר לנווט עם החיצים ו-Enter</span>
          {query.trim() && results.length > 0 && (
            <span className="hidden sm:inline">{results.length} תוצאות</span>
          )}
        </div>
      </div>
    </div>
  );
}
