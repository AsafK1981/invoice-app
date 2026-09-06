import { describe, it, expect } from "vitest";
import {
  DUNNING_STAGES,
  DUNNING_SUBJECTS,
  DUNNING_TONES,
  PRE_STAGE_TONE,
  daysSinceIssue,
  dunningStageFor,
  fillDunningVars,
  whatsappReminderText,
  type DunningStage,
} from "@/lib/dunning-copy";

const BASE = {
  businessName: "אולפני קוטלר",
  clientName: "דני לוי",
  number: 137,
  total: 2340,
  date: "01.08.2026",
  viewUrl: "https://friendlyinvoice.co.il/view/abc-123",
};

// Every reminder string a client can ever read, in one list, so the
// no-long-dash rule is checked on the copy as a whole and not per test.
const ALL_COPY = [
  ...Object.values(DUNNING_SUBJECTS),
  ...Object.values(DUNNING_TONES).flatMap((t) => [t.intro, t.cta, t.signoff]),
  PRE_STAGE_TONE.intro,
  PRE_STAGE_TONE.cta,
  PRE_STAGE_TONE.signoff,
];

describe("dunning stages", () => {
  it("picks the highest stage reached, and nothing before day 3", () => {
    expect(dunningStageFor(0)).toBe(null);
    expect(dunningStageFor(2)).toBe(null);
    expect(dunningStageFor(3)).toBe(3);
    expect(dunningStageFor(13)).toBe(3);
    expect(dunningStageFor(14)).toBe(14);
    expect(dunningStageFor(29)).toBe(14);
    expect(dunningStageFor(30)).toBe(30);
    expect(dunningStageFor(400)).toBe(30);
  });

  it("counts whole calendar days from the issue date", () => {
    expect(daysSinceIssue("2026-08-01", new Date(2026, 7, 1, 23, 59))).toBe(0);
    expect(daysSinceIssue("2026-08-01", new Date(2026, 7, 4, 0, 5))).toBe(3);
    expect(daysSinceIssue("2026-08-01", new Date(2026, 7, 31, 12, 0))).toBe(30);
  });

  it("has a tone and a subject for every stage", () => {
    for (const stage of DUNNING_STAGES) {
      expect(DUNNING_SUBJECTS[stage]).toBeTruthy();
      expect(DUNNING_TONES[stage].intro).toBeTruthy();
      expect(DUNNING_TONES[stage].cta).toBeTruthy();
    }
  });
});

describe("fillDunningVars", () => {
  it("fills known placeholders and blanks unknown ones", () => {
    expect(fillDunningVars("מספר {n} על סך ₪{total} מ-{date}", { n: "7", total: "1,000", date: "01.08.2026" }))
      .toBe("מספר 7 על סך ₪1,000 מ-01.08.2026");
    expect(fillDunningVars("שלום {missing}", {})).toBe("שלום ");
  });
});

describe("whatsappReminderText", () => {
  const stages: DunningStage[] = [3, 14, 30];

  for (const stage of stages) {
    it(`renders stage ${stage} with the variables filled and the link last`, () => {
      const text = whatsappReminderText({ ...BASE, days: stage, stage });
      expect(text).not.toContain("{");
      expect(text).toContain("שלום דני לוי,");
      expect(text).toContain("137");
      expect(text).toContain("2,340");
      expect(text).toContain(DUNNING_TONES[stage].signoff);
      expect(text.trimEnd().endsWith("אולפני קוטלר")).toBe(true);
      // The view link is the last thing before the signature block.
      const linkAt = text.indexOf(BASE.viewUrl);
      expect(linkAt).toBeGreaterThan(text.indexOf("שלום דני לוי,"));
      expect(linkAt).toBeLessThan(text.indexOf(DUNNING_TONES[stage].signoff));
    });
  }

  it("uses the day-14 and day-30 tones only from day 14 and 30", () => {
    const early = whatsappReminderText({ ...BASE, days: 5, stage: dunningStageFor(5) });
    expect(early).toContain("מקווה שהמסמך הגיע בסדר");
    const late = whatsappReminderText({ ...BASE, days: 33, stage: dunningStageFor(33) });
    expect(late).toContain("חלפו 33 ימים");
  });

  it("uses the neutral wording before day 3, with the variables filled", () => {
    const text = whatsappReminderText({ ...BASE, days: 1, stage: null });
    expect(text).toContain("שלחתי לך את החשבונית מספר 137");
    expect(text).toContain("אשמח לתשלום");
    expect(text).toContain("על סך ₪2,340");
    expect(text).not.toContain("{");
    expect(text).not.toContain("חלפו");
    expect(text).toContain(BASE.viewUrl);
    expect(text.trimEnd().endsWith("אולפני קוטלר")).toBe(true);
  });

  it("never claims the app sent anything by itself", () => {
    for (const stage of [null, 3, 14, 30] as Array<DunningStage | null>) {
      const text = whatsappReminderText({ ...BASE, days: stage ?? 1, stage });
      expect(text).not.toContain("נשלח אוטומטית");
      expect(text).not.toContain("הודעה אוטומטית");
    }
  });
});

describe("reminder copy hygiene", () => {
  it("uses plain hyphens, never a long dash", () => {
    // Built from char codes on purpose: the long-dash characters are banned
    // from this repo's source, including from the test that forbids them.
    const LONG_DASHES = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];
    for (const line of ALL_COPY) {
      for (const dash of LONG_DASHES) {
        expect(line.includes(dash), `long dash in: ${line}`).toBe(false);
      }
    }
  });
});
