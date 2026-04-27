"use client";

import Link from "next/link";
import { Building2, ArrowLeft } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { InvoiceDocument } from "@/lib/types";

interface Props {
  documents: InvoiceDocument[];
  limit?: number;
}

export function TopClients({ documents, limit = 5 }: Props) {
  const byClient = new Map<string, { name: string; total: number; count: number }>();

  documents
    .filter((d) => d.status === "paid")
    .forEach((d) => {
      const key = d.clientId || d.clientName;
      const existing = byClient.get(key);
      if (existing) {
        existing.total += d.total;
        existing.count += 1;
      } else {
        byClient.set(key, { name: d.clientName, total: d.total, count: 1 });
      }
    });

  const sorted = Array.from(byClient.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);

  const maxTotal = sorted[0]?.total || 1;

  if (sorted.length === 0) {
    return (
      <div className="text-center py-10 text-stone-500">
        <div className="text-3xl mb-2">👥</div>
        <p className="text-sm">אין הכנסות עדיין</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((client) => {
        const percentage = (client.total / maxTotal) * 100;
        return (
          <div key={client.name} className="group">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-200 to-rose-200 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-4 h-4 text-orange-700" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-stone-900 truncate">{client.name}</p>
                  <p className="text-xs text-stone-600">
                    {client.count} {client.count === 1 ? "מסמך" : "מסמכים"}
                  </p>
                </div>
              </div>
              <span className="text-sm font-bold text-stone-900 flex-shrink-0">
                {formatCurrency(client.total)}
              </span>
            </div>
            <div className="h-1.5 bg-orange-50 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-l from-orange-400 to-rose-400 rounded-full transition-all duration-500"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        );
      })}
      <Link
        href="/clients"
        className="inline-flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 font-medium pt-2 group"
      >
        לכל הלקוחות
        <ArrowLeft className="w-3 h-3 transition-transform group-hover:-translate-x-1" />
      </Link>
    </div>
  );
}
