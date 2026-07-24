import Link from "next/link";
import HeaderV2 from "./components/HeaderV2";
import FooterV2 from "./components/FooterV2";
import RedirectIfAuthed from "./components/RedirectIfAuthed";

/**
 * /v2 landing — faithful React port of design-F.html (gold on obsidian,
 * art-deco frame, golden invoice card). No auth-gate redirect: this page
 * stays viewable when logged in so both designs can be compared side by
 * side. CTAs route into the existing auth flow at /login.
 */
export default function V2Landing() {
  return (
    <>
      <RedirectIfAuthed />
      {/* deco outer frame */}
      <div className="v2-frame" aria-hidden="true">
        <i className="tl" />
        <i className="tr" />
        <i className="bl" />
        <i className="br" />
      </div>

      <HeaderV2 />

      <main className="v2-main">
        <div className="v2-wrap">
          <div className="v2-eyebrow-row">
            <i className="ln" />
            <span>לעוסק פטור בישראל</span>
            <i className="ln r" />
          </div>

          <div className="v2-freenow" role="status">
            <i className="dot" aria-hidden="true" />
            🎉 חינם עכשיו בתקופת ההשקה — כל הפיצ׳רים, בלי כרטיס אשראי
          </div>

          <h1 className="v2-h1">
            החשבונית שלך,
            <br />
            <span className="v2-gold">יוקרתית כמו העסק</span>
          </h1>

          <p className="v2-lede">
            המערכת הכי ידידותית לעוסקים פטורים — עברית מלאה, עומדת בדרישות
            רשות המסים, במחיר הוגן.
          </p>

          {/* golden invoice card */}
          <div className="v2-card">
            <i className="corner c1" />
            <i className="corner c2" />
            <i className="corner c3" />
            <i className="corner c4" />
            <div className="chd">
              <div className="biz v2-gold">
                סטודיו נועה
                <small>עיצוב גרפי · עוסק פטור</small>
              </div>
              <div className="chd-right">
                <div className="doclbl">חשבונית מס</div>
                <div className="paid">
                  <i />
                  שולם
                </div>
              </div>
            </div>
            <div className="meta">
              <span>לכבוד: סטודיו אורות בע״מ</span>
              <span>מס׳ 187025961 · 09.07.2026</span>
            </div>
            <div className="rows">
              <div className="r">
                <span>עיצוב לוגו ומיתוג</span>
                <span>3,200 ₪</span>
              </div>
              <div className="r">
                <span>דף נחיתה</span>
                <span>1,450 ₪</span>
              </div>
              <div className="r">
                <span>ייעוץ חזותי</span>
                <span>600 ₪</span>
              </div>
            </div>
            <div className="tot">
              <span className="lbl">סה״כ לתשלום</span>
              <span className="amt v2-gold">5,250 ₪</span>
            </div>
          </div>

          <div className="v2-tag">
            <span>פשוט.</span> <span>מהיר.</span>{" "}
            <span className="v2-gold">מקצועי.</span>
          </div>

          <div className="v2-feats">
            <div className="v2-ft">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="#BE9E4E"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13 3L4 14h7l-1 7 9-12h-7z" />
              </svg>
              <b>הפקה בשניות</b>
            </div>
            <div className="v2-ft">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="#BE9E4E"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              <b>הקצאה אוטומטית</b>
            </div>
            <div className="v2-ft">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="#BE9E4E"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
              </svg>
              <b>שליחה בכל ערוץ</b>
            </div>
          </div>

          <div className="v2-pricetop">מסלולים עתידיים החל מ־</div>
          <div className="v2-price v2-gold">
            ₪15<span className="per"> / חודש</span>
          </div>
          <div className="v2-fdiv">
            <i className="ln" />
            <span>Pro — כל הפיצ׳רים ללא הגבלה ב־₪25 · ביטול בכל עת</span>
            <i className="ln r" />
          </div>
          <div className="v2-freenow-note">
            בתקופת ההשקה הכול חינם. המחירים האלה ייכנסו לתוקף בהמשך — ונעדכן
            מראש, בלי הפתעות.
          </div>

          <Link className="v2-cta" href="/login?mode=signup">
            התחילו בחינם
          </Link>
          <div className="v2-fine">חינם עכשיו · ללא כרטיס אשראי · ביטול בכל עת</div>

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
