import type { Metadata } from "next";
import Link from "next/link";
import { Ltr } from "@/components/ui/ltr";
import HeaderV2 from "./components/HeaderV2";
import FooterV2 from "./components/FooterV2";
import RedirectIfAuthed from "./components/RedirectIfAuthed";
import JsonLd from "./components/JsonLd";
import { graph, organization, website, softwareApplication, faqPage } from "@/lib/jsonld";

/**
 * Landing-page FAQ. Every answer is a factual claim about THIS app, verified
 * against the actual code before writing (not generic SaaS marketing copy):
 *   - launch-period billing: no plan-enforcement/auto-charge code exists;
 *     the only way to start paying is the explicit checkout flow in
 *     src/app/api/billing/checkout/route.ts, which always requires the user
 *     to click "subscribe" and complete a hosted checkout.
 *   - no credit card required to start: src/lib/plans.ts docstring
 *     ("Trial: 30 days, no credit card required") + the /billing page's
 *     own launch-period banner.
 *   - cancel anytime: src/app/(app)/billing/page.tsx cancel flow keeps
 *     access until period end, no lock-in.
 *   - allocation numbers: src/lib/tax-authority.ts + the one-click flow in
 *     src/app/api/tax-authority/request-allocation/route.ts (server-side
 *     API call to רשות המסים, not a manual copy/paste form).
 * This list is also fed into faqPage() below so the same questions are
 * eligible for a rich FAQ result, kept in sync by construction, no
 * duplicate copy to drift.
 */
const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "מה קורה כשתקופת ההשקה נגמרת?",
    a: "שום חיוב לא מתבצע אוטומטית. כדי לעבור למסלול בתשלום צריך להירשם במפורש דרך עמוד החיוב ולאשר את הפרטים - בלי הפתעות בכרטיס האשראי.",
  },
  {
    q: "האם צריך כרטיס אשראי כדי להתחיל?",
    a: "לא. אפשר להתחיל להשתמש במערכת בלי להזין פרטי אשראי.",
  },
  {
    q: "האם אפשר לבטל בכל עת?",
    a: "כן. ביטול נעשה בלחיצה מתוך עמוד \"חיוב ומסלולים\", והגישה נשארת פעילה עד סוף התקופה ששולמה.",
  },
  {
    q: "האם המסמכים עומדים בדרישות רשות המסים?",
    a: "כן. המערכת שומרת מספור רציף לכל סוג מסמך, מסמנת נכון מקור מול העתק לפי הוראות ניהול ספרים, ותומכת בבקשת מספר הקצאה מרשות המסים כשנדרש.",
  },
  {
    q: "מה זה מספר הקצאה ואיך זה עובד כאן?",
    a: "זה מספר שרשות המסים מנפיקה לחשבוניות מעל סכום מסוים (מ-2026: מעל 5,000 ש\"ח לפני מע\"מ ללקוח עסקי), נדרש כדי שהלקוח יוכל לנכות מע\"מ. אחרי חיבור חד-פעמי מול רשות המסים, המערכת מבקשת את המספר ישירות מולה בלחיצה אחת, בלי טפסים ידניים.",
  },
];

/**
 * Self-canonical only, and DELIBERATELY nothing else.
 *
 * A child route that specifies `openGraph` REPLACES the parent's entire
 * openGraph block rather than merging into it, the trap documented in
 * vs-metadata.ts, and how every /vs page once previewed as the homepage. The
 * root layout already sets the correct absolute og:url for `/`, so declaring
 * openGraph here could only make things worse. Title and description are
 * likewise inherited from the root on purpose.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * `/`, the public marketing landing: the "product showcase" composition
 * approved 2026-07-27.
 *
 * THE IDEA. The thing we sell is a document, so the document IS the hero: a
 * paper sheet rendered large on the obsidian stage, under one soft pool of
 * warm light, with the pitch orbiting it on the reading edge (RTL, so copy
 * right, sheet left). The copy column is `space-between`, which pins its top
 * group to the sheet's head and its CTA to the sheet's foot, with three
 * hairline-ruled feature rows carrying the span between them. Under the stage
 * a quiet hairline band states the launch pricing without competing.
 *
 * THE SHEET IS A PRESENTATIONAL ECHO, NOT THE REAL COMPONENT. The persuasive
 * premise is "this is what you get", so the markup below mirrors the real
 * printed document zone for zone (`src/components/document-body.tsx`): head
 * with identity block, "לכבוד" + allocation strip, itemised table under a gold
 * micro-label, the breakdown pushed to the inline end, the electronic-issuance
 * footer. It deliberately does NOT import `DocumentBody` or `document-paper.css`
 * - the printed sheet is a tax document and is frozen; a marketing page must
 * never be able to reach into it. The palette is copied by value into the
 * `--v2-paper-*` tokens in v2.css so the two cannot drift silently.
 *
 * Server-rendered so anonymous visitors and crawlers get the full page
 * immediately; `<RedirectIfAuthed />` then bounces an already-signed-in visitor
 * to /dashboard from the client, without ever blocking the anon render.
 */
export default function MarketingLanding() {
  return (
    <>
      <RedirectIfAuthed />
      <JsonLd
        data={graph(
          organization(),
          website(),
          softwareApplication(),
          faqPage(FAQ_ITEMS),
        )}
      />
      {/* deco outer frame */}
      <div className="v2-frame" aria-hidden="true">
        <i className="tl" />
        <i className="tr" />
        <i className="bl" />
        <i className="br" />
      </div>

      <HeaderV2 />

      <main id="main-content" className="v2-main">
        <div className="v2-wrap">
          <section className="v2-stage">
            <div className="v2-stage-in">
              {/* ---- the pitch, on the reading edge ---- */}
              <div className="v2-stage-copy">
                <div className="v2-stage-lead">
                  <div className="v2-eyebrow-row">
                    <span>לעצמאים בישראל</span>
                    <i className="ln" />
                  </div>

                  {/* Positioning note: this headline used to sell aesthetics
                      ("יוקרתית כמו העסק"). Every competitor in this market
                      already shouts "חינם", and prestige is not what an עצמאי
                      is anxious about in 2026 — the חשבונית ישראל allocation-
                      number mandate is. So the headline now leads with the
                      compliance pain we actually solve, and the look-and-feel
                      argument moved down into the lede where it still earns
                      its place. */}
                  <h1 className="v2-h1">
                    חשבונית שעומדת{" "}
                    <br />
                    בדרישות <span className="v2-gold">2026</span>
                  </h1>

                  <p className="v2-lede">
                    מספר הקצאה מרשות המסים אוטומטית, בלחיצה אחת - בלי טפסים
                    ובלי כאב ראש. וגם נראית יוקרתית כמו העסק שלך.
                  </p>
                </div>

                {/* Hairline-ruled rows. No boxes: the band is built from type,
                    space and two rules, so it supports the sheet instead of
                    competing with it for attention. */}
                <ul className="v2-feats">
                  <li className="v2-ft">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M13 3L4 14h7l-1 7 9-12h-7z" />
                    </svg>
                    <b>הפקה בשניות</b>
                  </li>
                  <li className="v2-ft">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
                      <path d="M9 12l2 2 4-4" />
                    </svg>
                    <b>הקצאה אוטומטית מרשות המסים</b>
                  </li>
                  <li className="v2-ft">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
                    </svg>
                    <b>שליחה בכל ערוץ</b>
                  </li>
                  <li className="v2-ft">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
                      <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
                    </svg>
                    <b>עוזר AI בעברית שמוצא כל מסמך</b>
                  </li>
                </ul>

                <div className="v2-stage-act">
                  <Link className="v2-cta" href="/login?mode=signup">
                    התחילו בחינם
                  </Link>
                  <p className="v2-fine">חינם עכשיו · ללא כרטיס אשראי</p>
                </div>
              </div>

              {/* ---- the product, as the object ---- */}
              <figure className="v2-sheet-wrap">
                <article className="v2-sheet">
                  <div className="v2-sh-card v2-sh-head">
                    <div className="v2-sh-biz">
                      <p className="v2-sh-name">סטודיו נועה</p>
                      <p className="v2-sh-bizline">
                        עוסק מורשה <Ltr>003244266</Ltr> · עיצוב גרפי ומיתוג
                        <br />
                        הרצל 12, תל אביב · <Ltr>054-1234567</Ltr> ·{" "}
                        <Ltr>noa@studio-noa.co.il</Ltr>
                      </p>
                    </div>
                    <div className="v2-sh-ident">
                      <div className="v2-sh-orig">מקור</div>
                      <div className="v2-sh-badge">חשבונית מס</div>
                      <div className="v2-sh-num">0042</div>
                      <div className="v2-sh-date">09.07.2026</div>
                    </div>
                  </div>

                  {/* Same DOM order as the real document's `.doc-strip`: the
                      customer first, so RTL puts "לכבוד" at the reading start
                      (right) and the allocation number after it (left), and the
                      customer stays on top when the strip stacks on mobile. */}
                  <div className="v2-sh-strip">
                    <div className="v2-sh-card v2-sh-mini">
                      <div className="v2-sh-glabel">לכבוד</div>
                      <div className="v2-sh-mini-v">סטודיו אורות בע״מ</div>
                      <div className="v2-sh-mini-sub">
                        ח.פ / ת.ז <Ltr>514738293</Ltr>
                      </div>
                    </div>
                    <div className="v2-sh-card v2-sh-mini">
                      <div className="v2-sh-glabel">מספר הקצאה · חשבונית ישראל</div>
                      <div className="v2-sh-mini-v is-gold">403581926</div>
                    </div>
                  </div>

                  <div className="v2-sh-card v2-sh-items">
                    <div className="v2-sh-glabel">פירוט</div>
                    <table className="v2-sh-table">
                      <thead>
                        <tr>
                          <th className="c-desc">תיאור</th>
                          <th className="c-qty">כמות</th>
                          <th className="c-num">סכום</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="c-desc">עיצוב לוגו ומיתוג</td>
                          <td className="c-qty">1</td>
                          <td className="c-total">3,200 ₪</td>
                        </tr>
                        <tr>
                          <td className="c-desc">דף נחיתה</td>
                          <td className="c-qty">1</td>
                          <td className="c-total">1,450 ₪</td>
                        </tr>
                        <tr>
                          <td className="c-desc">ייעוץ חזותי</td>
                          <td className="c-qty">1</td>
                          <td className="c-total">600 ₪</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="v2-sh-money">
                    <div className="v2-sh-card v2-sh-breakdown">
                      <div className="v2-sh-brow">
                        <span>סכום ביניים</span>
                        <span>5,250 ₪</span>
                      </div>
                      <div className="v2-sh-brow">
                        <span>
                          מע״מ <Ltr>18%</Ltr>
                        </span>
                        <span>945 ₪</span>
                      </div>
                      <div className="v2-sh-brow is-grand">
                        <span>סה״כ לתשלום</span>
                        <span className="v2-sh-grand">6,195 ₪</span>
                      </div>
                    </div>
                  </div>

                  {/* The separator is an explicit {" · "} expression, not two
                      JSX literals around a bare middot: the transform drops the
                      space that leads a multi-line text child, which silently
                      shipped "מספר הקצאה· נדרש". */}
                  <p className="v2-sh-note">
                    <b>מספר הקצאה</b>
                    {" · "}
                    נדרש בחשבונית מס ללקוח עסקי בסכום של 5,000&nbsp;₪ ומעלה לפני
                    מע״מ. המערכת מבקשת אותו מרשות המסים אוטומטית.
                  </p>

                  <div className="v2-sh-foot">
                    <div className="v2-sh-sig">מסמך זה הופק אלקטרונית</div>
                    <div className="v2-sh-brand">
                      הופק באמצעות{" "}
                      <Ltr>MyFriendlyInvoiceApp</Ltr>
                    </div>
                  </div>
                </article>
                <figcaption className="v2-sheet-cap">
                  כך נראית החשבונית שהמערכת מפיקה לך
                </figcaption>
              </figure>
            </div>
          </section>

          {/* The one genuinely rare capability (per the /vs comparison pages)
              was one bullet among three above, equal weight to generic
              claims. It earns its own quiet card here instead. */}
          <section className="v2-tax-band">
            <div className="v2-tax-band-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <div>
              <h2>הקצאה אוטומטית מרשות המסים, לא ידני ולא בהעתק-הדבק</h2>
              <p>
                מ-2026 חשבונית מעל 5,000 ש״ח לפני מע״מ ללקוח עסקי חייבת מספר
                הקצאה, אחרת הלקוח לא יכול לנכות מע״מ. אחרי חיבור חד-פעמי מול
                רשות המסים, המערכת מבקשת את המספר ישירות ממנה בלחיצה אחת
                ומציגה אותו על המסמך - בלי טפסים ובלי להעתיק תוצאה מאתר אחר.
              </p>
            </div>
          </section>

          {/* Launch pricing, deliberately quiet: two hairlines and type. The
              sheet is the only object on this page, so the offer states the
              facts and gets out of the way. */}
          <section className="v2-band">
            <div className="v2-band-offer">
              <p className="v2-band-now">בתקופת ההשקה, הכול חינם</p>
              <p className="v2-band-later">
                בהמשך, המסלולים יתחילו מ־₪15 לחודש · <Ltr>Pro</Ltr> ללא הגבלה
                ב־₪25
              </p>
            </div>
            <p className="v2-band-terms">
              ביטול בכל עת · נעדכן מראש לפני כל שינוי מחיר
            </p>
          </section>

          <section className="v2-faq">
            <h2 className="v2-faq-title">שאלות נפוצות</h2>
            {FAQ_ITEMS.map((item) => (
              <div className="v2-faq-item" key={item.q}>
                <p className="v2-faq-q">{item.q}</p>
                <p className="v2-faq-a">{item.a}</p>
              </div>
            ))}
          </section>

          <div className="v2-credit">
            <i className="ln" />
            <span>נבנה באהבה לעסקים עצמאיים בישראל</span>
            <i className="ln r" />
          </div>
        </div>
      </main>

      <FooterV2 />
    </>
  );
}
