"use client";

import { use, useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldQuestion, Upload } from "lucide-react";
import { formatDate } from "@/lib/format";
import { docDir, docStrings, toDocLang, type DocLang } from "@/lib/document-strings";

/**
 * Public signature check for one document. Two questions, in this order:
 *   1. What did the books record for this document (when it was signed, the
 *      certificate, the SHA-256), and does the stored file still verify.
 *   2. Optionally: is the PDF the visitor holds authentic - signed by this
 *      business and untouched since, and is it the recorded original.
 * Nothing here needs a login; the id is the same UUID the /view link uses,
 * and the page shows only what /view already shows (type, number, date,
 * business name) plus the signature facts.
 */

const STRINGS: Record<DocLang, Record<string, string>> = {
  he: {
    title: "אימות חתימה אלקטרונית",
    loading: "בודק...",
    notFound: "המסמך לא נמצא",
    unsigned: "למסמך זה לא נרשמה חתימה אלקטרונית. החתימה נוצרת בהפקת ה-PDF הראשונה, או שהמסמך אינו מסמך ממוחשב (תשלום במזומן ודומיו נשמרים בנייר).",
    signedAt: "נחתם בתאריך",
    algorithm: "אלגוריתם",
    fingerprint: "טביעת אצבע של האישור (SHA-256)",
    sha256: "SHA-256 של הקובץ החתום",
    storedOk: "הקובץ השמור בספרי העסק מאומת: החתימה תקינה והקובץ לא השתנה מאז החתימה.",
    storedBad: "הקובץ השמור אינו עובר אימות. פנו לעסק.",
    uploadTitle: "יש לכם את הקובץ? בדקו אותו",
    uploadBody: "בחרו את קובץ ה-PDF שקיבלתם. הבדיקה נעשית בשרת ואינה שומרת את הקובץ.",
    uploadButton: "בחירת קובץ PDF",
    checking: "בודק את הקובץ...",
    authentic: "הקובץ אותנטי: חתום על ידי העסק ולא שונה מאז החתימה.",
    original: "זהו הקובץ המקורי שנרשם בספרי העסק, בית אחר בית.",
    copySigned: "הקובץ חתום על ידי העסק אך אינו זהה לקובץ המקורי שנרשם (למשל העתק שהופק מאוחר יותר).",
    tampered: "אזהרה: הקובץ שונה לאחר החתימה או שהחתימה אינה תקינה.",
    otherSigner: "אזהרה: הקובץ חתום, אך לא על ידי האישור הרשום לעסק זה.",
    noSignature: "בקובץ שבחרתם אין חתימה אלקטרונית.",
    error: "הבדיקה נכשלה. נסו שוב.",
    legal: "חתימה אלקטרונית מאובטחת לפי חוק חתימה אלקטרונית, התשס\"א-2001, על מסמך ממוחשב לפי הוראות ניהול פנקסי חשבונות.",
  },
  en: {
    title: "Electronic signature verification",
    loading: "Checking...",
    notFound: "Document not found",
    unsigned: "No electronic signature is recorded for this document. The signature is created when the first PDF is produced, or the document is not a computerized document (cash-type payments are kept on paper).",
    signedAt: "Signed on",
    algorithm: "Algorithm",
    fingerprint: "Certificate fingerprint (SHA-256)",
    sha256: "SHA-256 of the signed file",
    storedOk: "The file kept in the business records verifies: the signature is valid and the file is unchanged since signing.",
    storedBad: "The stored file does not verify. Contact the business.",
    uploadTitle: "Have the file? Check it",
    uploadBody: "Choose the PDF you received. The check runs on the server and the file is not kept.",
    uploadButton: "Choose PDF file",
    checking: "Checking the file...",
    authentic: "The file is authentic: signed by the business and unchanged since signing.",
    original: "This is the original file recorded in the business books, byte for byte.",
    copySigned: "The file is signed by the business but is not identical to the recorded original (for example a copy produced later).",
    tampered: "Warning: the file was changed after signing, or the signature is invalid.",
    otherSigner: "Warning: the file is signed, but not with the certificate recorded for this business.",
    noSignature: "The file you chose carries no electronic signature.",
    error: "The check failed. Please try again.",
    legal: "Secured electronic signature under the Israeli Electronic Signature Law, 2001, on a computerized document under the Income Tax (Bookkeeping) Instructions.",
  },
};

interface VerifyInfo {
  document: { id: string; type: string; number: number; date: string; language: string; businessName: string };
  signature: { signedAt: string; sha256: string; certFingerprint: string; algorithm: string; isOriginal: boolean } | null;
  stored: { valid: boolean; reason: string | null; sha256Matches: boolean } | null;
}

interface UploadResult {
  signatureValid: boolean;
  reason: string | null;
  authentic: boolean;
  sameCertificate: boolean;
  isRecordedOriginal: boolean;
  signedAt: string | null;
  signerName: string | null;
}

function shortHex(hex: string): string {
  return hex.replace(/(.{4})/g, "$1 ").trim();
}

export default function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [info, setInfo] = useState<VerifyInfo | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);

  const language = toDocLang(info?.document.language);
  const t = STRINGS[language];
  const s = docStrings(language);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/verify/${id}`);
        if (res.status === 404) {
          if (!cancelled) setStatus("missing");
          return;
        }
        if (!res.ok) throw new Error("verify failed");
        const data = (await res.json()) as VerifyInfo;
        if (!cancelled) {
          setInfo(data);
          setStatus("ok");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    setUpload(null);
    setUploadError(false);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/verify/${id}`, { method: "POST", body: form });
      if (!res.ok) throw new Error("upload failed");
      const data = (await res.json()) as { upload: UploadResult };
      setUpload(data.upload);
    } catch {
      setUploadError(true);
    } finally {
      setUploading(false);
    }
  }

  const docLabel = info ? (s.documentTypes as Record<string, string>)[info.document.type] || info.document.type : "";

  return (
    <div className="min-h-screen bg-stone-50 py-10 px-4" dir={docDir(language)} lang={language}>
      <div className="max-w-xl mx-auto space-y-4">
        <h1 className="text-xl font-bold text-stone-900 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-orange-600" />
          {t.title}
        </h1>

        {status === "loading" && <p className="text-sm text-stone-500">{t.loading}</p>}
        {status === "missing" && <p className="text-sm text-stone-700">{t.notFound}</p>}
        {status === "error" && <p className="text-sm text-rose-700">{t.error}</p>}

        {status === "ok" && info && (
          <>
            <div className="bg-white rounded-2xl shadow-sm border border-orange-100 p-5 text-sm space-y-1">
              <div className="font-semibold text-stone-900">
                {docLabel} {info.document.number}
              </div>
              <div className="text-stone-600">{info.document.businessName}</div>
              <div className="text-stone-500 text-xs">{formatDate(info.document.date, language)}</div>
            </div>

            {info.signature ? (
              <div className="bg-white rounded-2xl shadow-sm border border-orange-100 p-5 text-sm space-y-3">
                <div className={`flex items-start gap-2 ${info.stored?.valid ? "text-emerald-700" : "text-rose-700"}`}>
                  {info.stored?.valid ? <ShieldCheck className="w-5 h-5 flex-shrink-0" /> : <ShieldAlert className="w-5 h-5 flex-shrink-0" />}
                  <span>{info.stored?.valid ? t.storedOk : t.storedBad}</span>
                </div>
                <dl className="grid grid-cols-1 gap-2 text-xs text-stone-600">
                  <div>
                    <dt className="font-semibold text-stone-800">{t.signedAt}</dt>
                    <dd>{new Date(info.signature.signedAt).toLocaleString(language === "he" ? "he-IL" : "en-GB")}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-stone-800">{t.algorithm}</dt>
                    <dd dir="ltr" className="font-mono">{info.signature.algorithm}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-stone-800">{t.fingerprint}</dt>
                    <dd dir="ltr" className="font-mono break-all">{shortHex(info.signature.certFingerprint)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-stone-800">{t.sha256}</dt>
                    <dd dir="ltr" className="font-mono break-all">{shortHex(info.signature.sha256)}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-orange-100 p-5 text-sm text-stone-700 flex items-start gap-2">
                <ShieldQuestion className="w-5 h-5 flex-shrink-0 text-stone-400" />
                <span>{t.unsigned}</span>
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-orange-100 p-5 text-sm space-y-3">
              <h2 className="font-semibold text-stone-900">{t.uploadTitle}</h2>
              <p className="text-xs text-stone-600">{t.uploadBody}</p>
              <label className="inline-flex items-center gap-2 bg-white border border-stone-300 text-stone-700 hover:bg-stone-100 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer">
                <Upload className="w-4 h-4" />
                {uploading ? t.checking : t.uploadButton}
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {uploadError && <p className="text-xs text-rose-700">{t.error}</p>}
              {upload && (
                <div className="space-y-1 text-xs">
                  {upload.reason === "no_signature" ? (
                    <p className="text-stone-700">{t.noSignature}</p>
                  ) : upload.authentic ? (
                    <>
                      <p className="text-emerald-700 font-semibold">{t.authentic}</p>
                      <p className="text-stone-600">{upload.isRecordedOriginal ? t.original : t.copySigned}</p>
                    </>
                  ) : upload.signatureValid && !upload.sameCertificate ? (
                    <p className="text-rose-700 font-semibold">{t.otherSigner}</p>
                  ) : (
                    <p className="text-rose-700 font-semibold">{t.tampered}</p>
                  )}
                </div>
              )}
            </div>

            <p className="text-[11px] text-stone-400 leading-relaxed">{t.legal}</p>
          </>
        )}
      </div>
    </div>
  );
}
