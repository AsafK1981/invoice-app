import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { COMPETITORS } from "@/lib/comparison-data";
import HeaderV2 from "../components/HeaderV2";
import FooterV2 from "../components/FooterV2";

export const metadata: Metadata = {
  title: "השוואות מול תוכנות חשבוניות אחרות",
  description:
    "השוואות הוגנות מול Invoice4U, חשבונית ירוקה, ו-iFreelance — מחירים, פיצ׳רים, יתרונות וחסרונות.",
};

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
        <Link href="/v2" className="v2-back">
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
            מי כדאי לי,
            <br />
            <span className="v2-gold">באמת?</span>
          </h1>
          <p className="v2-lede">
            בלי ספין. איפה אנחנו חזקים, איפה הם — מחירים, פיצ׳רים, ויתרונות
            אמיתיים של כל צד.
          </p>
        </div>

        <div className="v2-vs-list">
          {list.map((c) => (
            <Link key={c.slug} href={`/v2/vs/${c.slug}`} className="v2-vs-card">
              <h2>
                <span className="v2-gold">חשבונית סופר ידידותית</span> מול {c.name}
              </h2>
              <p>{c.verdict}</p>
              <span className="more">
                קראו את ההשוואה המלאה
                <ArrowLeft />
              </span>
            </Link>
          ))}
        </div>

        <div className="v2-cmp-cta" style={{ marginTop: "40px" }}>
          <Link href="/login" className="v2-cta">
            התחילו 14 יום ניסיון
          </Link>
          <div className="v2-fine">ללא כרטיס אשראי · ביטול בכל עת</div>
        </div>
      </main>

      <FooterV2 />
    </>
  );
}
