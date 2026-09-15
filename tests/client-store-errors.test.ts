import { describe, it, expect, vi, beforeEach } from "vitest";

type Op = "read" | "insert" | "update" | "delete";
const state = vi.hoisted(() => ({
  businessId: "business" as string | null,
  existing: false,
  writeError: null as null | { message: string },
  writeRows: 1,
  ops: [] as string[],
}));
const audit = vi.hoisted(() => ({ logAudit: vi.fn() }));

vi.mock("@/lib/business-init", () => ({ getBusinessId: () => state.businessId, onBusinessReady: vi.fn() }));
vi.mock("@/lib/audit-log", () => audit);
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      let op: Op = "read";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq: () => q,
        single: () => q,
        maybeSingle: () => q,
        insert() { op = "insert"; state.ops.push(op); return q; },
        update() { op = "update"; state.ops.push(op); return q; },
        delete() { op = "delete"; state.ops.push(op); return q; },
        then(resolve: (v: unknown) => void) {
          if (op === "read") {
            return Promise.resolve(resolve({ data: state.existing ? { id: "c1", name: "לקוח" } : null, error: null }));
          }
          return Promise.resolve(resolve({
            data: state.writeError ? null : Array.from({ length: state.writeRows }, () => ({ id: "c1" })),
            error: state.writeError,
          }));
        },
      };
      return q;
    },
  },
}));

import { clientStore } from "@/lib/client-store";
import { clientSaveErrorMessage } from "@/components/client-form-modal";

const client = { id: "c1", name: "לקוח", createdAt: "2026-09-15" };

beforeEach(() => {
  state.businessId = "business";
  state.existing = false;
  state.writeError = null;
  state.writeRows = 1;
  state.ops = [];
  audit.logAudit.mockClear();
  window.dispatchEvent = vi.fn();
});

describe("clientStore.save", () => {
  it("throws without an active business instead of silently returning", async () => {
    state.businessId = null;
    await expect(clientStore.save(client)).rejects.toThrow("אין עסק פעיל");
    expect(state.ops).toEqual([]);
  });

  it("throws when a manual insert fails", async () => {
    state.writeError = { message: "insert denied" };
    await expect(clientStore.save(client)).rejects.toThrow("insert denied");
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it("throws when an update fails or matches no row", async () => {
    state.existing = true;
    state.writeError = { message: "update denied" };
    await expect(clientStore.save(client)).rejects.toThrow("update denied");
    state.writeError = null;
    state.writeRows = 0;
    await expect(clientStore.save(client)).rejects.toThrow("השמירה לא בוצעה");
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it("resolves and broadcasts on a confirmed update", async () => {
    state.existing = true;
    await expect(clientStore.save(client)).resolves.toBeUndefined();
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
  });
});

describe("clientStore.remove", () => {
  it("does not write a client.deleted audit row when the delete errors", async () => {
    state.existing = true;
    state.writeError = { message: "delete denied" };
    await expect(clientStore.remove("c1")).rejects.toThrow("delete denied");
    expect(audit.logAudit).not.toHaveBeenCalled();
  });

  it("does not audit a delete that RLS silently refused (zero rows)", async () => {
    state.existing = true;
    state.writeRows = 0;
    await expect(clientStore.remove("c1")).rejects.toThrow("המחיקה לא בוצעה");
    expect(audit.logAudit).not.toHaveBeenCalled();
  });

  it("audits only after a confirmed delete", async () => {
    state.existing = true;
    await clientStore.remove("c1");
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "client.deleted", targetId: "c1" }));
  });
});

describe("client form error message", () => {
  it("shows the store's Hebrew message and hides raw technical errors", () => {
    expect(clientSaveErrorMessage(new Error("אין עסק פעיל - רענן את הדף ונסה שוב"))).toBe("אין עסק פעיל - רענן את הדף ונסה שוב");
    expect(clientSaveErrorMessage(new Error("new row violates row-level security policy"))).toBe("הלקוח לא נשמר. בדקו את החיבור ונסו שוב.");
    expect(clientSaveErrorMessage("x")).toBe("הלקוח לא נשמר. בדקו את החיבור ונסו שוב.");
  });
});
