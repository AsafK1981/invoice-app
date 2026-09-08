import Link from "next/link";
import type { ReportIssue } from "@/lib/invoice-report-preflight";

export function ReportPreflight({ issues, description }: { issues: ReportIssue[]; description: string }) {
  const errors = issues.filter((issue) => issue.level === "error").length;
  return <section aria-label="בדיקה לפני ייצוא" className="card-soft p-4 space-y-3 no-print">
    <h2 role="status" className="font-bold text-stone-900">{errors ? `נמצאו ${errors} שגיאות לתיקון לפני הייצוא` : issues.length ? "יש הערות לבדיקה לפני הייצוא" : "בדיקות הנתונים עברו"}</h2>
    <p className="text-sm text-stone-600 leading-relaxed">{description}</p>
    {errors > 0 && <p className="text-xs text-stone-600">מסמך שכבר הופק אינו ניתן לעריכת סכומים ותאריכים. אם השגיאה היא במסמך שהופק, יש לבדוק את דרך התיקון עם רואה החשבון או התמיכה.</p>}
    {issues.length > 0 && <ul className="space-y-2">{issues.map((issue, index) => <li key={`${issue.href}-${index}`} className={`rounded-xl border p-3 text-sm break-words ${issue.level === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      <p><strong>{issue.level === "error" ? "לתיקון: " : "לבדיקה: "}</strong>{issue.message}</p>
      {issue.href && <Link className="inline-flex min-h-[44px] items-center underline font-semibold" href={issue.href}>{issue.sourceLabel || "לפתיחת הפרטים"}</Link>}
    </li>)}</ul>}
  </section>;
}
