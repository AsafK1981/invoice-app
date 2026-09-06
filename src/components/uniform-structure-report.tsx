"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { APPENDIX_1_DOC_TYPES } from "@/lib/uniform-structure/builder";

/**
 * The two printouts רשות המסים requires next to every מבנה אחיד export
 * (הוראות להפקת קבצים במבנה אחיד 1.31):
 *
 *   section 2.6  - per document type of נספח 1: how many documents and
 *                  their money total, zeros for types the software does
 *                  not manage;
 *   section 5.4  - the "end of run" screen: business, success line, the
 *                  OPENFRMT path, the period, record counts per type, and
 *                  which software produced the file and when.
 *
 * Both are also part of the software-registry application, which is why
 * they exist as a proper printable sheet and not a toast.
 */

export interface UniformReportData {
  generatedAt: string;
  path: string;
  fromDate: string;
  toDate: string;
  taxYear: number;
  sample: boolean;
  counts: { total: number; c100: number; d110: number; d120: number; b100: number; b110: number; m100: number };
  /** [code, count, total] per נספח 1 type, in the appendix's order. */
  docTypes: [string, number, number][];
}

/** Parses the `X-Uniform-Report` header the export route sends with the ZIP. */
export function parseUniformReport(header: string | null): UniformReportData | null {
  if (!header) return null;
  try {
    const r = JSON.parse(header) as UniformReportData;
    if (!r || !r.counts || !Array.isArray(r.docTypes)) return null;
    return r;
  } catch {
    return null;
  }
}

const RECORD_LABELS: { key: keyof UniformReportData["counts"] | "a100" | "z900"; code: string; label: string }[] = [
  { key: "a100", code: "A100", label: "רשומת פתיחה" },
  { key: "b100", code: "B100", label: "תנועות בהנהלת חשבונות" },
  { key: "b110", code: "B110", label: "חשבון בהנהלת חשבונות" },
  { key: "c100", code: "C100", label: "כותרת מסמך" },
  { key: "d110", code: "D110", label: "פרטי מסמך" },
  { key: "d120", code: "D120", label: "פרטי קבלות" },
  { key: "m100", code: "M100", label: "פריטים במלאי" },
  { key: "z900", code: "Z900", label: "רשומת סיום" },
];

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ReportBody({
  report,
  businessName,
  taxId,
  softwareName,
  softwareVersion,
  registrationNumber,
}: {
  report: UniformReportData;
  businessName: string;
  taxId: string;
  softwareName: string;
  softwareVersion: string;
  registrationNumber: string;
}) {
  const labelByCode = new Map(APPENDIX_1_DOC_TYPES.map((t) => [t.code, t.label]));
  const recordRows = RECORD_LABELS.map((r) => ({
    ...r,
    count: r.key === "a100" || r.key === "z900" ? 1 : report.counts[r.key],
  })).filter((r) => r.count > 0);
  // Windows path, the way section 5.4 shows it. The ZIP carries the same
  // tree, so the folder the user unzips into matches this line.
  const winPath = `X:\\${report.path.replace(/\//g, "\\")}`;

  return (
    <div className="usr-body" dir="rtl">
      <section className="usr-block">
        <h2 className="usr-h2">הפקת קבצים במבנה אחיד עבור:</h2>
        <dl className="usr-dl">
          <dt>מספר עוסק מורשה:</dt><dd dir="ltr">{taxId}</dd>
          <dt>שם בית העסק:</dt><dd>{businessName}</dd>
          <dt>מלל קבוע:</dt><dd>ביצוע ממשק פתוח הסתיים בהצלחה.</dd>
          <dt>הנתונים נשמרו בנתיב הבא:</dt><dd dir="ltr" className="usr-mono">{winPath}</dd>
          <dt>טווח תאריכים:</dt>
          <dd>מתאריך {formatDate(report.fromDate)} ועד תאריך {formatDate(report.toDate)} (שנת המס {report.taxYear})</dd>
        </dl>
        <p className="usr-note">התו X מציין את הכונן שבו בחר המשתמש לשמירת הנתונים.</p>
      </section>

      <section className="usr-block">
        <h2 className="usr-h2">פירוט סך סוגי הרשומות שנוצרו בקובץ BKMVDATA.TXT:</h2>
        <table className="usr-table">
          <thead>
            <tr><th>קוד רשומה</th><th>תיאור רשומה</th><th className="usr-num">סך רשומות</th></tr>
          </thead>
          <tbody>
            {recordRows.map((r) => (
              <tr key={r.code}>
                <td dir="ltr" className="usr-mono">{r.code}</td>
                <td>{r.label}</td>
                <td className="usr-num">{r.count.toLocaleString("he-IL")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}>סה״כ רשומות בקובץ</td><td className="usr-num">{report.counts.total.toLocaleString("he-IL")}</td></tr>
          </tfoot>
        </table>
        <p className="usr-note">
          הנתונים הופקו באמצעות תוכנת {softwareName} מהדורה {softwareVersion}, מספר תעודת הרישום: {registrationNumber || "טרם הונפק"},
          בתאריך {formatDate(report.generatedAt)} בשעה {timeOf(report.generatedAt)}.
        </p>
      </section>

      <section className="usr-block">
        <h2 className="usr-h2">פלט לאימות נתונים (סעיף 2.6): מסמכים לפי סוג</h2>
        <table className="usr-table">
          <thead>
            <tr><th>מספר המסמך</th><th>סוג המסמך</th><th className="usr-num">סה״כ כמותי</th><th className="usr-num">סה״כ כספי (בש״ח)</th></tr>
          </thead>
          <tbody>
            {report.docTypes.map(([code, count, total]) => (
              <tr key={code} className={count === 0 ? "usr-zero" : undefined}>
                <td dir="ltr" className="usr-mono">{code}</td>
                <td>{labelByCode.get(code) ?? code}</td>
                <td className="usr-num">{count.toLocaleString("he-IL")}</td>
                <td className="usr-num">{count === 0 ? "0" : formatCurrency(total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="usr-note">סוגי מסמכים שאינם מנוהלים בתוכנה מופיעים עם אפס, כנדרש בסעיף 2.6.</p>
      </section>

      {report.sample && (
        <p className="usr-warn">קובץ דוגמה: הנתונים סינתטיים ונועדו לסימולטור של רשות המסים בלבד.</p>
      )}
    </div>
  );
}

export function UniformStructureReport({
  report,
  onClose,
  businessName,
  taxId,
  softwareName,
  softwareVersion,
  registrationNumber,
}: {
  report: UniformReportData | null;
  onClose: () => void;
  businessName: string;
  taxId: string;
  softwareName: string;
  softwareVersion: string;
  registrationNumber: string;
}) {
  useEffect(() => {
    if (!report) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [report, onClose]);

  if (!report || typeof document === "undefined") return null;

  const body = (
    <ReportBody
      report={report}
      businessName={businessName}
      taxId={taxId}
      softwareName={softwareName}
      softwareVersion={softwareVersion}
      registrationNumber={registrationNumber}
    />
  );

  return createPortal(
    <>
      {/* On screen: a dialog. */}
      <div className="usr-overlay no-print" role="presentation">
        <div className="usr-backdrop" onClick={onClose} />
        <div className="usr-panel" role="dialog" aria-modal="true" aria-labelledby="usr-title" dir="rtl">
          <header className="usr-head">
            <div>
              <h1 id="usr-title" className="usr-title">דוח הפקה - מבנה אחיד</h1>
              <p className="usr-sub">הפלטים הנלווים לקובץ (סעיפים 2.6 ו-5.4 להוראות). הקובץ עצמו כבר ירד למחשב.</p>
            </div>
            <div className="usr-actions">
              <button type="button" className="pgbtn" onClick={() => window.print()}>
                <Printer aria-hidden="true" />
                הדפסה / שמירה כ-PDF
              </button>
              <button type="button" className="usr-close" onClick={onClose} aria-label="סגירה">
                <X aria-hidden="true" />
              </button>
            </div>
          </header>
          <div className="usr-scroll">{body}</div>
        </div>
      </div>
      {/* On paper: the same report as a print sheet, and nothing else. */}
      <section className="print-sheet usr-print hidden print:block" aria-hidden="true" dir="rtl">
        <header className="usr-print-head">
          <div className="usr-print-biz">{businessName}</div>
          <h1 className="usr-print-title">דוח הפקה - קבצים במבנה אחיד (גרסה 1.31)</h1>
        </header>
        {body}
      </section>
    </>,
    document.body,
  );
}
