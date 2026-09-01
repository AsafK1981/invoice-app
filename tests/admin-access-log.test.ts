import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAdminAccessRow, logAdminAccess } from "@/lib/admin-access-log";
import { resolveAdminReason, ADMIN_REASON_USAGE } from "../scripts/lib/admin-reason.mjs";

/**
 * Two halves of the operator-access journal are worth pinning down:
 *
 *  - the script gate (no reason, no service-role client), because it is the
 *    only thing standing between "I'll just check something in prod" and an
 *    unlogged cross-tenant read;
 *  - the insert payload and its failure behaviour, because a logger that
 *    throws would turn a privacy safeguard into an outage.
 */

type InsertCall = { table: string; row: Record<string, unknown> };

function mockClient(result: { error: { message: string } | null } | Error) {
  const calls: InsertCall[] = [];
  const sb = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          calls.push({ table, row });
          if (result instanceof Error) return Promise.reject(result);
          return Promise.resolve(result);
        },
      };
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveAdminReason", () => {
  it("rejects a run with no reason anywhere, with an actionable Hebrew message", () => {
    const r = resolveAdminReason(["--dry-run"], {});
    expect(r.ok).toBe(false);
    expect(r.reason).toBeNull();
    expect(r.message).toBe(ADMIN_REASON_USAGE);
    expect(/[֐-׿]/.test(r.message ?? "")).toBe(true);
    expect(r.message).toContain("--reason");
    // The rest of the argv survives so the script can still parse its own flags.
    expect(r.rest).toEqual(["--dry-run"]);
  });

  it("accepts --reason <value> and strips the flag pair from argv", () => {
    const r = resolveAdminReason(["--reason", "תמיכה: אסף ביקש", "--dry-run"], {});
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("תמיכה: אסף ביקש");
    expect(r.rest).toEqual(["--dry-run"]);
  });

  it("accepts the --reason=value form", () => {
    const r = resolveAdminReason(["--reason=גיבוי ידני", "x"], {});
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("גיבוי ידני");
    expect(r.rest).toEqual(["x"]);
  });

  it("falls back to ADMIN_REASON when no flag is given", () => {
    const r = resolveAdminReason([], { ADMIN_REASON: "בדיקה חודשית" });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("בדיקה חודשית");
  });

  it("prefers an explicit flag over the env var", () => {
    const r = resolveAdminReason(["--reason", "flag wins"], { ADMIN_REASON: "env loses" });
    expect(r.reason).toBe("flag wins");
  });

  it("treats an empty or whitespace-only reason as no reason at all", () => {
    // --reason "" must not buy a pass that bare --reason would not.
    expect(resolveAdminReason(["--reason", ""], {}).ok).toBe(false);
    expect(resolveAdminReason(["--reason", "   "], {}).ok).toBe(false);
    expect(resolveAdminReason(["--reason="], {}).ok).toBe(false);
    expect(resolveAdminReason([], { ADMIN_REASON: "  " }).ok).toBe(false);
  });

  it("takes a single-dash-leading reason as the value, not as the next flag", () => {
    const r = resolveAdminReason(["--reason", "-בדיקה", "--json"], {});
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("-בדיקה");
    expect(r.rest).toEqual(["--json"]);
  });

  it("refuses to swallow a long flag as the reason value", () => {
    // A mistyped `--reason --dry-run` must fail the gate AND keep --dry-run
    // in rest: eating an operational flag could turn a dry run live.
    const r = resolveAdminReason(["--reason", "--dry-run"], {});
    expect(r.ok).toBe(false);
    expect(r.rest).toEqual(["--dry-run"]);
    // The escape hatch for a genuinely dash-dash reason is the = form.
    expect(resolveAdminReason(["--reason=--weird"], {}).reason).toBe("--weird");
  });
});

describe("buildAdminAccessRow", () => {
  it("maps the entry to snake_case columns and nulls the optional targets", () => {
    expect(
      buildAdminAccessRow({
        actor: "asafkotlar@gmail.com",
        channel: "admin_api",
        action: "admin/stats GET",
      }),
    ).toEqual({
      actor: "asafkotlar@gmail.com",
      channel: "admin_api",
      action: "admin/stats GET",
      target_user_id: null,
      target_business_id: null,
      detail: null,
    });
  });

  it("carries the target ids and detail through when supplied", () => {
    const row = buildAdminAccessRow({
      actor: "asafkotlar@gmail.com",
      channel: "admin_api",
      action: "admin/import-for-user POST",
      targetUserId: "11111111-2222-3333-4444-555555555555",
      targetBusinessId: "66666666-7777-8888-9999-000000000000",
      detail: { entity_type: "clients", row_count: 12 },
    });
    expect(row.target_user_id).toBe("11111111-2222-3333-4444-555555555555");
    expect(row.target_business_id).toBe("66666666-7777-8888-9999-000000000000");
    expect(row.detail).toEqual({ entity_type: "clients", row_count: 12 });
  });

  it("never leaves actor empty", () => {
    expect(buildAdminAccessRow({ actor: "", channel: "script", action: "x" }).actor).toBe(
      "unknown",
    );
  });
});

describe("logAdminAccess", () => {
  it("inserts one row into admin_access_log", async () => {
    const { sb, calls } = mockClient({ error: null });
    await logAdminAccess(sb, {
      actor: "asafkotlar@gmail.com",
      channel: "admin_api",
      action: "admin/users GET",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("admin_access_log");
    expect(calls[0].row).toEqual({
      actor: "asafkotlar@gmail.com",
      channel: "admin_api",
      action: "admin/users GET",
      target_user_id: null,
      target_business_id: null,
      detail: null,
    });
  });

  it("warns and resolves when the insert returns an error (missing table, RLS)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sb } = mockClient({ error: { message: 'relation "admin_access_log" does not exist' } });
    await expect(
      logAdminAccess(sb, { actor: "a@b.c", channel: "script", action: "count-data.mjs" }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("count-data.mjs");
  });

  it("warns and resolves when the insert throws (network down)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sb } = mockClient(new Error("fetch failed"));
    await expect(
      logAdminAccess(sb, { actor: "a@b.c", channel: "admin_ui", action: "admin GET" }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("fetch failed");
  });
});
