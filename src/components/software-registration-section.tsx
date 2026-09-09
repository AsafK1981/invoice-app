"use client";

import { BadgeCheck, ExternalLink } from "lucide-react";
import { UNIFORM_SOFTWARE } from "@/lib/uniform-structure/software";

/**
 * הוראות ניהול ספרים, תוספת 1 סעיף 6(ה): the software house hands every
 * customer a copy of its registry certificate. This card is that copy, in the
 * app, for every business: software name and version as registered, the
 * registry number once it exists, the certificate file once it exists, and
 * the public registry lookup so the customer can check for themselves.
 *
 * Until the certificate arrives it says so plainly (the number is "" in
 * UNIFORM_SOFTWARE and the 00000000 in every מבנה אחיד file agrees).
 *
 * Env, both optional and public:
 *   NEXT_PUBLIC_SOFTWARE_REGISTRY_CERT_URL   the certificate PDF/image
 */
const REGISTRY_LOOKUP_URL = "https://secapp.taxes.gov.il/mm-find-tochna/main/rashi";
const CERT_URL = process.env.NEXT_PUBLIC_SOFTWARE_REGISTRY_CERT_URL || "";

export function SoftwareRegistrationSection() {
  const registered = Boolean(UNIFORM_SOFTWARE.registrationNumber);
  return (
    <section id="software-registration" className="card-soft p-5 scroll-mt-6">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-2xl bg-stone-100 flex items-center justify-center shrink-0">
          <BadgeCheck className={`w-4 h-4 ${registered ? "text-emerald-600" : "text-stone-500"}`} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-stone-900">רישום התוכנה במרשם רשות המסים</h2>
          <p className="text-sm text-stone-700 mt-1 leading-relaxed">
            תוכנה לניהול מערכת חשבונות חייבת להיות רשומה במרשם התוכנות של רשות המסים
            (הוראות ניהול ספרים, סעיף 36 ונספח ה&apos;), וכל לקוח זכאי לעותק של תעודת הרישום.
          </p>
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-stone-500">שם התוכנה כפי שנרשם</dt>
              <dd className="font-medium text-stone-900" dir="ltr">{UNIFORM_SOFTWARE.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">גרסה</dt>
              <dd className="font-medium text-stone-900" dir="ltr">{UNIFORM_SOFTWARE.version}</dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">בית התוכנה</dt>
              <dd className="font-medium text-stone-900">
                {UNIFORM_SOFTWARE.vendorName} · ע.מ {UNIFORM_SOFTWARE.vendorTaxId}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">מספר רישום</dt>
              <dd className="font-medium text-stone-900" dir="ltr">
                {registered ? UNIFORM_SOFTWARE.registrationNumber : "בתהליך רישום"}
              </dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            {CERT_URL && (
              <a
                href={CERT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 bg-white border border-stone-300 text-stone-800 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-stone-50"
              >
                <BadgeCheck className="w-4 h-4" />
                תעודת הרישום (עותק ללקוח)
              </a>
            )}
            <a
              href={REGISTRY_LOOKUP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 text-sm text-stone-600 underline hover:text-stone-900 px-1 py-2"
            >
              <ExternalLink className="w-4 h-4" />
              בדיקה במרשם התוכנות של רשות המסים
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
