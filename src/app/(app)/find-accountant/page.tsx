"use client";

import { useEffect, useMemo, useState } from "react";
import { Globe, Mail, MapPin, Phone, UserSearch } from "lucide-react";
import { PARTNER_ACCOUNTANTS, rankPartnerAccountants, type PartnerAccountant } from "@/lib/partner-accountants";
import { supabase } from "@/lib/supabase";

/**
 * /find-accountant - accountants who agreed to be listed (see
 * src/lib/partner-accountants.ts for the listing rules).
 *
 * Order: the accountant whose personal link (/from-accountant?ref=) brought
 * the most ACTIVE businesses (issued at least one document) comes first; ties
 * and no-data fall back to who joined earlier. The order comes from
 * /api/partner-accountants/referrals (signed-in only; slugs in rank order,
 * never counts); the list still renders in join order if that call fails.
 *
 * The sidebar item and the reports-page card only appear once the list has an
 * entry; until then this page is reachable by direct URL only and shows a calm
 * "coming soon" state. The (app) layout keeps it behind login.
 */
export default function FindAccountantPage() {
  const [order, setOrder] = useState<string[] | null>(null);
  useEffect(() => {
    if (PARTNER_ACCOUNTANTS.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch("/api/partner-accountants/referrals", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = (await res.json()) as { ok: boolean; order?: string[] };
        if (!cancelled && json.ok && Array.isArray(json.order)) setOrder(json.order);
      } catch {
        // Ranking is a nicety; the list renders in join order without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const list = useMemo(() => {
    if (!order) return rankPartnerAccountants(PARTNER_ACCOUNTANTS, {});
    const rank = new Map(order.map((slug, i) => [slug, i]));
    return [...PARTNER_ACCOUNTANTS].sort(
      (a, b) => (rank.get(a.slug) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.slug) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [order]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl fgrad fgrad-emerald flex items-center justify-center shadow-sm">
            <UserSearch className="w-5 h-5 text-white" />
          </span>
          רואי חשבון שעובדים עם חשבונית ידידותית
        </h1>
        <p className="text-sm text-stone-700 mt-2 mr-14">
          רואי חשבון שמכירים את המערכת ויכולים לקבל ממנה ישירות דוחות וקובץ מבנה אחיד.
        </p>
      </div>

      {list.length === 0 ? (
        <div className="card-soft p-8 sm:p-12 text-center max-w-3xl mx-auto bg-gradient-to-br from-orange-50/70 via-amber-50/40 to-rose-50/70 border-orange-100">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center shadow-xl mx-auto mb-5 ftile ftile-emerald">
            <UserSearch className="w-9 h-9" />
          </div>
          <h2 className="text-2xl font-bold text-stone-900">הרשימה בדרך</h2>
          <p className="text-sm text-stone-700 mt-2 leading-relaxed max-w-md mx-auto">
            אנחנו בונים עכשיו רשימה של רואי חשבון שמכירים את המערכת. בקרוב תמצאו אותם כאן.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => (
            <AccountantCard key={a.slug} a={a} />
          ))}
        </div>
      )}

      {list.length > 0 && (
        <p className="text-xs text-stone-600 max-w-3xl">
          הרשימה נועדה לעזור לכם למצוא רואה חשבון. ההתקשרות היא ישירות מולו, ואנחנו לא צד לשירות שלו.
        </p>
      )}
    </div>
  );
}

function AccountantCard({ a }: { a: PartnerAccountant }) {
  const linkCls =
    "inline-flex items-center gap-1.5 text-sm font-semibold text-orange-700 hover:text-orange-900";
  return (
    <article className="card-soft p-5 flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold text-stone-900">{a.name}</h2>
        {a.office && <p className="text-sm text-stone-700">{a.office}</p>}
        <p className="text-sm text-stone-600 flex items-center gap-1.5 mt-1">
          <MapPin className="w-4 h-4" aria-hidden="true" />
          {a.city}
        </p>
      </div>

      {a.serves.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="מי הם משרתים">
          {a.serves.map((s) => (
            <li
              key={s}
              className="inline-flex items-center rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-bold text-stone-700"
            >
              {s}
            </li>
          ))}
        </ul>
      )}

      {a.note && <p className="text-sm text-stone-700 leading-relaxed">{a.note}</p>}

      {(a.website || a.phone || a.email) && (
        <div className="flex flex-wrap gap-x-4 gap-y-2 mt-auto pt-2 border-t border-stone-100">
          {a.website && (
            <a href={a.website} target="_blank" rel="noopener noreferrer" className={linkCls}>
              <Globe className="w-4 h-4" aria-hidden="true" />
              לאתר
            </a>
          )}
          {a.phone && (
            <a href={`tel:${a.phone.replace(/[^\d+]/g, "")}`} className={linkCls}>
              <Phone className="w-4 h-4" aria-hidden="true" />
              <span dir="ltr">{a.phone}</span>
            </a>
          )}
          {a.email && (
            <a href={`mailto:${a.email}`} className={linkCls}>
              <Mail className="w-4 h-4" aria-hidden="true" />
              <span dir="ltr">{a.email}</span>
            </a>
          )}
        </div>
      )}
    </article>
  );
}
