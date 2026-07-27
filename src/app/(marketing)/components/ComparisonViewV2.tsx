import React from "react";
import Link from "next/link";
import {
  Sparkles,
  Check,
  X as XIcon,
  Minus,
  ArrowRight,
  Trophy,
  Gift,
} from "lucide-react";
import type { Competitor, FeatureSupport } from "@/lib/comparison-data";
import { Ltr, LtrText } from "@/components/ui/ltr";
import { VS_RELATED } from "@/lib/related-links";
import {
  APP_NAME_HE,
  graph,
  organization,
  softwareApplication,
  breadcrumbList,
} from "@/lib/jsonld";
import HeaderV2 from "./HeaderV2";
import FooterV2 from "./FooterV2";
import JsonLd from "./JsonLd";
import VsSiblings from "./VsSiblings";
import RelatedLinks from "./RelatedLinks";

/**
 * ComparisonViewV2, the shared body of every /vs/<competitor> page.
 *
 * Honest data + information design: pricing cards with a highlighted winner,
 * a feature-support matrix, pros/cons both ways, and a verdict. Two deliberate
 * legibility choices on the long feature table:
 *   1. Semantic colors are NOT brand-gold: green ✓ = supported, red ✗ =
 *      not supported, amber − = partial. Gold is reserved for accents, so a
 *      scanning eye never reads "gold" as "yes".
 *   2. Section grouping rows + zebra striping make the 15-row matrix
 *      scannable.
 *
 * Every competitor name and data string renders through `<LtrText>`: this is
 * RTL Hebrew copy with Latin brand names in it, and without a bidi isolate the
 * surrounding punctuation resolves against the wrong neighbour. The JSON-LD
 * block deliberately uses the RAW strings; it is machine-read, and bidi
 * markup would corrupt it.
 */

const APP_NAME = APP_NAME_HE;

const formatPrice = (nis: number) =>
  new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(nis);

/** Semantic support mark: green/red/amber, never gold. */
function Mark({ kind, note }: { kind: FeatureSupport; note?: string }) {
  const tone = kind === "yes" ? "yes" : kind === "no" ? "no" : "partial";
  const Icon = kind === "yes" ? Check : kind === "no" ? XIcon : Minus;
  const label =
    kind === "yes" ? "תומך" : kind === "no" ? "לא תומך" : "חלקי";
  return (
    <span
      className={`v2-mk ${tone}`}
      title={note ?? label}
      aria-label={note ? `${label}: ${note}` : label}
    >
      <Icon strokeWidth={3} />
    </span>
  );
}

/**
 * Logical grouping of the 15 shared features (indices into
 * `competitor.features`, whose order is fixed by SHARED_FEATURES). Purely
 * presentational; the data and its order are untouched.
 */
const FEATURE_GROUPS: { title: string; count: number }[] = [
  { title: "מסמכים והפקה", count: 5 }, // 0-4
  { title: "ניתוח, מעקב וייצוא", count: 4 }, // 5-8
  { title: "שליטה בנתונים, תאימות ושקיפות", count: 6 }, // 9-14
];

/** Slice the flat feature list into the presentational groups above. */
function groupFeatures(features: Competitor["features"]) {
  const groups: { title: string; rows: Competitor["features"] }[] = [];
  let offset = 0;
  for (const g of FEATURE_GROUPS) {
    groups.push({ title: g.title, rows: features.slice(offset, offset + g.count) });
    offset += g.count;
  }
  // Safety net: if the data ever grows past the mapped groups, show the
  // remainder in a catch-all so no feature is silently dropped.
  if (offset < features.length) {
    groups.push({ title: "נוספים", rows: features.slice(offset) });
  }
  return groups;
}

export function ComparisonViewV2({ competitor }: { competitor: Competitor }) {
  // Pricing "why it matters" mirrors the original: pick a mid tier on their
  // side as the realistic 20-50 docs/month comparison point.
  const midTier =
    competitor.pricing[Math.min(1, competitor.pricing.length - 1)];

  return (
    <>
      <JsonLd
        data={graph(
          organization(),
          softwareApplication(),
          breadcrumbList([
            { name: "בית", path: "/" },
            { name: "השוואות", path: "/vs" },
            { name: competitor.name, path: `/vs/${competitor.slug}` },
          ]),
        )}
      />

      {/* deco outer frame (matches the landing) */}
      <div className="v2-frame" aria-hidden="true">
        <i className="tl" />
        <i className="tr" />
        <i className="bl" />
        <i className="br" />
      </div>

      <HeaderV2 />

      <main className="v2-cmp">
        <Link href="/vs" className="v2-back">
          <ArrowRight />
          חזרה לכל ההשוואות
        </Link>

        {/* Hero */}
        <header className="v2-cmp-hero">
          <h1>
            <span className="v2-gold">{APP_NAME}</span>{" "}
            <span className="vs">מול</span>{" "}
            <LtrText text={competitor.name} />
          </h1>
          <p className="verdict">
            <LtrText text={competitor.verdict} />
          </p>
          <p className="src">
            השוואה הוגנת · נתוני המתחרה מ-
            <LtrText text={competitor.url.replace("https://", "")} /> (עודכן
            5/2026)
          </p>
        </header>

        {/* Pricing comparison */}
        <section className="v2-cmp-sec">
          <div className="v2-cmp-h">
            <h2>השוואת מחירים</h2>
            <span className="ln" />
          </div>

          <div className="v2-price-grid">
            {/* Us: highlighted winner */}
            <div className="v2-price-card win">
              <span className="badge">
                <Trophy />
                הכי משתלם
              </span>
              <h3 className="v2-gold">{APP_NAME}</h3>
              <ul>
                <li>
                  <span className="plan">בסיסי</span>
                  <span className="val">
                    {formatPrice(15)} / חודש · 30 מסמכים
                  </span>
                </li>
                <li>
                  <span className="plan">
                    <Ltr>Pro</Ltr>
                  </span>
                  <span className="val">{formatPrice(25)} / חודש · ללא הגבלה</span>
                </li>
                <li>
                  <span className="plan">חיוב שנתי</span>
                  <span className="val">~17% הנחה</span>
                </li>
                <li className="trial">
                  <span className="plan">חינם עכשיו</span>
                  <span className="val">
                    כל הפיצ׳רים בתקופת ההשקה · בלי כרטיס אשראי
                  </span>
                </li>
              </ul>
            </div>

            {/* Them */}
            <div className="v2-price-card">
              <h3>
                <LtrText text={competitor.name} />
              </h3>
              <ul>
                {competitor.pricing.map((p) => (
                  <li key={p.name}>
                    <span className="plan">
                      <LtrText text={p.name} />
                    </span>
                    <span className="val">
                      {formatPrice(p.priceMonthly)} / חודש ·{" "}
                      <LtrText text={p.docs} />
                    </span>
                  </li>
                ))}
                <li className="trial">
                  <span className="plan">ניסיון חינם</span>
                  <span className="val">
                    <LtrText text={competitor.freeTrial} />
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <p className="v2-price-note">
            <strong>למה זה משנה: </strong>
            עצמאי טיפוסי מפיק 20-50 מסמכים בחודש. מסלול שמתאים לכך ב-
            <LtrText text={competitor.name} /> עולה{" "}
            {formatPrice(midTier.priceMonthly)} ומעלה. אצלנו <Ltr>Pro</Ltr> ללא
            הגבלה הוא {formatPrice(25)} בלבד. וכרגע, בתקופת ההשקה, הכול חינם
            אצלנו, בלי כרטיס אשראי. המחירים האלה ייכנסו לתוקף בהמשך, ונעדכן
            מראש.
          </p>
        </section>

        {/* Feature comparison */}
        <section className="v2-cmp-sec">
          <div className="v2-cmp-h">
            <h2>השוואת פיצ׳רים</h2>
            <span className="ln" />
          </div>

          <div className="v2-panel v2-matrix">
            <div className="v2-matrix-scroll">
              <table className="v2-table">
                <thead>
                  <tr>
                    <th className="feat">פיצ׳ר</th>
                    <th className="col us">
                      חשבונית{" "}
                      <br />
                      סופר ידידותית
                    </th>
                    <th className="col">
                      <LtrText text={competitor.name} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groupFeatures(competitor.features).map((group) => (
                    <React.Fragment key={group.title}>
                      <tr className="grp">
                        <td colSpan={3}>{group.title}</td>
                      </tr>
                      {group.rows.map((row) => (
                        <tr key={row.feature} className="row">
                          <td className="feat">
                            <div>
                              <LtrText text={row.feature} />
                            </div>
                            {row.note && (
                              <div className="note">
                                <LtrText text={row.note} />
                              </div>
                            )}
                          </td>
                          <td className="mark">
                            <Mark kind={row.us} />
                          </td>
                          <td className="mark">
                            <Mark kind={row.them} note={row.note} />
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="v2-legend">
              <span className="yes">
                <Check strokeWidth={3} /> תומך
              </span>
              <span className="partial">
                <Minus strokeWidth={3} /> חלקי
              </span>
              <span className="no">
                <XIcon strokeWidth={3} /> לא תומך
              </span>
            </div>
          </div>
        </section>

        {/* Strengths: honest both ways */}
        <section className="v2-cmp-sec">
          <div className="v2-str-grid">
            <div className="v2-panel v2-str them">
              <h3>
                איפה <LtrText text={competitor.name} /> מנצחים
              </h3>
              <ul>
                {competitor.theirStrengths.map((s) => (
                  <li key={s}>
                    <Check strokeWidth={2.5} />
                    <span>
                      <LtrText text={s} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="v2-panel v2-str win">
              <h3>איפה אנחנו מנצחים</h3>
              <ul>
                {competitor.ourStrengths.map((s) => (
                  <li key={s}>
                    <Check strokeWidth={2.5} />
                    <span>
                      <LtrText text={s} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Founder note */}
        <section className="v2-cmp-sec">
          <div className="v2-panel v2-note-panel">
            <div className="ic">
              <Sparkles />
            </div>
            <div>
              <h3>למה בכלל בנינו את זה?</h3>
              <p>
                עצמאים הם אנשים עם שולחן מלא עבודה, שלא רוצים לבזבז עוד עשר
                דקות בחודש על ממשק שמרגיש כמו תוכנת חשבוניות מ-2008. בנינו את
                האפליקציה שהיינו רוצים בעצמנו: מהירה, נקייה, עברית מלאה, במחיר
                הוגן.
              </p>
              <p>
                <LtrText text={competitor.name} /> הם פלטפורמה רחבה ובוגרת,
                ואנחנו פלטפורמה ממוקדת ומהירה. שתי הגישות לגיטימיות, תלוי מה
                אתה צריך.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <VsSiblings current={competitor.slug} />

        <RelatedLinks
          targets={{ posts: VS_RELATED[competitor.slug] ?? [] }}
          heading="מדריכים שכדאי לקרוא"
        />

        <section className="v2-cmp-cta">
          <h2 className="v2-gold">רוצה לנסות? זה חינם עכשיו</h2>
          <p>
            בתקופת ההשקה הכול פתוח: כל הפיצ׳רים של <Ltr>Pro</Ltr>, בלי כרטיס
            אשראי. כשנתחיל לגבות נעדכן מראש, בלי הפתעות.
          </p>
          <div className="row">
            <Link href="/login?mode=signup" className="v2-cta">
              התחילו בחינם
            </Link>
            <Link href="/invite/FOR-FRIENDS-ONLY" className="ghost">
              <Gift />
              קיבלת קוד מחבר? לחצו כאן
            </Link>
          </div>
        </section>
      </main>

      <FooterV2 />
    </>
  );
}

export default ComparisonViewV2;
