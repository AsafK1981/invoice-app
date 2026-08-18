import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Prev / next year links for the yearly report sub-pages. RTL: "previous" points right. */
export function YearStepper({ year, base }: { year: number; base: string }) {
  return (
    <span className="rpt-stepper" role="group" aria-label="בחירת שנה">
      <Link href={`${base}/${year - 1}`} aria-label={`שנת ${year - 1}`}>
        <ChevronRight aria-hidden="true" />
      </Link>
      <b>{year}</b>
      <Link href={`${base}/${year + 1}`} aria-label={`שנת ${year + 1}`}>
        <ChevronLeft aria-hidden="true" />
      </Link>
    </span>
  );
}
