// מדיניות הפרטיות §4א states, as a flat fact, "איננו מקליטים את המסך שלך:
// הקלטת מסך מושבתת לחלוטין". That sentence is only true while the Sentry
// replay sample rates are zero - a runtime config any later edit, or an SDK
// default moving under a version bump, could flip without anyone opening the
// privacy page. An absolute negative in a published legal document that only
// a human remembering to re-check keeps honest is exactly how a true
// statement goes quietly false.
//
// So the claim is enforced here instead of remembered. If someone turns replay
// back on, this fails and the failure names the document that has to change
// with it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG = join(__dirname, "..", "instrumentation-client.ts");
const PRIVACY = join(
  __dirname,
  "..",
  "src",
  "app",
  "(marketing)",
  "privacy",
  "page.tsx",
);

describe("Sentry session replay stays off", () => {
  // The config file explains at length how one WOULD re-enable replay safely,
  // naming replayIntegration in prose. Strip comments so the assertions below
  // read the code and not the documentation about it.
  const src = readFileSync(CONFIG, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  function rate(key: string): string | null {
    const m = src.match(new RegExp(`^\\s*${key}:\\s*([0-9.]+)\\s*,`, "m"));
    return m ? m[1] : null;
  }

  it("sets replaysSessionSampleRate to 0", () => {
    expect(rate("replaysSessionSampleRate")).toBe("0");
  });

  it("sets replaysOnErrorSampleRate to 0", () => {
    expect(rate("replaysOnErrorSampleRate")).toBe("0");
  });

  it("adds no replayIntegration", () => {
    // Zero rates alone would not be enough if an integration were added with
    // its own defaults, so guard the other door too.
    expect(src).not.toMatch(/replayIntegration\s*\(/);
  });

  it("keeps the privacy policy's no-recording claim in step", () => {
    // If the claim is ever removed or reworded, this test's premise is gone
    // and it should be revisited deliberately rather than passing by accident.
    const privacy = readFileSync(PRIVACY, "utf8");
    expect(privacy).toContain("הקלטת מסך מושבתת");
  });
});
