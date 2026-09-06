import { describe, it, expect } from "vitest";
import { waDigits, whatsappLink } from "@/lib/whatsapp-link";

describe("waDigits", () => {
  it("turns an Israeli local mobile into wa.me digits", () => {
    expect(waDigits("0549000684")).toBe("972549000684");
  });

  it("strips spaces, dashes and parentheses", () => {
    expect(waDigits("054-900-0684")).toBe("972549000684");
    expect(waDigits("054 900 0684")).toBe("972549000684");
    expect(waDigits("(054) 900-0684")).toBe("972549000684");
  });

  it("keeps an already international number and drops the +", () => {
    expect(waDigits("+972 54 900 0684")).toBe("972549000684");
    expect(waDigits("972549000684")).toBe("972549000684");
  });

  it("drops a 00 international prefix", () => {
    expect(waDigits("00972549000684")).toBe("972549000684");
  });

  it("fixes a country code followed by the local leading zero", () => {
    expect(waDigits("+9720549000684")).toBe("972549000684");
  });

  it("keeps a foreign number as typed", () => {
    expect(waDigits("+1 714 928 9011")).toBe("17149289011");
  });

  it("returns empty for anything too short to dial", () => {
    expect(waDigits("054900")).toBe("");
    expect(waDigits("12345678")).toBe("");
    expect(waDigits("")).toBe("");
    expect(waDigits(null)).toBe("");
    expect(waDigits(undefined)).toBe("");
    expect(waDigits("לא ידוע")).toBe("");
  });
});

describe("whatsappLink", () => {
  it("encodes Hebrew text into the wa.me query", () => {
    const url = whatsappLink("054-900-0684", "שלום דני,\nאשמח לתשלום");
    expect(url.startsWith("https://wa.me/972549000684?text=")).toBe(true);
    const text = new URL(url).searchParams.get("text");
    expect(text).toBe("שלום דני,\nאשמח לתשלום");
  });

  it("encodes the newline and the shekel sign rather than passing them raw", () => {
    const url = whatsappLink("0549000684", "סך ₪1,200\nתודה");
    expect(url).toContain("%0A");
    expect(url).not.toContain("\n");
    expect(url).toContain(encodeURIComponent("₪"));
  });

  it("falls back to the contact picker when there is no usable number", () => {
    expect(whatsappLink("", "היי")).toBe(`https://wa.me/?text=${encodeURIComponent("היי")}`);
    expect(whatsappLink("0549", "היי")).toBe(`https://wa.me/?text=${encodeURIComponent("היי")}`);
  });
});
