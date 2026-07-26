import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { COMPETITORS } from "@/lib/comparison-data";
import { LtrText } from "@/components/ui/ltr";
import HeaderV2 from "../components/HeaderV2";
import FooterV2 from "../components/FooterV2";
import { vsMetadata } from "./vs-metadata";

export const metadata = vsMetadata({
  path: "/vs",
  title: "השוואות מול תוכנות חשבוניות אחרות",
  description:
    "השוואות הוגנות מול Invoice4U, חשבונית ירוקה, iFreelance, SUMIT, iCount ו-EZcount — מחירים, פיצ׳רים, יתרונות וחסרונות.",
  keywords: [
    "השוואת תוכנות חשבוניות",
    "תוכנת חשבוניות לעוסק פטור",
    "Invoice4U",
    "חשבונית ירוקה",
    "iCount",
    "EZcount",
    "SUMIT",
    "iFreelance",
  ],
});

export default function V2VsIndex() {
  const list = Object.values(COMPETITORS);
  return (
    <>
      {/* deco outer frame */}
      <div className="v2-frame" aria-hidden="true">
        <i className="tl" />
        <i className="tr" />
        <i className="bl" />
        <i className="br" />
      </div>

      <HeaderV2 />

      <main className="v2-cmp">
        <Link href="/" className="v2-back">
          <ArrowRight />
          חזרה לעמוד הבית
        </Link>

        <div className="v2-vs-head">
          <div className="v2-eyebrow-row">
            <i className="ln" />
            <span>השוואה הוגנת</span>
            <i className="ln r" />
          </div>
          <h1 className="v2-h1">
            מי כדאי לי,{" "}
            <br />
            <span className="v2-gold">באמת?</span>
          </h1>
          <p className="v2-lede">
            בלי ספין ובלי חצי-אמיתות. כתבנו בכנות איפה אנחנו חזקים ואיפה הם —
            מחירים, פיצ׳רים והיתרונות האמיתיים של כל צד. גם כשהתשובה היא שהם
            מתאימים לך יותר.
          </p>
        </div>

        <div className="v2-vs-list">
          {list.map((c) => (
            /* The card is an <article>, not a link. Its heading holds the one
               real anchor; `.v2-card-link::after` stretches that anchor over
               the whole card so the surface stays clickable. */
            <article key={c.slug} className="v2-vs-card">
              <h2>
                <Link href={`/vs/${c.slug}`} className="v2-card-link">
                  <span className="v2-gold">חשבונית סופר ידידותית</span> מול{" "}
                  <LtrText text={c.name} />
                </Link>
              </h2>
              <p>
                <LtrText text={c.verdict} />
              </p>
              <span className="more" aria-hidden="true">
                קראו את ההשוואה המלאה
                <ArrowLeft />
              </span>
            </article>
          ))}
        </div>

        <div className="v2-cmp-cta" style={{ marginTop: "40px" }}>
          <Link href="/login?mode=signup" className="v2-cta">
            התחילו בחינם
          </Link>
          <div className="v2-fine">
            חינם עכשיו בתקופת ההשקה · ללא כרטיס אשראי · ביטול בכל עת
          </div>
        </div>
      </main>

      <FooterV2 />
    </>
  );
}
