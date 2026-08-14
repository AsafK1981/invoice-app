import { describe, it, expect } from "vitest";
import { appendFinalResult, mapSpeechError } from "@/lib/use-speech-recognition";

describe("appendFinalResult", () => {
  it("returns the chunk as-is when there is no prior text", () => {
    expect(appendFinalResult("", "שלום")).toBe("שלום");
  });

  it("joins prior text and a new chunk with a single space", () => {
    expect(appendFinalResult("שלום", "עולם")).toBe("שלום עולם");
  });

  it("trims whitespace off the incoming chunk", () => {
    expect(appendFinalResult("שלום", "  עולם  ")).toBe("שלום עולם");
  });

  it("leaves prior text untouched when the chunk is empty or whitespace-only", () => {
    expect(appendFinalResult("שלום", "")).toBe("שלום");
    expect(appendFinalResult("שלום", "   ")).toBe("שלום");
  });

  it("accumulates across repeated calls, e.g. multiple finalized utterances", () => {
    let acc = "";
    acc = appendFinalResult(acc, "כמה");
    acc = appendFinalResult(acc, "הכנסתי");
    acc = appendFinalResult(acc, "החודש");
    expect(acc).toBe("כמה הכנסתי החודש");
  });

  it("appends dictation onto text the user already typed", () => {
    const typedBeforeDictation = "תכין לי חשבונית";
    const dictatedTranscript = "ללקוח דני";
    expect(appendFinalResult(typedBeforeDictation, dictatedTranscript)).toBe(
      "תכין לי חשבונית ללקוח דני"
    );
  });

  it("composes committed transcript plus a live interim tail (as the composer does)", () => {
    const base = "שלח";
    const transcript = "בבקשה חשבונית";
    const interim = "חדשה ל";
    const composed = appendFinalResult(appendFinalResult(base, transcript), interim);
    expect(composed).toBe("שלח בבקשה חשבונית חדשה ל");
  });
});

describe("mapSpeechError", () => {
  it("maps permission errors to a Hebrew mic-permission message", () => {
    const msg = "אין הרשאה למיקרופון. אפשרו גישה בהגדרות הדפדפן.";
    expect(mapSpeechError("not-allowed")).toBe(msg);
    expect(mapSpeechError("service-not-allowed")).toBe(msg);
  });

  it("maps no-speech to a retry hint", () => {
    expect(mapSpeechError("no-speech")).toBe("לא נשמע כלום, נסו שוב.");
  });

  it("maps network errors to a connectivity message", () => {
    expect(mapSpeechError("network")).toBe("אין חיבור לשירות ההקלדה הקולית.");
  });

  it("falls back to a generic Hebrew message for unknown codes", () => {
    expect(mapSpeechError("aborted")).toBe("ההקלדה הקולית נתקלה בתקלה. נסו שוב.");
    expect(mapSpeechError("audio-capture")).toBe("ההקלדה הקולית נתקלה בתקלה. נסו שוב.");
    expect(mapSpeechError("")).toBe("ההקלדה הקולית נתקלה בתקלה. נסו שוב.");
  });
});
