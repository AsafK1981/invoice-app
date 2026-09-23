/**
 * The operator's business goal and the pace the app must keep to reach it.
 *
 * Asaf set the goal on 2026-09-23: 2,500 paying subscribers, which at the
 * blended list price (Basic ₪15 / Pro ₪25, see src/lib/plans.ts) is ₪50,000
 * gross a month. The /admin page shows it at the top, together with where
 * the app stands today and the next monthly milestone, so the number is in
 * his face every time he opens the panel.
 *
 * The path between today and the goal is a COMPOUND curve, not a straight
 * line. A subscription business grows on itself: word of mouth, SEO and
 * renewals all scale with the base, so early months are small and the last
 * year carries most of the climb. A straight line from zero would demand ~70
 * new paying customers next month, a number nobody could act on; the curve
 * asks for a dozen now and for hundreds a month in year three, which is what
 * actually happens when this works.
 *
 * Shape: expected(t) = goal * (r^(t/T) - 1) / (r - 1), where t/T is the share
 * of the runway elapsed and r = `steepness`. It starts at exactly 0 and ends
 * at exactly the goal, and the monthly increments grow r-fold from the first
 * month to the last. With r = 20 over three years: ~11 by the end of the
 * first month, ~225 after a year, ~840 after two, 2,500 at the deadline.
 *
 * Everything here is pure and date-driven so it can be unit-tested. To move
 * the goalposts, edit GOAL only.
 */

export const GOAL = {
  /** Paying subscribers at the finish line. */
  subscribers: 2500,
  /** Gross monthly income those subscribers represent, in ILS. */
  grossMonthlyIls: 50000,
  /** First day the path counts from. */
  startedOn: "2026-10-01",
  /** The day the path reaches `subscribers`. Three years from the start. */
  deadline: "2029-09-30",
  /**
   * How much faster the last month of the runway must add subscribers than
   * the first. 1 would be a straight line; 20 is a real but not brutal ramp.
   */
  steepness: 20,
} as const;

/** Blended gross income per paying subscriber a month, in ILS. */
export const GROSS_PER_SUBSCRIBER_ILS = GOAL.grossMonthlyIls / GOAL.subscribers;

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Calendar days between two ISO dates (b - a), ignoring the time of day. */
function daysBetween(aIso: string, bIso: string): number {
  return Math.round((utcDay(bIso) - utcDay(aIso)) / DAY_MS);
}

/** `Date` -> "YYYY-MM-DD" in the machine's local calendar. */
export function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** ISO date `days` calendar days after `iso`. */
function addDays(iso: string, days: number): string {
  return new Date(utcDay(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Last day of the month that `iso` falls in (plus `monthsAhead`), as "YYYY-MM-DD". */
export function endOfMonth(iso: string, monthsAhead = 0): string {
  const [y, m] = iso.split("-").map(Number);
  // Day 0 of the following month is the last day of the wanted month.
  return new Date(Date.UTC(y, m - 1 + monthsAhead + 1, 0)).toISOString().slice(0, 10);
}

/**
 * How many paying subscribers the path expects on `iso`: 0 on `startedOn`,
 * `subscribers` on `deadline`, the compound curve described above between,
 * clamped outside the runway. Whole subscribers, rounded half-up.
 */
export function goalPathOn(iso: string): number {
  const total = daysBetween(GOAL.startedOn, GOAL.deadline);
  const elapsed = daysBetween(GOAL.startedOn, iso);
  if (elapsed <= 0) return 0;
  if (elapsed >= total) return GOAL.subscribers;
  const r = GOAL.steepness;
  const share = (Math.pow(r, elapsed / total) - 1) / (r - 1);
  return Math.round(GOAL.subscribers * share);
}

/** A milestone closer than this is noise, not a target. */
const MIN_MILESTONE_DAYS = 14;

/**
 * The next monthly milestone: the end of the current month while at least
 * two weeks of it are left, otherwise the end of next month. "Reach 30 by
 * the day after tomorrow" is not something anyone can act on.
 */
export function nextMilestoneDate(todayIso: string): string {
  const thisMonthEnd = endOfMonth(todayIso);
  return daysBetween(todayIso, thisMonthEnd) >= MIN_MILESTONE_DAYS
    ? thisMonthEnd
    : endOfMonth(todayIso, 1);
}

export interface GoalStatus {
  /** Paying subscribers today. */
  paying: number;
  /** Gross monthly income those subscribers represent today, in ILS. */
  grossMonthlyIls: number;
  /** 0..100, share of the final goal reached. */
  percentOfGoal: number;
  /** Where the path says the app should be today. */
  expectedToday: number;
  /** paying - expectedToday: positive is ahead of the curve. */
  aheadBy: number;
  milestone: {
    date: string;
    /** Paying subscribers the path expects on `date`. */
    target: number;
    /** How many more must sign up by `date`. Never negative. */
    toGo: number;
    /** Calendar days from today to `date`. */
    daysLeft: number;
  };
  /** Whole months from today until the deadline, at least 0. */
  monthsToDeadline: number;
  /** New paying subscribers the path wants over the next 30 days. */
  paceNext30d: number;
}

/**
 * Everything the goal widget prints, from today's paying count and today's
 * date. `grossMonthlyIls` is what those subscribers actually pay a month
 * (the caller sums real plan prices); the blended goal price is only used
 * to describe the finish line.
 */
export function goalStatus(
  paying: number,
  grossMonthlyIls: number,
  todayIso: string,
): GoalStatus {
  const milestoneDate = nextMilestoneDate(todayIso);
  const target = goalPathOn(milestoneDate);
  const expectedToday = goalPathOn(todayIso);
  const in30d = addDays(todayIso, 30);
  const monthsToDeadline = Math.max(
    0,
    Math.floor(daysBetween(todayIso, GOAL.deadline) / 30.4375),
  );
  return {
    paying,
    grossMonthlyIls,
    percentOfGoal: Math.min(100, Math.round((paying / GOAL.subscribers) * 1000) / 10),
    expectedToday,
    aheadBy: paying - expectedToday,
    milestone: {
      date: milestoneDate,
      target,
      toGo: Math.max(0, target - paying),
      daysLeft: daysBetween(todayIso, milestoneDate),
    },
    monthsToDeadline,
    paceNext30d: Math.max(0, goalPathOn(in30d) - Math.max(paying, expectedToday)),
  };
}
