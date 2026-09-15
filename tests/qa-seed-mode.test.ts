import { describe, it, expect } from "vitest";
import { qaSeedMode } from "../scripts/lib/qa-seed-mode.mjs";

describe("qaSeedMode", () => {
  it("reads the mode from the positional argument, never from the reason text", () => {
    expect(qaSeedMode(["--reason", "clean", "seed"])).toBe("seed");
    expect(qaSeedMode(["--reason", "QA: filing fix E2E", "clean"])).toBe("clean");
    expect(qaSeedMode(["--reason=clean", "seed"])).toBe("seed");
  });
  it("refuses a missing, unknown or ambiguous mode", () => {
    expect(() => qaSeedMode(["--reason", "x"])).toThrow(/seed\|clean/);
    expect(() => qaSeedMode(["--reason", "x", "wipe"])).toThrow(/seed\|clean/);
    expect(() => qaSeedMode(["seed", "clean"])).toThrow(/seed\|clean/);
  });
});
