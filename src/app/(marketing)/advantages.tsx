import type { ReactNode } from "react";
import {
  ScanLine,
  Gauge,
  FileBarChart,
  ArrowLeftRight,
  RefreshCw,
  Users,
  Palette,
} from "lucide-react";
import WhatsappIcon from "./components/WhatsappIcon";

/**
 * SHARED SOURCE OF TRUTH for the marketing site's feature cards.
 *
 * Extracted out of src/app/(marketing)/page.tsx on 2026-08-24 (Asaf: the
 * /pricing "מה כלול" grid had drifted into a monochrome, body-less, partly
 * re-worded copy of this list - "למה פה זה בלי צבעים ובדף הראשי זה עם
 * צבעים"). Both the homepage grid/spotlight and /pricing now render from
 * THIS array, so a card's icon, tone, title and body cannot differ between
 * the two pages again. Add a feature here, not in a page.
 */

/**
 * "כל מה שיש רק אצלנו" - the competitive-advantage grid. Sat right after
 * the hero in the approved warm redesign; since 2026-08-11 (Asaf) the
 * WhatsApp+document showcase leads and this grid follows it.
 * Cards state OUR capabilities only (no competitor names - the comparison
 * strip, now the page's last section, hands off to the /vs pages for the
 * head-to-head).
 *
 * `tone` gives every non-flagship card its own soft-tinted icon tile
 * (Asaf 2026-08-10: the approved mockup shipped with 8 of 9 tiles dull and
 * near-identical; he asked for every card to get real, distinct color).
 * Formula: tile background = Tailwind `*-100`, icon stroke = `*-600`, see
 * `.ml-adv-icon--*` in marketing-light.css. The allocation card keeps no
 * `tone` - it is the one `flagship` card and gets the full brand-gradient
 * tile with a white glyph instead, the strongest treatment on the page.
 *
 * `tone` also lands on the card itself as `ml-adv-card--{tone}` (below),
 * reused by that class's `:hover` rule so the whole card - not just its
 * icon tile - shifts to that hue's `*-50` on hover (2026-08-10 "more
 * interesting" pass, see the hover block under `.ml-adv-icon--orange` in
 * marketing-light.css).
 *
 * Body copy: kept the previous (verified) copy for every card except
 * "allocation" and "whatsapp", where the approved mockup's phrasing is
 * strictly tighter without dropping any verified fact. The rest keep
 * specifics the mockup's copy did not carry (VAT/date OCR + Bit/bank
 * screenshots, credit-note-aware ceiling tracking, the named report list,
 * the migration wizards) rather than trade accuracy for brevity.
 */
export type AdvantageTone =
  | "violet"
  | "amber"
  | "green"
  | "pink"
  | "teal"
  | "indigo"
  | "sky"
  | "orange"
  | "cyan"
  | "lime"
  | "fuchsia";

export type Advantage = {
  key: string;
  icon: ReactNode;
  title: string;
  body: string;
  tone?: AdvantageTone;
  flagship?: true;
  /**
   * Renders a "בקרוב" pill next to the title. Restored 2026-08-16 after the
   * WhatsApp channel was wrongly marked live on 08-15: the code is deployed and
   * the env vars are set, but production still runs on Meta's TEST number, which
   * reaches at most 5 whitelisted phones and never a real customer. Anything a
   * visitor cannot use the day they sign up carries this flag.
   */
  soon?: true;
  /**
   * Promotes the card out of the grid into the full-width spotlight band that
   * runs directly under the trust strip (2026-08-23, Asaf: the demos were
   * eating the top of the page while the reasons to buy sat below the fold).
   * Exactly the three strongest differentiators carry this - keep it that way;
   * a "spotlight" holding six items is just a second grid.
   */
  spotlight?: true;
  /** Short punchy line shown above the title in the spotlight band only. */
  kicker?: string;
};

export const ADVANTAGES: Advantage[] = [
  {
    key: "allocation",
    flagship: true,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
    title: "מספרי הקצאה אוטומטיים",
    spotlight: true,
    kicker: "דרישת 2026, פתורה",
    body: "המערכת מבקשת ומקבלת מספר הקצאה מרשות המסים בלחיצה אחת,\nישירות מתוך המסמך.",
  },
  {
    key: "ai",
    tone: "violet",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
        <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
      </svg>
    ),
    title: "עוזר AI חכם בעברית",
    spotlight: true,
    kicker: "שואלים בעברית, מקבלים תשובה",
    body: "שאלו בשפה חופשית: כמה הכנסתי החודש? איפה החשבונית של דנה?\nהעוזר מוצא, עונה ומכין טיוטות - ואתם רק מאשרים.",
  },
  {
    key: "reminders",
    tone: "amber",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3a5 5 0 0 0-5 5c0 5.5-2 7-2 7h14s-2-1.5-2-7a5 5 0 0 0-5-5z" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </svg>
    ),
    title: "התראות ותזכורות חכמות",
    body: "תזכורת חודשית להוציא מסמכים בימים ובשעה שאתם בוחרים, ותזכורות תשלום אוטומטיות ללקוחות שמאחרים - במייל ובאפליקציה.",
  },
  {
    key: "whatsapp",
    tone: "green",
    icon: <WhatsappIcon aria-hidden="true" />,
    title: "וואטסאפ בלי לפתוח את האפליקציה",
    spotlight: true,
    kicker: "היתרון שאין לאף אחד אחר",
    body: "מוציאים קבלה ורושמים הוצאה ישירות מתוך הצ'אט, בלי להתחבר בכלל.\nנפתח בהדרגה - הנרשמים עכשיו נכנסים ראשונים.",
    soon: true,
  },
  {
    // Recurring billing templates (shipped; see src/app/(app)/recurring).
    // Honest phrasing: there is NO cron auto-issuing documents - the system
    // prepares the document and surfaces it on the due day, the user
    // confirms with one click (recurring-due-alert.tsx). Copy must keep
    // saying "אתם מאשרים", never "נשלח לבד".
    key: "recurring",
    tone: "cyan",
    icon: <RefreshCw aria-hidden="true" />,
    title: "חיוב חוזר ללקוחות קבועים",
    body: "מגדירים פעם אחת - והמסמך החודשי מוכן לבד, ביום שבחרתם. אתם רק מאשרים בלחיצה.",
  },
  {
    key: "ocr",
    tone: "pink",
    icon: <ScanLine aria-hidden="true" />,
    title: "סריקת הוצאות בצילום",
    body: "מצלמים קבלה - והמערכת ממלאת לבד ספק, סכום, מע״מ ותאריך. גם צילומי מסך של ביט או העברה בנקאית.",
  },
  {
    key: "ceiling",
    tone: "teal",
    icon: <Gauge aria-hidden="true" />,
    title: "מעקב תקרת עוסק פטור בזמן אמת",
    body: "רואים בכל רגע כמה נשאר עד התקרה השנתית, כולל התחשבות בחשבוניות זיכוי.",
  },
  {
    key: "reports",
    tone: "indigo",
    icon: <FileBarChart aria-hidden="true" />,
    title: "דו״חות שרואי חשבון אוהבים",
    body: "דוח מע״מ תקופתי, עזר ל-1301, הצהרת הון, גיול חובות, כרטסת לקוח ויומן שנתי - הכל מוכן להורדה.",
  },
  {
    // Client portal (src/app/portal): the client asks for a link by email
    // (magic link, no password) and sees every document issued to them,
    // with paid/pending status. No claims beyond what /portal/me renders.
    key: "portal",
    tone: "lime",
    icon: <Users aria-hidden="true" />,
    title: "אזור אישי ללקוחות שלכם",
    body: "הלקוח מקבל קישור למייל ורואה את כל המסמכים שלו במקום אחד, כולל מה שולם ומה ממתין - בלי סיסמה ובלי לחפש במיילים.",
  },
  {
    // Document design choice (src/lib/document-themes.ts): 5 layout
    // families x accent themes, picked per business. "מגוון סגנונות" keeps
    // the copy true even as the exact theme count changes.
    key: "design",
    tone: "fuchsia",
    icon: <Palette aria-hidden="true" />,
    title: "בוחרים איך המסמך ייראה",
    body: "מגוון סגנונות עיצוב וצבעים לבחירה - והמסמכים שלכם נראים כמו העסק שלכם, לא כמו טופס גנרי.",
  },
  {
    key: "migration",
    tone: "sky",
    icon: <ArrowLeftRight aria-hidden="true" />,
    title: "מעבר קל מכל תוכנה",
    body: "ייבוא היסטוריה מ-Excel ומהתוכנות המוכרות, אשפי מעבר ייעודיים - ולא מאבדים אף מסמך.",
  },
  {
    key: "channels",
    tone: "orange",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
      </svg>
    ),
    title: "שליחה בכל ערוץ",
    body: "מייל, וואטסאפ או קישור ציבורי מעוצב - הלקוח מקבל מסמך מקצועי בלי להתקין כלום.",
  },
];


/**
 * The nine cards /pricing shows under "מה כלול", in display order.
 *
 * Keys only - the icon, tone, title and body all come from ADVANTAGES above,
 * so the pricing grid renders the SAME card as the homepage, pixel for pixel
 * (Asaf 2026-08-24). Three of these (allocation / ai / whatsapp) are the
 * homepage's `spotlight` cards, which the homepage renders in its own
 * full-width band; here they take their normal grid form, allocation keeping
 * its flagship gradient tile.
 */
const PRICING_KEYS = [
  "allocation",
  "ai",
  "reminders",
  "whatsapp",
  "ocr",
  "ceiling",
  "reports",
  "migration",
  "channels",
] as const;

export const PRICING_ADVANTAGES: Advantage[] = PRICING_KEYS.map((k) => {
  const found = ADVANTAGES.find((a) => a.key === k);
  if (!found) throw new Error(`PRICING_KEYS references unknown advantage "${k}"`);
  return found;
});
