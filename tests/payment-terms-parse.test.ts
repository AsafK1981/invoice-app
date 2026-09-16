import { describe, it, expect } from "vitest";
import { parsePaymentTerms, PAYMENT_TERMS_LABELS, PAYMENT_TERMS_ORDER, type PaymentTerms } from "@/lib/payment-terms";

const RECOGNISED: [string, PaymentTerms][] = [
  // our own codes
  ["immediate", "immediate"],
  ["net_15", "net_15"],
  ["net_60", "net_60"],
  ["eom", "eom"],
  ["eom_30", "eom_30"],
  ["eom_90", "eom_90"],
  ["  EOM_45 ", "eom_45"],
  // exact Hebrew labels (and with messy spacing)
  ["מיידי", "immediate"],
  ["15 יום מהחשבונית", "net_15"],
  ["30   יום  מהחשבונית", "net_30"],
  ["שוטף", "eom"],
  ["שוטף + 30", "eom_30"],
  // immediate spellings
  ["מידי", "immediate"],
  ["Immediate", "immediate"],
  ["due on receipt", "immediate"],
  ["Due  On  Receipt", "immediate"],
  // שוטף / eom
  ["EOM", "eom"],
  [" שוטף ", "eom"],
  ["שוטף+30", "eom_30"],
  ["שוטף +45", "eom_45"],
  ["שוטף+ 60", "eom_60"],
  ["שוטף  +  90", "eom_90"],
  ["שוטף 45", "eom_45"],
  ["שוטף פלוס 60", "eom_60"],
  ["eom+30", "eom_30"],
  ["EOM+90", "eom_90"],
  ["eom 45", "eom_45"],
  ["eom + 60", "eom_60"],
  // net N
  ["net 15", "net_15"],
  ["Net 30", "net_30"],
  ["NET45", "net_45"],
  ["net60", "net_60"],
  ["15 יום", "net_15"],
  ["30 ימים", "net_30"],
  ["45 days", "net_45"],
  ["60 Days", "net_60"],
  // non-breaking space from a spreadsheet
  ["שוטף + 30", "eom_30"],
];

const UNRECOGNISED: unknown[] = [
  "",
  "   ",
  undefined,
  null,
  30,
  "שוטף+120",
  "שוטף+0",
  "שוטף+15",
  "שוטף 30 יום",
  "שוטף30",
  "eom+15",
  "eom_120",
  "75 יום",
  "90 ימים",
  "net 90",
  "net 0",
  "net_90",
  "90",
  // A bare number is ambiguous (שוטף + 30 or 30 days from the invoice).
  "15",
  "30",
  " 45 ",
  "60",
  "0",
  "030",
  "30.5",
  "-30",
  "חודשיים",
  "חודש",
  "מזומן",
  "לפי היסטוריית התשלומים",
  "30 day",
  "net-30",
  "net 30 days",
  "toString",
  "constructor",
  "שוטף ועוד 30",
];

describe("parsePaymentTerms", () => {
  it.each(RECOGNISED)("reads %j as %s", (text, expected) => {
    expect(parsePaymentTerms(text)).toBe(expected);
  });

  it.each(UNRECOGNISED.map((v) => [v]))("never guesses: %j is undefined", (text) => {
    expect(parsePaymentTerms(text)).toBeUndefined();
  });

  it("round-trips every label the select offers", () => {
    for (const code of PAYMENT_TERMS_ORDER) {
      expect(parsePaymentTerms(PAYMENT_TERMS_LABELS[code])).toBe(code);
      expect(parsePaymentTerms(code)).toBe(code);
    }
  });
});
