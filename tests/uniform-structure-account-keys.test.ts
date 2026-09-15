import { describe, it, expect } from "vitest";
import { assignAccountKeys, buildAccountKeys } from "@/lib/uniform-structure/account-keys";

const client = (id: string, createdAt = "2026-01-01") => ({ id, createdAt });

describe("account keys", () => {
  it("keeps today's natural keys when nothing collides", () => {
    const keys = buildAccountKeys([client("9bbd3d8a-d7d0-4a00"), client("sc00000001-sample-client")], ["תוכנה", ""], ["CASH"]);
    expect(keys.client("9bbd3d8a-d7d0-4a00")).toBe("CLI-9bbd3d8a-d");
    expect(keys.client("sc00000001-sample-client")).toBe("CLI-sc00000001");
    expect(keys.expense("תוכנה")).toBe("EXP-תוכנה");
    expect(keys.expense("")).toBe("EXP-");
  });

  it("the older client keeps the natural key; same creation time falls back to id order", () => {
    const keys = buildAccountKeys([client("abcdefghij-2", "2025-01-01"), client("abcdefghij-1", "2026-01-01"), client("abcdefghij-3", "2026-01-01")], [], []);
    expect(["abcdefghij-2", "abcdefghij-1", "abcdefghij-3"].map((id) => keys.client(id))).toEqual(["CLI-abcdefghij", "CLI-abcdefgh~01", "CLI-abcdefgh~02"]);
  });

  it("is independent of input order", () => {
    const clients = [client("abcdefghij-1"), client("abcdefghij-2"), client("x")];
    const a = buildAccountKeys(clients, ["b", "a"], []);
    const b = buildAccountKeys([...clients].reverse(), ["a", "b"], []);
    expect(clients.map((c) => a.client(c.id))).toEqual(clients.map((c) => b.client(c.id)));
    expect([a.expense("a"), a.expense("b")]).toEqual([b.expense("a"), b.expense("b")]);
  });

  it("resolves long expense categories that share 11 characters, by name order", () => {
    const keys = buildAccountKeys([], ["הוצאות משרד מיוחדות", "הוצאות משרד כלליות"], []);
    expect(keys.expense("הוצאות משרד כלליות")).toBe("EXP-הוצאות משרד");
    expect(keys.expense("הוצאות משרד מיוחדות")).toBe("EXP-הוצאות מ~01");
  });

  it("the category first used earliest keeps its natural key when a newer one shares the prefix", () => {
    const keys = buildAccountKeys([], [
      { category: "הוצאות משרד כלליות", date: "2026-03-01" },
      { category: "הוצאות משרד מיוחדות", date: "2024-05-01" },
      { category: "הוצאות משרד כלליות", date: "2026-01-01" },
    ], []);
    expect(keys.expense("הוצאות משרד מיוחדות")).toBe("EXP-הוצאות משרד");
    expect(keys.expense("הוצאות משרד כלליות")).toBe("EXP-הוצאות מ~01");
    // same first date: name order
    const tie = buildAccountKeys([], [{ category: "הוצאות משרד מיוחדות", date: "2026-01-01" }, { category: "הוצאות משרד כלליות", date: "2026-01-01" }], []);
    expect(tie.expense("הוצאות משרד כלליות")).toBe("EXP-הוצאות משרד");
  });

  it("never hands out a reserved or already used key, and keeps the caller's order", () => {
    expect(assignAccountKeys("CLI-", ["abc"], 10, ["CLI-abc"]).get("abc")).toBe("CLI-abc~01");
    expect(assignAccountKeys("CLI-", ["abcdefghij-2", "abcdefghij-1"], 10).get("abcdefghij-2")).toBe("CLI-abcdefghij");
  });
});
