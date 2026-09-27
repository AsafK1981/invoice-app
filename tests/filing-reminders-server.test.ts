import { describe, it, expect, vi } from "vitest";

// remindBusiness only reaches the notification writer through the injected
// `send`; the mock keeps the real module (Supabase client, web push) out.
vi.mock("@/lib/notifications-server", () => ({ createNotificationForBusiness: vi.fn(async () => true) }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { remindBusiness } from "@/lib/filing-reminders-server";
import { formatCurrencyWhole } from "@/lib/format";

type Op = { method: string; args: unknown[] };
type Call = { table: string; ops: Op[] };
type Result = { data: unknown; error: { message: string } | null; count?: number | null };
type Handler = (call: Call) => Result;

/**
 * A minimal chainable stand-in for the service-role client: every builder
 * method records itself and returns the builder; awaiting it (or
 * maybeSingle) asks `handler` for the result. A handler that throws makes the
 * awaited query reject, the way a network failure would.
 */
function stubAdmin(handler: Handler) {
  const calls: Call[] = [];
  const admin = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "update", "eq", "gte", "lte", "order", "range", "in"]) {
        builder[method] = (...args: unknown[]) => {
          call.ops.push({ method, args });
          return builder;
        };
      }
      const run = () => new Promise<Result>((resolve) => resolve(handler(call)));
      builder.maybeSingle = () => {
        call.ops.push({ method: "maybeSingle", args: [] });
        return run();
      };
      builder.then = (ok: (r: Result) => unknown, fail?: (e: unknown) => unknown) => run().then(ok, fail);
      return builder;
    },
  };
  return { admin: admin as unknown as SupabaseClient, calls };
}

const has = (call: Call, method: string) => call.ops.some((o) => o.method === method);
const updates = (calls: Call[]) => calls.filter((c) => c.table === "filing_preferences" && has(c, "update"));

const TODAY = "2026-09-21";
const business = { id: "biz-1", taxId: "513333336", businessType: "authorized" as const };
const prefRow = (reminded: Record<string, string> = {}) => ({
  business_id: "biz-1",
  vat_cadence: "bimonthly",
  advance_cadence: "bimonthly",
  detailed_reporter: false,
  has_employees: false,
  reminders_enabled: true,
  reminder_days_before: 3,
  filed: {},
  reminded,
  updated_at: "2026-09-20T00:00:00Z",
});

// July-August 2026: two paid tax invoices (540 output VAT) and one expense (36 input VAT).
const docRows = [
  { id: "d1", date: "2026-07-10", type: "tax_invoice", status: "paid", number: 1, client_id: "c1", client_name: "x", client_tax_id: "513333336", subtotal: 1000, vat: 180, total: 1180, currency: "ILS" },
  { id: "d2", date: "2026-08-20", type: "tax_invoice", status: "paid", number: 2, client_id: "c1", client_name: "x", client_tax_id: "513333336", subtotal: 2000, vat: 360, total: 2360, currency: "ILS" },
];
const expenseRows = [
  { id: "e1", date: "2026-07-05", category: "office", supplier: "s", amount: 236, vat_amount: 36, is_equipment: false, supplier_tax_id: "513333336", reference: "77" },
];

const page = (rows: unknown[]): Result => ({ data: rows, error: null, count: rows.length });

/**
 * Every conditional update matches (claim and release), a re-read of the
 * preferences row returns `reread`, and the rows come from the given tables.
 */
function handlerWith(rows: { documents?: Handler; expenses?: Handler } = {}, reread: Record<string, unknown> | null = null): Handler {
  return (call) => {
    if (call.table === "filing_preferences") {
      if (has(call, "maybeSingle")) return { data: reread, error: null };
      return { data: [{ business_id: "biz-1" }], error: null };
    }
    if (call.table === "documents") return rows.documents ? rows.documents(call) : page(docRows);
    if (call.table === "expenses") return rows.expenses ? rows.expenses(call) : page(expenseRows);
    throw new Error(`unexpected table ${call.table}`);
  };
}

type SendArgs = { businessId: string; kind: string; title: string; body?: string; href?: string };
function recorder(fail: (a: SendArgs) => boolean = () => false) {
  const sent: SendArgs[] = [];
  const send = vi.fn(async (a: SendArgs) => {
    sent.push(a);
    return !fail(a);
  });
  return { sent, send: send as unknown as NonNullable<Parameters<typeof remindBusiness>[0]["send"]> };
}

const plainTail = 'בלוח חובות ההגשה יש את כל הפרטים, וסימון "הגשתי" מפסיק את התזכורות.';

describe("remindBusiness", () => {
  it("sends the VAT reminder with the amount due and links to the periodic report", async () => {
    const { admin, calls } = stubAdmin(handlerWith());
    const { sent, send } = recorder();
    const out = await remindBusiness({ admin, row: prefRow(), business, today: TODAY, send });

    expect(out).toEqual({ planned: 2, sent: 2, withAmount: 1, failedClaim: false, failedSends: 0 });
    const vat = sent.find((s) => s.title.startsWith("דוח מע״מ תקופתי"))!;
    expect(vat.body).toBe(`לתשלום ${formatCurrencyWhole(504)} עד 24.09.2026, לפי המסמכים וההוצאות באפליקציה.`);
    expect(vat.href).toBe("/reports/periodic?period=2026-B4");
    expect(vat.kind).toBe("filing_deadline");
    // The advance has no rate on this business, so it asks for one.
    const adv = sent.find((s) => s.title.startsWith("מקדמות"))!;
    expect(adv.body).toContain("הזן את שיעור המקדמות");

    // The rows were read for this business and period only.
    const docs = calls.find((c) => c.table === "documents")!;
    expect(docs.ops).toContainEqual({ method: "eq", args: ["business_id", "biz-1"] });
    expect(docs.ops).toContainEqual({ method: "gte", args: ["date", "2026-07-01"] });
    expect(docs.ops).toContainEqual({ method: "lte", args: ["date", "2026-08-31"] });
    expect(docs.ops).toContainEqual({ method: "select", args: [expect.any(String), { count: "exact" }] });
    expect(docs.ops).toContainEqual({ method: "order", args: ["id", { ascending: true }] });
    // The claim wrote both keys, conditional on updated_at.
    const claim = updates(calls)[0];
    expect(Object.keys((claim.ops.find((o) => o.method === "update")!.args[0] as { reminded: object }).reminded).sort()).toEqual(["income_tax_advance:2026-B4", "vat_periodic:2026-B4"]);
    expect(claim.ops).toContainEqual({ method: "eq", args: ["updated_at", "2026-09-20T00:00:00Z"] });
  });

  it("a rows query error still sends the reminders, with the plain text", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = stubAdmin(handlerWith({ documents: () => ({ data: null, error: { message: "boom" } }) }));
    const { sent, send } = recorder();
    const out = await remindBusiness({ admin, row: prefRow(), business, today: TODAY, send });

    expect(out).toMatchObject({ planned: 2, sent: 2, withAmount: 0, failedClaim: false, failedSends: 0 });
    const vat = sent.find((s) => s.title.startsWith("דוח מע״מ תקופתי"))!;
    expect(vat.body).toBe(`המועד האחרון הוא 24.09.2026. ${plainTail}`);
    // Logs carry ids only.
    for (const [, meta] of errorSpy.mock.calls) expect(Object.keys(meta as object).every((k) => ["businessId", "key", "table", "keys", "error"].includes(k))).toBe(true);
    errorSpy.mockRestore();
  });

  it("a documents query that throws is contained the same way", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = stubAdmin(handlerWith({ documents: () => { throw new Error("network down"); } }));
    const { sent, send } = recorder();
    const out = await remindBusiness({ admin, row: prefRow(), business, today: TODAY, send });

    expect(out).toMatchObject({ sent: 2, withAmount: 0, failedSends: 0 });
    expect(sent.find((s) => s.title.startsWith("דוח מע״מ תקופתי"))!.body).toBe(`המועד האחרון הוא 24.09.2026. ${plainTail}`);
    errorSpy.mockRestore();
  });

  it("a row the mapper rejects is contained the same way", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = stubAdmin(handlerWith({ documents: () => page([{ ...docRows[0], type: "mystery" }]) }));
    const { send } = recorder();
    const out = await remindBusiness({ admin, row: prefRow(), business, today: TODAY, send });
    expect(out).toMatchObject({ sent: 2, withAmount: 0, failedSends: 0 });
    errorSpy.mockRestore();
  });

  it("a failed send releases only its own key, on the freshly read map", async () => {
    // Between the claim and the release another run claimed btl_advance; the
    // re-read shows it, and the release must keep it.
    const fresh = {
      ...prefRow({
        "annual_report:2025": "2026-04-27T06:00:00Z",
        "income_tax_advance:2026-B4": "2026-09-21T06:00:00Z",
        "vat_periodic:2026-B4": "2026-09-21T06:00:00Z",
        "btl_advance:2026-08": "2026-09-21T06:00:05Z",
      }),
      updated_at: "2026-09-21T06:00:05Z",
    };
    const { admin, calls } = stubAdmin(handlerWith({}, fresh));
    const { send } = recorder((a) => a.title.startsWith("דוח מע״מ תקופתי"));
    const out = await remindBusiness({ admin, row: prefRow({ "annual_report:2025": "2026-04-27T06:00:00Z" }), business, today: TODAY, send });

    expect(out).toMatchObject({ planned: 2, sent: 1, failedSends: 1, failedClaim: false });
    const writes = updates(calls);
    expect(writes).toHaveLength(2); // the claim, then the release
    const release = writes[1];
    const released = (release.ops.find((o) => o.method === "update")!.args[0] as { reminded: Record<string, string> }).reminded;
    expect(Object.keys(released).sort()).toEqual(["annual_report:2025", "btl_advance:2026-08", "income_tax_advance:2026-B4"]);
    expect(release.ops).toContainEqual({ method: "eq", args: ["updated_at", "2026-09-21T06:00:05Z"] });
    expect(release.ops).toContainEqual({ method: "eq", args: ["business_id", "biz-1"] });
  });

  it("a release that loses the race re-reads and tries once more, then gives up", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let writesSeen = 0;
    const base = handlerWith({}, { ...prefRow({ "vat_periodic:2026-B4": "x" }), updated_at: "2026-09-21T06:00:05Z" });
    const { admin, calls } = stubAdmin((call) => {
      if (call.table === "filing_preferences" && has(call, "update")) {
        writesSeen++;
        // The claim matches; every release loses the race.
        return { data: writesSeen === 1 ? [{ business_id: "biz-1" }] : [], error: null };
      }
      return base(call);
    });
    const { send } = recorder((a) => a.title.startsWith("דוח מע״מ תקופתי"));
    await remindBusiness({ admin, row: prefRow(), business, today: TODAY, send });

    expect(updates(calls)).toHaveLength(3); // the claim, then two release attempts
    expect(calls.filter((c) => c.table === "filing_preferences" && has(c, "maybeSingle"))).toHaveLength(2);
    expect(errorSpy).toHaveBeenCalledWith("[filing-reminders] could not release failed reminders", { businessId: "biz-1", keys: ["vat_periodic:2026-B4"] });
    errorSpy.mockRestore();
  });

  it("with nothing planned, makes no claim and sends nothing", async () => {
    const { admin, calls } = stubAdmin(handlerWith());
    const { send } = recorder();
    const reminded = { "income_tax_advance:2026-B4": "2026-09-21T06:00:00Z", "vat_periodic:2026-B4": "2026-09-21T06:00:00Z" };
    const out = await remindBusiness({ admin, row: prefRow(reminded), business, today: TODAY, send });

    expect(out).toEqual({ planned: 0, sent: 0, withAmount: 0, failedClaim: false, failedSends: 0 });
    expect(calls).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("a pension reminder loads the whole year and carries the mandatory minimum", async () => {
    const { admin, calls } = stubAdmin(handlerWith());
    const { sent, send } = recorder();
    const out = await remindBusiness({ admin, row: prefRow(), business, today: "2026-12-29", send });

    expect(out).toEqual({ planned: 1, sent: 1, withAmount: 1, failedClaim: false, failedSends: 0 });
    const docs = calls.filter((c) => c.table === "documents");
    expect(docs).toHaveLength(1); // one load
    expect(docs[0].ops).toContainEqual({ method: "gte", args: ["date", "2026-01-01"] });
    expect(docs[0].ops).toContainEqual({ method: "lte", args: ["date", "2026-12-31"] });
    const exps = calls.find((c) => c.table === "expenses")!;
    expect(exps.ops).toContainEqual({ method: "gte", args: ["date", "2026-01-01"] });
    expect(exps.ops).toContainEqual({ method: "lte", args: ["date", "2026-12-31"] });
    // 3,000 pre-VAT income - 200 net expenses = 2,800; 4.45% = 124.6.
    expect(sent[0].href).toBe("/reports/pension");
    expect(sent[0].body).toContain(`המינימום להפקדה עד 31.12.2026 הוא ${formatCurrencyWhole(125)}`);
    expect(sent[0].body).toContain(`לפי הרווח החייב באפליקציה עד היום (${formatCurrencyWhole(2_800)})`);
  });
});
