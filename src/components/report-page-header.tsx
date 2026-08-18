import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  /** Optional controls (period pickers, print) rendered at the inline-end. */
  actions?: ReactNode;
}

/**
 * The header every /reports/* sub-page wears: emerald tile + title on the
 * inline-start, "חזרה לדו״חות" on the inline-end. Same anatomy as the
 * existing tax-projection / invoices-period pages, extracted so the new
 * sub-pages that grew out of the reports overview do not each re-type it.
 */
export function ReportPageHeader({ icon: Icon, title, subtitle, actions }: Props) {
  return (
    <div className="flex items-start justify-between flex-wrap gap-3">
      <div>
        <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl fgrad fgrad-emerald flex items-center justify-center shadow-sm">
            <Icon className="w-5 h-5 text-white" />
          </span>
          {title}
        </h1>
        {subtitle && <p className="text-sm text-stone-700 mt-2 mr-14">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {actions}
        <Link
          href="/reports"
          className="inline-flex items-center gap-2 text-sm text-stone-700 hover:text-stone-900 min-h-[2.75rem]"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה לדו״חות
        </Link>
      </div>
    </div>
  );
}
