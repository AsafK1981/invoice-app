import { describe, it, expect } from "vitest";
import {
  detectRecurringPatterns,
  alreadyBilledForPeriod,
  findConflictingProposal,
  isPatternMuted,
  monthsBackStart,
  patternClientKey,
  patternSource,
  periodMinusMonths,
  textNamesPeriod,
  type OpenProposalRow,
  type RecurringSourceDoc,
} from "@/lib/recurring-patterns";
import { documentSignature } from "@/lib/recurring-prefill";

let seq = 0;

function doc(overrides: Partial<RecurringSourceDoc> = {}): RecurringSourceDoc {
  seq++;
  return {
    id: "d" + seq,
    number: 1000 + seq,
    type: "receipt",
    status: "paid",
    date: "2026-06-01",
    clientId: "c1",
    clientName: "גין דין ענה",
    subject: "שכר דירה יוני 2026",
    notes: null,
    currency: "ILS",
    items: [{ description: "שכר דירה יוני 2026", quantity: 1, unitPrice: 3200 }],
    ...overrides,
  };
}

/** Three monthly rent receipts, on `days[i]` of June/July/August 2026. */
function rentHistory(days: [number, number, number] = [1, 1, 2]): RecurringSourceDoc[] {
  const months: [string, string][] = [
    ["2026-06", "יוני"],
    ["2026-07", "יולי"],
    ["2026-08", "אוגוסט"],
  ];
  return months.map(([month, name], i) =>
    doc({
      date: `${month}-${String(days[i]).padStart(2, "0")}`,
      subject: `שכר דירה ${name} 2026`,
      items: [{ description: `שכר דירה ${name} 2026`, quantity: 1, unitPrice: 3200 }],
    }),
  );
}

describe("detectRecurringPatterns", () => {
  it("finds a monthly rent receipt and rolls the subject forward", () => {
    const patterns = detectRecurringPatterns(rentHistory(), { today: "2026-09-01" });
    expect(patterns).toHaveLength(1);
    const p = patterns[0];
    expect(p.occurrences).toBe(3);
    expect(p.dayOfMonth).toBe(1);
    expect(p.documentType).toBe("receipt");
    expect(p.clientName).toBe("גין דין ענה");
    expect(p.period).toBe("2026-09");
    expect(p.targetDate).toBe("2026-09-01");
    expect(p.due).toBe(true);
    expect(p.subject).toBe("שכר דירה ספטמבר 2026");
    expect(p.items).toEqual([
      { description: "שכר דירה ספטמבר 2026", quantity: 1, unitPrice: 3200 },
    ]);
    expect(p.lastDocDate).toBe("2026-08-02");
    expect(p.source).toBe(patternSource("receipt", "c1", p.signature));
    expect(p.source.startsWith("pattern:")).toBe(true);
  });

  it("is due only inside [day - 1, day + tolerance]", () => {
    const history = rentHistory([15, 15, 15]);
    const on = (today: string) => detectRecurringPatterns(history, { today })[0];
    expect(on("2026-09-13").due).toBe(false);
    expect(on("2026-09-14").due).toBe(true);
    expect(on("2026-09-15").due).toBe(true);
    expect(on("2026-09-18").due).toBe(true);
    expect(on("2026-09-19").due).toBe(false);
    expect(on("2026-09-15").windowStart).toBe("2026-09-14");
    expect(on("2026-09-15").windowEnd).toBe("2026-09-18");
  });

  it("keeps a day-1 window inside its own month", () => {
    const p = detectRecurringPatterns(rentHistory([1, 1, 1]), { today: "2026-09-01" })[0];
    expect(p.windowStart).toBe("2026-09-01");
    expect(p.windowEnd).toBe("2026-09-04");
  });

  it("needs three occurrences - two is not a cadence", () => {
    const history = rentHistory().slice(1);
    expect(detectRecurringPatterns(history, { today: "2026-09-01" })).toEqual([]);
  });

  it("needs three DISTINCT months - three documents in two months is not a cadence", () => {
    const history = [
      doc({ date: "2026-07-01", subject: "שכר דירה יולי 2026" }),
      doc({ date: "2026-07-20", subject: "שכר דירה יולי 2026" }),
      doc({ date: "2026-08-01", subject: "שכר דירה אוגוסט 2026" }),
    ];
    expect(detectRecurringPatterns(history, { today: "2026-09-01" })).toEqual([]);
  });

  it("rejects irregular gaps", () => {
    const history = [
      doc({ date: "2026-03-01", subject: "שכר דירה מרץ 2026" }),
      doc({ date: "2026-06-01", subject: "שכר דירה יוני 2026" }),
      doc({ date: "2026-08-01", subject: "שכר דירה אוגוסט 2026" }),
    ];
    expect(detectRecurringPatterns(history, { today: "2026-09-01" })).toEqual([]);
  });

  it("clamps a day-31 cadence into a 30-day target month", () => {
    const history = [
      doc({ date: "2026-06-30", subject: "ייעוץ יוני 2026" }),
      doc({ date: "2026-07-31", subject: "ייעוץ יולי 2026" }),
      doc({ date: "2026-08-31", subject: "ייעוץ אוגוסט 2026" }),
    ];
    const p = detectRecurringPatterns(history, { today: "2026-09-30" })[0];
    expect(p.dayOfMonth).toBe(31);
    expect(p.targetDay).toBe(30);
    expect(p.targetDate).toBe("2026-09-30");
    expect(p.windowEnd).toBe("2026-09-30");
    expect(p.due).toBe(true);
  });

  it("takes the template from the monthly cadence, not a same-month top-up", () => {
    const history = [
      ...rentHistory(),
      // A second August receipt: an extra hour billed on the 20th, different
      // price. It must not become September's proposal.
      doc({
        date: "2026-08-20",
        subject: "שכר דירה אוגוסט 2026",
        items: [{ description: "שכר דירה אוגוסט 2026", quantity: 1, unitPrice: 550 }],
      }),
    ];
    const p = detectRecurringPatterns(history, { today: "2026-09-01" })[0];
    expect(p.items[0].unitPrice).toBe(3200);
    expect(p.lastDocDate).toBe("2026-08-02");
    expect(p.occurrences).toBe(3);
  });

  it("excludes quotes - an offer is not a recurring bill", () => {
    const quotes = rentHistory().map((d) => ({ ...d, type: "quote" as const }));
    expect(detectRecurringPatterns(quotes, { today: "2026-09-01" })).toEqual([]);
  });

  it("proposes the other billable types", () => {
    for (const type of ["receipt", "proforma", "tax_invoice", "tax_invoice_receipt"] as const) {
      const history = rentHistory().map((d) => ({ ...d, type }));
      expect(detectRecurringPatterns(history, { today: "2026-09-01" })).toHaveLength(1);
    }
  });

  it("excludes zero-rated, discounted and withheld documents", () => {
    const zero = rentHistory().map((d) => ({ ...d, zeroRated: true }));
    expect(detectRecurringPatterns(zero, { today: "2026-09-01" })).toEqual([]);
    const discounted = rentHistory().map((d) => ({ ...d, discountAmount: 100 }));
    expect(detectRecurringPatterns(discounted, { today: "2026-09-01" })).toEqual([]);
    const withheld = rentHistory().map((d) => ({ ...d, withholdingAmount: 320 }));
    expect(detectRecurringPatterns(withheld, { today: "2026-09-01" })).toEqual([]);
    // A zero on either field is the normal case and stays in.
    const plain = rentHistory().map((d) => ({
      ...d,
      zeroRated: false,
      discountAmount: 0,
      withholdingAmount: 0,
    }));
    expect(detectRecurringPatterns(plain, { today: "2026-09-01" })).toHaveLength(1);
  });

  it("excludes drafts, cancelled documents and credit notes", () => {
    const base = rentHistory();
    expect(
      detectRecurringPatterns([{ ...base[0], status: "draft" }, base[1], base[2]], {
        today: "2026-09-01",
      }),
    ).toEqual([]);
    expect(
      detectRecurringPatterns([{ ...base[0], status: "cancelled" }, base[1], base[2]], {
        today: "2026-09-01",
      }),
    ).toEqual([]);
    const credits = rentHistory().map((d) => ({ ...d, type: "credit_note" as const }));
    expect(detectRecurringPatterns(credits, { today: "2026-09-01" })).toEqual([]);
  });

  it("excludes foreign-currency documents (the approve path issues in ILS)", () => {
    const eur = rentHistory().map((d) => ({ ...d, currency: "EUR" }));
    expect(detectRecurringPatterns(eur, { today: "2026-09-01" })).toEqual([]);
  });

  it("does not mix two clients or two document types into one pattern", () => {
    const mixed = [
      ...rentHistory(),
      ...rentHistory().map((d, i) => ({
        ...d,
        id: "x" + i,
        clientId: "c2",
        clientName: "לקוח אחר",
      })),
    ];
    const patterns = detectRecurringPatterns(mixed, { today: "2026-09-01" });
    expect(patterns).toHaveLength(2);
    expect(new Set(patterns.map((p) => p.clientKey))).toEqual(new Set(["c1", "c2"]));

    const typeMixed = [
      ...rentHistory(),
      ...rentHistory().map((d, i) => ({ ...d, id: "y" + i, type: "proforma" as const })),
    ];
    expect(detectRecurringPatterns(typeMixed, { today: "2026-09-01" })).toHaveLength(2);
  });

  it("groups unlinked documents by normalised client name", () => {
    const history = rentHistory().map((d, i) => ({
      ...d,
      clientId: null,
      clientName: i === 1 ? "גין  דין ענה " : "גין דין ענה",
    }));
    const patterns = detectRecurringPatterns(history, { today: "2026-09-01" });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].clientKey).toBe("גין דין ענה");
    expect(patterns[0].clientId).toBeNull();
  });

  it("ignores documents older than the lookback window", () => {
    const history = rentHistory();
    expect(
      detectRecurringPatterns(history, { today: "2026-09-01", lookbackMonths: 2 }),
    ).toEqual([]);
  });

  it("stops proposing a cadence that already ended", () => {
    // Same three receipts, but the newest is two months behind the target
    // month: the owner stopped billing this client in August.
    expect(detectRecurringPatterns(rentHistory(), { today: "2026-10-01" })).toEqual([]);
    // One month behind is still ongoing (the September card is the point).
    expect(detectRecurringPatterns(rentHistory(), { today: "2026-09-01" })).toHaveLength(1);
  });

  it("copies the newest document's notes onto the template", () => {
    const history = rentHistory();
    history[2].notes = "  תשלום עבור אוגוסט 2026, עד ה-10 לחודש  ";
    const p = detectRecurringPatterns(history, { today: "2026-09-01" })[0];
    // Rolled forward like the subject: both print on the same document.
    expect(p.notes).toBe("תשלום עבור ספטמבר 2026, עד ה-10 לחודש");
    expect(p.lastDocId).toBe(history[2].id);
    expect(p.lastDocNumber).toBe(history[2].number);
  });

  it("gives the same source across months, and different sources for different work", () => {
    const august = detectRecurringPatterns(rentHistory(), { today: "2026-08-03" })[0];
    const september = detectRecurringPatterns(rentHistory(), { today: "2026-09-01" })[0];
    expect(august.source).toBe(september.source);

    const other = detectRecurringPatterns(
      rentHistory().map((d) => ({
        ...d,
        subject: "ועד בית",
        items: [{ description: "ועד בית", quantity: 1, unitPrice: 300 }],
      })),
      { today: "2026-09-01" },
    )[0];
    expect(other.source).not.toBe(september.source);
  });
});

describe("alreadyBilledForPeriod", () => {
  const pattern = detectRecurringPatterns(rentHistory(), { today: "2026-09-01" })[0];

  it("is false when the month holds nothing matching", () => {
    expect(alreadyBilledForPeriod(rentHistory(), pattern, "2026-09")).toBe(false);
  });

  it("is true once the owner issued it by hand", () => {
    const history = [
      ...rentHistory(),
      doc({
        date: "2026-09-01",
        subject: "שכר דירה ספטמבר 2026",
        items: [{ description: "שכר דירה ספטמבר 2026", quantity: 1, unitPrice: 3400 }],
      }),
    ];
    expect(alreadyBilledForPeriod(history, pattern, "2026-09")).toBe(true);
  });

  it("does not count another client's document in the same month", () => {
    const history = [
      ...rentHistory(),
      doc({ date: "2026-09-01", clientId: "c9", clientName: "מישהו אחר" }),
    ];
    expect(alreadyBilledForPeriod(history, pattern, "2026-09")).toBe(false);
  });

  it("catches a bill issued in advance at the end of the previous month", () => {
    const history = [
      ...rentHistory(),
      doc({
        date: "2026-08-30",
        subject: "שכר דירה ספטמבר 2026",
        items: [{ description: "שכר דירה ספטמבר 2026", quantity: 1, unitPrice: 3200 }],
      }),
    ];
    expect(alreadyBilledForPeriod(history, pattern, "2026-09")).toBe(true);
  });

  it("catches an advance bill that names the period numerically", () => {
    for (const naming of ["שכר דירה 9/2026", "שכר דירה 09.26", "שכר דירה 9-26"]) {
      const history = [
        ...rentHistory(),
        doc({
          date: "2026-08-28",
          subject: naming,
          items: [{ description: naming, quantity: 1, unitPrice: 3200 }],
        }),
      ];
      expect(alreadyBilledForPeriod(history, pattern, "2026-09")).toBe(true);
    }
  });

  it("does NOT treat the previous cadence occurrence as an advance bill", () => {
    // rentHistory's newest document is "שכר דירה אוגוסט 2026" dated 2.8.
    expect(alreadyBilledForPeriod(rentHistory(), pattern, "2026-09")).toBe(false);
    const onTheFirst = [
      doc({
        date: "2026-08-01",
        subject: "שכר דירה אוגוסט 2026",
        items: [{ description: "שכר דירה אוגוסט 2026", quantity: 1, unitPrice: 3200 }],
      }),
    ];
    expect(alreadyBilledForPeriod(onTheFirst, pattern, "2026-09")).toBe(false);
  });

  it("ignores an advance-looking document from two months back", () => {
    const history = [
      doc({
        date: "2026-07-30",
        subject: "שכר דירה ספטמבר 2026",
        items: [{ description: "שכר דירה ספטמבר 2026", quantity: 1, unitPrice: 3200 }],
      }),
    ];
    expect(alreadyBilledForPeriod(history, pattern, "2026-09")).toBe(false);
  });
});

describe("isPatternMuted", () => {
  it("is false with no history", () => {
    expect(isPatternMuted([], "2026-09")).toBe(false);
  });

  it("is false after a single dismissal", () => {
    expect(
      isPatternMuted([{ period: "2026-08", status: "dismissed", details: {} }], "2026-09"),
    ).toBe(false);
  });

  it("is true after two consecutive dismissals", () => {
    expect(
      isPatternMuted(
        [
          { period: "2026-08", status: "dismissed", details: {} },
          { period: "2026-07", status: "dismissed", details: {} },
        ],
        "2026-09",
      ),
    ).toBe(true);
  });

  it("is false when the last answer was an approval", () => {
    expect(
      isPatternMuted(
        [
          { period: "2026-08", status: "approved", details: {} },
          { period: "2026-07", status: "dismissed", details: {} },
        ],
        "2026-09",
      ),
    ).toBe(false);
  });

  it("does not count the current period's own row as a dismissal", () => {
    expect(
      isPatternMuted(
        [
          { period: "2026-09", status: "dismissed", details: {} },
          { period: "2026-08", status: "dismissed", details: {} },
        ],
        "2026-09",
      ),
    ).toBe(false);
  });

  it("lets old dismissals decay - two last winter do not mute in July", () => {
    expect(
      isPatternMuted(
        [
          { period: "2026-02", status: "dismissed", details: {} },
          { period: "2026-01", status: "dismissed", details: {} },
        ],
        "2026-07",
      ),
    ).toBe(false);
  });

  it("still mutes on two recent dismissals, even when not calendar-consecutive", () => {
    expect(
      isPatternMuted(
        [
          { period: "2026-06", status: "dismissed", details: {} },
          { period: "2026-04", status: "dismissed", details: {} },
        ],
        "2026-07",
      ),
    ).toBe(true);
  });

  it("is true on an explicit mute flag, whatever else happened", () => {
    expect(
      isPatternMuted(
        [{ period: "2026-08", status: "dismissed", details: { mute: true, pattern: {} } }],
        "2026-09",
      ),
    ).toBe(true);
  });

  it("never decays an explicit mute", () => {
    expect(
      isPatternMuted(
        [{ period: "2025-01", status: "dismissed", details: { mute: true } }],
        "2026-09",
      ),
    ).toBe(true);
  });

  it("ignores a mute flag on a row that was not dismissed", () => {
    expect(
      isPatternMuted([{ period: "2026-08", status: "approved", details: { mute: true } }], "2026-09"),
    ).toBe(false);
  });
});

describe("period helpers", () => {
  it("walks months back across a year boundary", () => {
    expect(periodMinusMonths("2026-09", 4)).toBe("2026-05");
    expect(periodMinusMonths("2026-02", 4)).toBe("2025-10");
    expect(periodMinusMonths("2026-01", 1)).toBe("2025-12");
    expect(monthsBackStart("2026-01-15", 1)).toBe("2025-12-01");
    expect(monthsBackStart("2026-09-30", 12)).toBe("2025-09-01");
  });
});

describe("textNamesPeriod", () => {
  it("recognises the Hebrew month name, with or without a prefix", () => {
    expect(textNamesPeriod("שכר דירה ספטמבר 2026", "2026-09")).toBe(true);
    expect(textNamesPeriod("שכר דירה לספטמבר", "2026-09")).toBe(true);
    expect(textNamesPeriod("ספטמבר", "2026-09")).toBe(true);
    expect(textNamesPeriod("שכר דירה אוגוסט 2026", "2026-09")).toBe(false);
  });

  it("accepts מרס as March", () => {
    expect(textNamesPeriod("ייעוץ מרס", "2026-03")).toBe(true);
    expect(textNamesPeriod("ייעוץ מרץ", "2026-03")).toBe(true);
  });

  it("recognises numeric periods but not a full date", () => {
    expect(textNamesPeriod("חשבון 9/2026", "2026-09")).toBe(true);
    expect(textNamesPeriod("חשבון 09/26", "2026-09")).toBe(true);
    expect(textNamesPeriod("חשבון 09-2026", "2026-09")).toBe(true);
    expect(textNamesPeriod("חשבון 8/2026", "2026-09")).toBe(false);
    expect(textNamesPeriod("חשבון 19/2026", "2026-09")).toBe(false);
    expect(textNamesPeriod("הופק ב-01/09/2026", "2026-09")).toBe(false);
  });

  it("is false for empty input", () => {
    expect(textNamesPeriod("", "2026-09")).toBe(false);
    expect(textNamesPeriod(null, "2026-09")).toBe(false);
  });
});

describe("patternClientKey", () => {
  it("prefers the client id and falls back to the normalised name", () => {
    expect(patternClientKey("c1", "גין דין ענה")).toBe("c1");
    expect(patternClientKey(null, "  גין  דין ענה ")).toBe("גין דין ענה");
    expect(patternClientKey(null, "")).toBe("");
  });
});

describe("findConflictingProposal", () => {
  // A September pattern for the פיניש cadence. Its signature is the
  // month-stripped subject family, so it must collide with the gigs card
  // even though that card carries a DIFFERENT period (finish-gigs bills in
  // arrears: the card created on 1.9 has period 2026-08).
  const gigItems = [{ description: "הופעה - נגינה" }];
  const pattern = {
    source: "pattern:abcd1234",
    clientId: "c-teamteddy",
    clientName: "טים טדי בע\"מ",
    clientKey: "c-teamteddy",
    signature: documentSignature({ subject: "הופעות עם פיניש - ספטמבר 2026", items: gigItems }),
  };
  const currentPeriod = "2026-09";

  function row(overrides: Partial<OpenProposalRow> = {}): OpenProposalRow {
    return {
      source: "finish-gigs",
      period: "2026-08",
      status: "pending",
      clientId: "c-teamteddy",
      clientName: "טים טדי בע\"מ",
      subject: "הופעות עם פיניש - אוגוסט 2026",
      items: gigItems,
      ...overrides,
    };
  }

  it("a pending arrears-billed card from another producer blocks the pattern", () => {
    expect(findConflictingProposal([row()], pattern, currentPeriod)).not.toBeNull();
  });

  it("an approved card in the window still blocks (belt under alreadyBilledForPeriod)", () => {
    expect(
      findConflictingProposal([row({ status: "approved", period: "2026-09" })], pattern, currentPeriod),
    ).not.toBeNull();
  });

  it("a different signature for the same client does not block", () => {
    const other = row({
      subject: "ליווי חודשי - אוגוסט 2026",
      items: [{ description: "ליווי אמנותי" }],
    });
    expect(findConflictingProposal([other], pattern, currentPeriod)).toBeNull();
  });

  it("a dismissed card does not block", () => {
    expect(findConflictingProposal([row({ status: "dismissed" })], pattern, currentPeriod)).toBeNull();
  });

  it("the pattern's own source does not block itself", () => {
    expect(
      findConflictingProposal([row({ source: pattern.source })], pattern, currentPeriod),
    ).toBeNull();
  });

  it("a card older than the previous period does not block", () => {
    expect(findConflictingProposal([row({ period: "2026-07" })], pattern, currentPeriod)).toBeNull();
  });

  it("a different linked client does not block", () => {
    expect(
      findConflictingProposal([row({ clientId: "c-someone-else" })], pattern, currentPeriod),
    ).toBeNull();
  });
});
