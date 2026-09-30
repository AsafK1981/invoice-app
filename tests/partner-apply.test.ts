import { describe, it, expect } from "vitest";
import { FOUNDING_SLOTS, validatePartnerApplication } from "@/lib/partner-apply";

const good = {
  name: "  דנה   כהן ",
  office: "כהן רואי חשבון",
  city: "חיפה",
  email: "Dana@Example.co.il",
  phone: "04-123-4567",
  website: "example.co.il",
  consent: true,
};

describe("validatePartnerApplication", () => {
  it("accepts a full application and normalizes it", () => {
    const r = validatePartnerApplication(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      name: "דנה כהן",
      office: "כהן רואי חשבון",
      city: "חיפה",
      email: "dana@example.co.il",
      phone: "04-123-4567",
      website: "https://example.co.il",
      ref: null,
    });
  });

  it("keeps optional fields null when they are empty", () => {
    const r = validatePartnerApplication({ name: "דנה כהן", city: "חיפה", email: "d@example.com", consent: true });
    expect(r.ok && r.value.office).toBeNull();
    expect(r.ok && r.value.phone).toBeNull();
    expect(r.ok && r.value.website).toBeNull();
  });

  it("refuses without consent: the row is the written consent to be listed", () => {
    expect(validatePartnerApplication({ ...good, consent: false }).ok).toBe(false);
    expect(validatePartnerApplication({ ...good, consent: "on" }).ok).toBe(false);
  });

  it("refuses a filled honeypot", () => {
    expect(validatePartnerApplication({ ...good, company: "Acme" }).ok).toBe(false);
  });

  it("refuses bad shapes at the boundary", () => {
    expect(validatePartnerApplication({ ...good, name: "א" }).ok).toBe(false);
    expect(validatePartnerApplication({ ...good, city: "" }).ok).toBe(false);
    expect(validatePartnerApplication({ ...good, email: "not-an-email" }).ok).toBe(false);
    expect(validatePartnerApplication({ ...good, email: "a%b@example.com" }).ok).toBe(false);
    expect(validatePartnerApplication({ ...good, phone: "call me" }).ok).toBe(false);
    expect(validatePartnerApplication({ ...good, website: "javascript:alert(1)" }).ok).toBe(false);
    expect(validatePartnerApplication({ ...good, name: "x".repeat(81) }).ok).toBe(false);
    // One emoji is two UTF-16 units but one character to the database CHECK.
    expect(validatePartnerApplication({ ...good, name: String.fromCodePoint(0x1f600) }).ok).toBe(false);
    expect(validatePartnerApplication(null).ok).toBe(false);
  });

  it("carries a valid referral slug and drops an invalid one", () => {
    const a = validatePartnerApplication({ ...good, ref: "HSCPA" });
    expect(a.ok && a.value.ref).toBe("hscpa");
    const b = validatePartnerApplication({ ...good, ref: "no good" });
    expect(b.ok && b.value.ref).toBeNull();
  });

  it("offers ten founding slots", () => {
    expect(FOUNDING_SLOTS).toBe(10);
  });
});
