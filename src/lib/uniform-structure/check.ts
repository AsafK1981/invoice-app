// The one entry point for "can this מבנה אחיד export be downloaded": input
// checks, build, output checks. The export route and the nightly guard both
// call it, so the guard counts exactly what users are stopped by.
import { buildUniformStructure, type UniformInput, type UniformOutput } from "./builder";
import type { UniformIssue } from "./issues";
import { validateUniformInput, validateUniformOutput } from "./preflight";

export interface UniformCheck {
  issues: UniformIssue[];
  /** Null when the input already blocks: nothing is built from bad data. */
  result: UniformOutput | null;
  ok: boolean;
}

export function checkUniformExport(input: UniformInput, options: { sample?: boolean; registrationNumber?: string } = {}): UniformCheck {
  const sample = options.sample ?? false;
  const issues = validateUniformInput(input);
  if (!sample && !options.registrationNumber)
    issues.push({ code: "software_registration_missing", level: "warning", message: "מספר תעודת רישום התוכנה טרם הוזן. הבדיקה המקומית אינה אישור רישום או אישור קבלה מרשות המסים." });
  if (issues.some((issue) => issue.level === "error")) return { issues, result: null, ok: false };
  const result = buildUniformStructure(input);
  issues.push(...validateUniformOutput(result, sample));
  return { issues, result, ok: !issues.some((issue) => issue.level === "error") };
}
