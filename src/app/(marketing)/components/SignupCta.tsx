import Link from "next/link";
import { Gift } from "lucide-react";
import { Ltr } from "@/components/ui/ltr";

/**
 * The shared "start free" call to action.
 *
 * Extracted from ComparisonViewV2 so blog articles close with the same offer
 * the comparison pages do. Articles previously ended with nothing but a "back
 * to /blog" link, so every reader an article earned was handed straight back
 * to the index instead of to signup.
 */
export default function SignupCta() {
  return (
    <section className="v2-cmp-cta">
      <h2>רוצה לנסות? זה חינם עכשיו</h2>
      <p>
        בתקופת ההשקה הכול פתוח: כל הפיצ׳רים של <Ltr>Pro</Ltr>, בלי כרטיס אשראי.
        כשנתחיל לגבות נעדכן מראש, בלי הפתעות.
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
  );
}
