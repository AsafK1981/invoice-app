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
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { useBusiness } from "@/lib/business-store";
import { BusinessFormModal } from "@/components/business-form-modal";
import { EmailSettingsModal } from "@/components/email-settings-modal";
import { supabase } from "@/lib/supabase";
import { getBusinessId } from "@/lib/business-init";

const businessTypeLabels = {
  exempt: "עוסק פטור",
  authorized: "עוסק מורשה",
  company: "חברה בע״מ",
};

export default function SettingsPage() {
  const { business } = useBusiness();
  const [editOpen, setEditOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const fields = [
    { icon: Building2, label: "שם העסק", value: business.name },
    { icon: FileText, label: "סוג עוסק", value: businessTypeLabels[business.businessType] },
    { icon: CreditCard, label: "מספר עוסק / ח.פ", value: business.taxId },
    { icon: MapPin, label: "כתובת", value: business.address },
    { icon: Phone, label: "טלפון", value: business.phone || "—" },
    { icon: Mail, label: "אימייל", value: business.email || "—" },
  ];

  async function clearAllData() {
    const ok = confirm(
      "זה ימחק את כל הנתונים (לקוחות, מוצרים, הוצאות, מסמכים). להמשיך?"
    );
    if (!ok) return;
    const bid = getBusinessId();
    if (!bid) return;

    const { data: docIds } = await supabase.from("documents").select("id").eq("business_id", bid);
    if (docIds && docIds.length > 0) {
      await supabase.from("document_items").delete().in("document_id", docIds.map(d => d.id));
    }
    await supabase.from("documents").delete().eq("business_id", bid);
    await supabase.from("expenses").delete().eq("business_id", bid);
    await supabase.from("clients").delete().eq("business_id", bid);
    await supabase.from("products").delete().eq("business_id", bid);
    await supabase.from("document_counters").delete().eq("business_id", bid);

    window.dispatchEvent(new Event("invoice-app:clients-changed"));
    window.dispatchEvent(new Event("invoice-app:products-changed"));
    window.dispatchEvent(new Event("invoice-app:expenses-changed"));
    window.dispatchEvent(new Event("invoice-app:documents-changed"));
    alert("כל הנתונים נמחקו. עכשיו אתה יכול להוסיף את הנתונים האמיתיים שלך.");
  }

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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-orange-700 hover:bg-orange-50"
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
                <span className="text-sm font-semibold text-stone-900 flex-1">{f.value}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card-soft p-6">
        <div className="flex items-center justify-between pb-4 border-b border-orange-100 mb-4">
          <h2 className="font-semibold text-stone-900 flex items-center gap-2">
            <Mail className="w-4 h-4 text-orange-500" />
            הגדרות אימייל
          </h2>
          <button
            onClick={() => setEmailOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-orange-700 hover:bg-orange-50"
          >
            <Pencil className="w-3.5 h-3.5" />
            הגדר
          </button>
        </div>
        <p className="text-sm text-stone-700">
          חבר את חשבון ה-Gmail שלך כדי שמסמכים יישלחו ישירות ממך ולא מכתובת ניטרלית של המערכת.
        </p>
      </div>

      <div className="card-soft p-4 bg-gradient-to-br from-orange-50 to-amber-50 border-orange-200">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
            <Info className="w-4 h-4 text-orange-500" />
          </div>
          <div className="text-sm text-stone-800">
            <strong className="block mb-1 text-stone-900">בהמשך:</strong>
            התקנת תעודת חתימה דיגיטלית, וחיבור API של חשבונית ישראל (למעבר לעוסק מורשה).
          </div>
        </div>
      </div>

      <div className="card-soft p-5 border-rose-200 bg-rose-50/40">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-stone-900">מחיקת כל הנתונים</h3>
            <p className="text-sm text-stone-700 mt-1">
              פעולה זו תמחק את כל הלקוחות, המוצרים, המסמכים וההוצאות לצמיתות. השתמש בזהירות.
            </p>
            <button
              onClick={clearAllData}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-rose-200 text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="w-4 h-4" />
              מחק את כל הנתונים
            </button>
          </div>
        </div>
      </div>

      <BusinessFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        business={business}
      />

      <EmailSettingsModal open={emailOpen} onClose={() => setEmailOpen(false)} />
    </div>
  );
}
