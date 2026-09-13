import { describe, expect, it } from "vitest";
import { buildAdminChart, getAdminChartDay } from "@/lib/admin-chart";

describe("admin chart calendar periods", () => {
  const now = "2026-09-13T12:00:00Z";

  it("groups timestamps by Israel date around midnight and daylight saving", () => {
    expect(getAdminChartDay("2026-09-12T21:30:00Z")).toBe("2026-09-13");
    expect(getAdminChartDay("2026-01-12T21:30:00Z")).toBe("2026-01-12");
    expect(getAdminChartDay("2026-01-12T22:30:00Z")).toBe("2026-01-13");
  });

  it("includes today, excludes earlier dates, and fills empty days", () => {
    const chart = buildAdminChart([
      { date: "2026-09-06", count: 99 },
      { date: "2026-09-07", count: 2 },
      { date: "2026-09-13", count: 3 },
      { date: "2026-09-14", count: 100 },
    ], "7d", now);
    expect(chart.startDate).toBe("2026-09-07");
    expect(chart.endDate).toBe("2026-09-13");
    expect(chart.data).toHaveLength(7);
    expect(chart.total).toBe(5);
    expect(chart.data[1].count).toBe(0);
  });

  it("uses calendar months with clamping, including leap years", () => {
    expect(buildAdminChart([], "1mo", "2026-03-31T12:00:00Z").startDate).toBe("2026-03-01");
    expect(buildAdminChart([], "1mo", "2024-03-31T12:00:00Z").startDate).toBe("2024-03-01");
    expect(buildAdminChart([], "1yr", "2024-02-29T12:00:00Z").startDate).toBe("2023-03-01");
    expect(buildAdminChart([], "2mo", now).startDate).toBe("2026-07-14");
    expect(buildAdminChart([], "6mo", now).startDate).toBe("2026-03-14");
  });

  it("preserves totals when grouping longer periods", () => {
    const points = Array.from({ length: 365 }, (_, i) => ({
      date: new Date(Date.UTC(2025, 8, 14 + i)).toISOString().slice(0, 10),
      count: (i % 5) + 1,
    }));
    const chart = buildAdminChart(points, "1yr", now);
    expect(chart.total).toBe(points.reduce((sum, point) => sum + point.count, 0));
    expect(chart.data.reduce((sum, point) => sum + point.count, 0)).toBe(chart.total);
    expect(chart.granularity).toBe("month");
    expect(chart.data.length).toBeLessThanOrEqual(13);
    expect(chart.data[0].date).toBe(chart.startDate);
    expect(chart.data.at(-1)?.endDate).toBe(chart.endDate);
  });

  it("uses the same application start for empty and populated all-time charts", () => {
    const populated = buildAdminChart([{ date: "2026-09-12", count: 4 }], "all", now, "2026-08-01");
    const empty = buildAdminChart([], "all", now, "2026-08-01");
    expect(populated.startDate).toBe("2026-08-01");
    expect(empty.startDate).toBe(populated.startDate);
    expect(empty.total).toBe(0);
    expect(populated.total).toBe(4);
  });

  it("keeps partial weekly buckets inside the selected period", () => {
    const chart = buildAdminChart([
      { date: "2026-03-13", count: 50 },
      { date: "2026-03-14", count: 2 },
      { date: "2026-09-13", count: 3 },
    ], "6mo", now);
    expect(chart.granularity).toBe("week");
    expect(chart.data[0]).toEqual({ date: "2026-03-14", endDate: "2026-03-20", count: 2 });
    expect(chart.data.at(-1)?.endDate).toBe("2026-09-13");
    expect(chart.total).toBe(5);
  });

  it("returns usable empty series and independent selections", () => {
    const data = [{ date: "2026-09-01", count: 4 }];
    expect(buildAdminChart([], "14d", now).data).toHaveLength(14);
    expect(buildAdminChart(data, "7d", now).total).toBe(0);
    expect(buildAdminChart(data, "14d", now).total).toBe(4);
    expect(data).toEqual([{ date: "2026-09-01", count: 4 }]);
  });
});
