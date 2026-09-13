export const ADMIN_CHART_RANGES = [
  { value: "7d", label: "שבוע" },
  { value: "14d", label: "שבועיים" },
  { value: "1mo", label: "חודש" },
  { value: "2mo", label: "חודשיים" },
  { value: "6mo", label: "חצי שנה" },
  { value: "1yr", label: "שנה" },
  { value: "all", label: "מתחילת האפליקציה" },
] as const;

export type AdminChartRange = (typeof ADMIN_CHART_RANGES)[number]["value"];
export interface AdminDailyPoint { date: string; count: number }
export interface AdminChartPoint extends AdminDailyPoint { endDate: string }

const DAY_MS = 86_400_000;
const jerusalemDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
});

export function getAdminChartDay(timestamp: string): string {
  const parts = jerusalemDay.formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayTime(day: string): number { return Date.parse(`${day}T00:00:00Z`); }
function dayString(time: number): string { return new Date(time).toISOString().slice(0, 10); }

// Calendar arithmetic on UTC date-only values avoids daylight-saving gaps.
function monthsBefore(day: string, months: number): number {
  const date = new Date(dayTime(day));
  const dayOfMonth = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(dayOfMonth, lastDay));
  return date.getTime();
}

export function buildAdminChart(
  daily: readonly AdminDailyPoint[],
  range: AdminChartRange,
  generatedAt: string,
  startedAt?: string,
): {
  data: AdminChartPoint[];
  total: number;
  startDate: string;
  endDate: string;
  granularity: "day" | "week" | "month";
} {
  const endDate = getAdminChartDay(generatedAt);
  const end = dayTime(endDate);
  let start: number;
  if (range === "all") {
    start = daily.reduce((earliest, point) => Math.min(earliest, dayTime(point.date)),
      startedAt ? Math.min(end, dayTime(startedAt)) : end);
  } else if (range === "7d" || range === "14d") {
    start = end - (range === "7d" ? 6 : 13) * DAY_MS;
  } else {
    const months = { "1mo": 1, "2mo": 2, "6mo": 6, "1yr": 12 }[range];
    start = monthsBefore(endDate, months) + DAY_MS;
  }
  const startDate = dayString(start);
  const days = Math.round((end - start) / DAY_MS) + 1;
  const granularity = days <= 62 ? "day" : days <= 200 ? "week" : "month";
  const counts = new Map<string, number>();
  for (const point of daily) {
    if (point.date >= startDate && point.date <= endDate) {
      counts.set(point.date, (counts.get(point.date) ?? 0) + point.count);
    }
  }
  const data: AdminChartPoint[] = [];
  let total = 0;
  for (let cursor = start; cursor <= end;) {
    let bucketEnd = cursor;
    if (granularity === "week") bucketEnd = Math.min(cursor + 6 * DAY_MS, end);
    if (granularity === "month") {
      const date = new Date(cursor);
      bucketEnd = Math.min(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0), end);
    }
    let count = 0;
    for (let day = cursor; day <= bucketEnd; day += DAY_MS) count += counts.get(dayString(day)) ?? 0;
    data.push({ date: dayString(cursor), endDate: dayString(bucketEnd), count });
    total += count;
    cursor = bucketEnd + DAY_MS;
  }
  return { data, total, startDate, endDate, granularity };
}
