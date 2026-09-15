// Pure helpers for the yearly Tax Authority deadline-calendar watcher
// (scripts/watch-ita-calendar.mjs). No I/O, so tests/ita-calendar-watch.test.ts
// runs them against the real 2026 notice text.

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

const pad2 = (n) => String(n).padStart(2, "0");

/** "16.2.2026" / "18.01.2027" -> "2026-02-16", or null. */
export function parseIsraeliDate(text) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(text).trim());
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/**
 * The per-month table of the notice "קביעת מועדי הדיווח והתשלום ... שנת המס
 * YYYY", from the page's visible text. Each row starts with a Hebrew month
 * name and carries three dates in order: periodic VAT + advances, deductions,
 * detailed VAT report. Returns { "YYYY-MM": { periodic, withholding, detailed } }
 * for the rows it could read, and the months it could not.
 */
export function parseNoticeTable(text, year) {
  const rows = {};
  const missing = [];
  const lines = String(text).split(/\r?\n/);
  MONTHS.forEach((name, i) => {
    const line = lines.find((l) => l.trim().startsWith(name) && /\d{1,2}\.\d{1,2}\.\d{4}/.test(l));
    const dates = line ? (line.match(/\d{1,2}\.\d{1,2}\.\d{4}/g) || []).map(parseIsraeliDate).filter(Boolean) : [];
    if (dates.length < 3) {
      missing.push(`${year}-${pad2(i + 1)}`);
      return;
    }
    rows[`${year}-${pad2(i + 1)}`] = { periodic: dates[0], withholding: dates[1], detailed: dates[2] };
  });
  return { rows, missing };
}

/** Sanity rules every real row satisfies: due in the month after (or two after) the period, in date order. */
export function validateRows(rows) {
  const problems = [];
  for (const [ym, r] of Object.entries(rows)) {
    const [y, m] = ym.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
    for (const [kind, date] of Object.entries(r)) {
      if (!date.startsWith(next)) problems.push(`${ym} ${kind} ${date} is not in ${next}`);
    }
    if (r.detailed < r.periodic) problems.push(`${ym} detailed ${r.detailed} before periodic ${r.periodic}`);
  }
  return problems;
}

/** Reporting months already in src/lib/ita/filing-calendar.ts OFFICIAL_DEADLINES. */
export function coveredMonths(calendarSource) {
  const block = /OFFICIAL_DEADLINES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(String(calendarSource));
  if (!block) return [];
  return [...block[1].matchAll(/"(\d{4}-\d{2})":\s*\{/g)].map((m) => m[1]);
}

/** Which tax year the watcher should make sure is covered on `today` (ISO date). */
export function targetYear(today) {
  const [y, m] = today.split("-").map(Number);
  // The notice for next year comes out between October and December.
  return m >= 10 ? y + 1 : y;
}

/** From gov.il search result links, the notice for `year`, if listed. */
export function findNotice(links, year) {
  const hit = links.find(([href, text]) => /gov\.il\/he\/.*\/(pages|reports)\//i.test(href) && text.includes("מועדי") && text.includes("שנת המס") && text.includes(String(year)));
  return hit ? { href: hit[0], title: hit[1] } : null;
}

/** Postponement notices ("דחיית מועדי הדיווח") mentioning the given year. */
export function findPostponements(links, year) {
  return links
    .filter(([href, text]) => /gov\.il\/he\//i.test(href) && text.includes("דחיית") && text.includes("מועד") && text.includes(String(year)))
    .map(([href, text]) => ({ href, title: text }));
}

/** The TypeScript rows to paste into OFFICIAL_DEADLINES. */
export function tsSnippet(rows) {
  return Object.entries(rows)
    .map(([ym, r]) => `  "${ym}": { periodic: "${r.periodic}", withholding: "${r.withholding}", detailed: "${r.detailed}" },`)
    .join("\n");
}
