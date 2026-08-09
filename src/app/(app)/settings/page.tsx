"use client";

import { useState } from "react";
import {
  Settings as SettingsIcon,
  Building2,
  FileText,
  CreditCard,
  MapPin,
  Phone,
  Mail,
  Info,
  Pencil,
  AlertCircle,
  Hash,
  Landmark,
  MessageSquare,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { useBusiness } from "@/lib/business-store";
import { isPlaceholderBusinessName, isPlaceholderBusinessTaxId } from "@/lib/business-init";
import { BusinessFormModal } from "@/components/business-form-modal";
import { EmailSettingsModal } from "@/components/email-settings-modal";
import { DocumentNumberingSettings } from "@/components/document-numbering-settings";
import { AuditLogSection } from "@/components/audit-log-section";
import { TaxAuthoritySection } from "@/components/tax-authority-section";
import { DunningSettingsSection } from "@/components/dunning-settings-section";
import { TwoFactorSection } from "@/components/two-factor-section";
import { WhatsAppSection } from "@/components/whatsapp-section";
import { ALLOCATION_THRESHOLD_SCHEDULE, formatThreshold } from "@/lib/tax-authority";
import { DangerZoneSection } from "@/components/danger-zone-section";
import { BUSINESS_TYPE_LABELS } from "@/lib/types";

export default function SettingsPage() {
  const { business } = useBusiness();
  const [editOpen, setEditOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  // Detect legacy placeholder values that were stored as real data
  // ("העסק שלי" / "000000000" stuck around from the original auto-create).
  // Renders these as muted "[לא הוגדר]" hints instead of bold black text,
  // so the user understands they still need to fill in their real details.
  const namePlaceholder = isPlaceholderBusinessName(business.name);
  const taxIdPlaceholder = isPlaceholderBusinessTaxId(business.taxId);
  const addressEmpty = !business.address?.trim();

  const fields = [
    { icon: Building2, label: "שם העסק", value: business.name, placeholder: namePlaceholder },
    { icon: FileText, label: "סוג עוסק", value: BUSINESS_TYPE_LABELS[business.businessType], placeholder: false },
    { icon: CreditCard, label: "מספר עוסק / ח.פ", value: business.taxId, placeholder: taxIdPlaceholder },
    { icon: MapPin, label: "כתובת", value: business.address, placeholder: addressEmpty },
    { icon: Phone, label: "טלפון", value: business.phone, placeholder: !business.phone },
    { icon: Mail, label: "אימייל", value: business.email, placeholder: !business.email },
  ];

  const bankParts = [
    business.bankName,
    business.bankBranch ? `סניף ${business.bankBranch}` : null,
    business.bankAccount ? `חשבון ${business.bankAccount}` : null,
  ].filter(Boolean);
  const paymentFields = [
    {
      icon: Landmark,
      label: "העברה בנקאית",
      value: bankParts.length > 0 ? bankParts.join(" · ") : "-",
    },
    {
      icon: MessageSquare,
      label: "הערות תשלום",
      value: business.paymentNotes || "-",
    },
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-stone-400 to-stone-600 flex items-center justify-center shadow-sm">
            <SettingsIcon className="w-5 h-5 text-white" />
          </span>
          הגדרות
        </h1>
        <p className="text-sm text-stone-700 mt-2 mr-14">פרטי העסק שלך</p>
      </div>

      <div className="card-soft p-6">
        <div className="flex items-center justify-between pb-4 border-b border-orange-100 mb-4">
          <h2 className="font-semibold text-stone-900 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-orange-500" />
            פרטי העסק
          </h2>
          <button
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-xl text-sm font-semibold text-orange-700 hover:bg-orange-50"
          >
            <Pencil className="w-3.5 h-3.5" />
            עריכה
          </button>
        </div>
        <div className="space-y-3">
          {fields.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.label}
                className="flex items-center gap-3 py-2.5 border-b border-orange-50 last:border-0"
              >
                <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-orange-500" />
                </div>
                <span className="text-sm font-medium text-stone-700 w-40">{f.label}</span>
                {f.placeholder ? (
                  <span className="text-sm italic text-stone-400 flex-1">לא הוגדר</span>
                ) : (
                  <span className="text-sm font-semibold text-stone-900 flex-1">{f.value}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={`card-soft p-6 ${
          bankParts.length === 0 && !business.paymentNotes ? "border-rose-300 bg-rose-50/30" : ""
        }`}
      >
        <div className="flex items-center justify-between pb-4 border-b border-orange-100 mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-stone-900 flex items-center gap-2">
              <Landmark className="w-4 h-4 text-orange-500" />
              פרטי תשלום על מסמכים
            </h2>
            {bankParts.length === 0 && !business.paymentNotes && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full">
                <AlertCircle className="w-3 h-3" />
                חסר
              </span>
            )}
          </div>
          <button
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-xl text-sm font-semibold text-orange-700 hover:bg-orange-50"
          >
            <Pencil className="w-3.5 h-3.5" />
            {bankParts.length === 0 && !business.paymentNotes ? "מלא עכשיו" : "עריכה"}
          </button>
        </div>
        {bankParts.length === 0 && !business.paymentNotes ? (
          <p className="text-sm text-rose-900 mb-3 leading-relaxed">
            <strong>חשבונות עסקה וחשבוניות מס שתפיק יישלחו ללא בלוק תשלום</strong>, הלקוח לא יראה לאן להעביר את הכסף. הוסף לפחות פרט אחד (חשבון בנק, Bit, או הערת תשלום) כדי לתקן.
          </p>
        ) : (
          <p className="text-xs text-stone-600 mb-3">
            פרטי תשלום מוצגים על חשבונות עסקה וחשבוניות מס (לא על קבלות וזיכויים).
          </p>
        )}
        <div className="space-y-3">
          {paymentFields.map((f) => {
            const Icon = f.icon;
            const isEmpty = f.value === "-";
            return (
              <div
                key={f.label}
                className="flex items-center gap-3 py-2.5 border-b border-orange-50 last:border-0"
              >
                <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-orange-500" />
                </div>
                <span className="text-sm font-medium text-stone-700 w-40">{f.label}</span>
                <span className={`text-sm flex-1 ${isEmpty ? "text-stone-400 italic" : "font-semibold text-stone-900"}`}>
                  {f.value}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {(business.businessType === "authorized" || business.businessType === "company") && (
        <div className="card-soft p-6">
          <div className="flex items-center gap-2 pb-4 border-b border-orange-100 mb-4">
            <ShieldCheck className="w-4 h-4 text-orange-500" />
            <h2 className="font-semibold text-stone-900">חשבונית ישראל (רשות המסים)</h2>
          </div>
          <p className="text-sm text-stone-700 leading-relaxed">
            עוסק מורשה חייב במספר הקצאה (חשבונית ישראל) על חשבונית מס ללקוח עסקי מעל הסף שקבעה
            רשות המסים. על כל מסמך כזה המערכת מציגה את השלב הבא ואת הכפתור לקבלת המספר, ואינה
            מאפשרת לשלוח את המסמך ללקוח לפני שהמספר התקבל.
          </p>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
              <p className="font-semibold text-emerald-900 mb-1">✓ בקשה בלחיצה אחת</p>
              <p className="text-emerald-800 leading-relaxed">
                שומרים את המסמך, ובעמוד המסמך לוחצים על &quot;קבל מספר הקצאה מרשות המסים&quot;.
                המספר נשמר על המסמך ומודפס עליו. הבקשה אינה נשלחת מעצמה בשמירה.
              </p>
            </div>
            <div className="rounded-xl bg-stone-50 border border-stone-200 p-3">
              <p className="font-semibold text-stone-900 mb-1">הקלדה ידנית</p>
              <p className="text-stone-700 leading-relaxed">
                אם כבר קיבלת מספר הקצאה במקום אחר, אפשר להקליד אותו על המסמך והוא יודפס עליו
                בדיוק כמו מספר שהתקבל דרך המערכת.
              </p>
            </div>
            <div className="rounded-xl bg-stone-50 border border-stone-200 p-3">
              <p className="font-semibold text-stone-900 mb-1">סף חובת ההקצאה</p>
              <p className="text-stone-700 leading-relaxed">
                {ALLOCATION_THRESHOLD_SCHEDULE.map((s, i) => (
                  <span key={s.label}>
                    {i > 0 && " · "}
                    {s.label}: <span dir="ltr">{formatThreshold(s.amount)}</span>
                  </span>
                ))}
                . הסף נמדד על הסכום לפני מע״מ, ורשות המסים מורידה אותו בשלבים. (אין קשר לתקרת
                המחזור של עוסק פטור, זה סף לחובת מספר הקצאה.)
              </p>
            </div>
          </div>
          <a
            href="https://www.gov.il/he/pages/invoices-israel"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-700 hover:text-orange-900 underline"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            פורטל חשבונית ישראל
          </a>
        </div>
      )}

      <div className="card-soft p-6">
        <div className="flex items-center gap-2 pb-4 border-b border-orange-100 mb-4">
          <Hash className="w-4 h-4 text-orange-500" />
          <h2 className="font-semibold text-stone-900">מספור מסמכים</h2>
        </div>
        <DocumentNumberingSettings />
      </div>

      <div className="card-soft p-6">
        <div className="flex items-center justify-between pb-4 border-b border-orange-100 mb-4">
          <h2 className="font-semibold text-stone-900 flex items-center gap-2">
            <Mail className="w-4 h-4 text-orange-500" />
            הגדרות אימייל
          </h2>
          <button
            onClick={() => setEmailOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-xl text-sm font-semibold text-orange-700 hover:bg-orange-50"
          >
            <Pencil className="w-3.5 h-3.5" />
            הגדר
          </button>
        </div>
        <p className="text-sm text-stone-700">
          חבר את חשבון ה-Gmail שלך כדי שמסמכים יישלחו ישירות ממך ולא מכתובת ניטרלית של המערכת.
        </p>
      </div>

      <WhatsAppSection />

      <div id="tax-authority" className="scroll-mt-6">
        <TaxAuthoritySection />
      </div>

      <DunningSettingsSection />

      <TwoFactorSection />

      <AuditLogSection />

      <DangerZoneSection />

      <BusinessFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        business={business}
      />

      <EmailSettingsModal open={emailOpen} onClose={() => setEmailOpen(false)} />
    </div>
  );
}
