"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type Period, type PeriodMode, PERIOD_MODE_LABELS,
  periodMode, periodStepLabel, shiftPeriod, switchMode, rangeBounds, makeRange,
} from "@/lib/report-period";

const MODES: PeriodMode[] = ["month", "bimonth", "quarter", "year", "range", "all"];

/**
 * The one period control every list / report page shares (reports since
 * 2026-08-18, expenses since 2026-09-01): a segmented pill of granularities
 * (חודש / חודשיים / רבעון / שנה / טווח / הכל) next to a prev/next stepper.
 * חודשיים is the VAT bimonthly window (ינו-פבר, מרץ-אפר, ...), added
 * 2026-09-03 because most of the returns people file are bimonthly. Picking
 * טווח turns the stepper's label into two date fields, so a free range is
 * a first-class option that is always visible - never an entry hidden at
 * the bottom of a month dropdown. Styles: `.rpt-modes` / `.rpt-stepper` /
 * `.rpt-range` in app-skin.css; wrap it in `.rpt-controls`.
 */
export function PeriodPicker({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const mode = periodMode(period);
  const bounds = rangeBounds(period);
  return (
    <>
      <div className="dash-range rpt-modes" role="group" aria-label="סוג תקופה">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(switchMode(period, m))}
            aria-pressed={mode === m}
            className={`dash-range-btn${mode === m ? " is-active" : ""}`}
          >
            {PERIOD_MODE_LABELS[m]}
          </button>
        ))}
      </div>
      {bounds ? (
        /* Free range: the two dates sit where the stepper's label does,
           and the arrows slide the whole window by its own length. */
        <div className="rpt-stepper rpt-range" role="group" aria-label="בחירת טווח תאריכים">
          <button type="button" onClick={() => onChange(shiftPeriod(period, -1))} aria-label="טווח קודם באותו אורך">
            <ChevronRight aria-hidden="true" />
          </button>
          <input
            type="date"
            value={bounds.start}
            max={bounds.end}
            aria-label="מתאריך"
            dir="ltr"
            onChange={(e) => e.target.value && onChange(makeRange(e.target.value, bounds.end))}
          />
          <span aria-hidden="true">-</span>
          <input
            type="date"
            value={bounds.end}
            min={bounds.start}
            aria-label="עד תאריך"
            dir="ltr"
            onChange={(e) => e.target.value && onChange(makeRange(bounds.start, e.target.value))}
          />
          <button type="button" onClick={() => onChange(shiftPeriod(period, 1))} aria-label="טווח הבא באותו אורך">
            <ChevronLeft aria-hidden="true" />
          </button>
        </div>
      ) : mode !== "all" && (
        <div className="rpt-stepper" role="group" aria-label="בחירת תקופה">
          <button type="button" onClick={() => onChange(shiftPeriod(period, -1))} aria-label="תקופה קודמת">
            <ChevronRight aria-hidden="true" />
          </button>
          <b>{periodStepLabel(period)}</b>
          <button type="button" onClick={() => onChange(shiftPeriod(period, 1))} aria-label="תקופה הבאה">
            <ChevronLeft aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
