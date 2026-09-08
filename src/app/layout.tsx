import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SwRegister } from "@/components/sw-register";
import { AttributionCapture } from "@/components/attribution-capture";
import { CANONICAL_ORIGIN } from "@/lib/public-url";
import "./globals.css";
// THE app skin, the warm light shell every user sees. Unconditional since
// 2026-07-20 (it used to be gated behind html[data-skin="gold"], with a
// ?skin=coral fallback to the legacy design; that second, untested visual
// state is gone). Imported AFTER globals.css on purpose: keeps skin rules
// later in source order so they win specificity ties against globals.css.
import "./app-skin.css";
// The printable document sheet's own stylesheet. Imported LAST on purpose:
// its `.doc-*` rules must win ties against the app skin's utility remaps so
// the paper renders identically on screen, in the editor preview and in the
// server-side PDF. See the header comment in document-paper.css.
import "./document-paper.css";

// SELF-HOSTED FONTS, as local files under ./fonts (was: next/font/google,
// which downloads the files from fonts.gstatic.com at BUILD time on every
// build). That download is a real availability risk we hit directly: two
// production deploys failed at build time on 2026-08-14 with a 404 from
// fonts.gstatic.com for an unrelated font file, breaking a deploy that had
// nothing to do with fonts. Self-hosting removes the network from the build
// path entirely - the files are committed, so a CDN hiccup can no longer
// fail a build. Same reasoning applies at request time for the PDF route,
// which drives headless Chrome on a serverless box to /view and prints it;
// a third-party CDN fetch there was also a font-loss risk on a slow or
// blocked fonts.gstatic.com. The weight ranges below cover the same weights
// the old next/font/google config listed (these are variable fonts, so one
// file serves the whole range). Exposed as the same CSS variable names as
// before because globals.css / app-skin.css / document-paper.css reference
// the families by name - do not rename these variables without updating
// those stylesheets too. Do not move these back to next/font/google.
const heebo = localFont({
  src: [
    { path: "./fonts/heebo/Heebo-Variable-Hebrew.woff2" },
    { path: "./fonts/heebo/Heebo-Variable-Latin.woff2" },
  ],
  weight: "300 900",
  variable: "--font-heebo",
  display: "swap",
});
// preload: false (2026-08-14 perf fix) - Frank Ruhl is only ever used by
// document-paper.css's `.doc-serif` rule (the printable document sheet:
// /documents/[id], /view/[id], and the document editors' live preview),
// but declaring the font here on <html> (needed so /view/[id], which lives
// outside the (app) route group, still gets the CSS variable) had Next
// preload the 63KB file with a <link rel="preload"> on every single page,
// marketing included. `preload: false` keeps the variable/class global
// (nothing to restructure, no risk of it going missing on one route) while
// making the actual font fetch lazy: the browser only downloads it once a
// matching font-family rule is actually painted, i.e. only on document-sheet
// routes. Considered moving the localFont() call into a layout scoped to
// just those routes instead, but /view/[id] and the (app) document routes
// don't share a layout, so that would mean two separate localFont() calls
// for one font; preload:false gets the same result with none of that risk.
const frankRuhl = localFont({
  src: [
    {
      path: "./fonts/frank-ruhl-libre/FrankRuhlLibre-Variable-Hebrew.woff2",
    },
    { path: "./fonts/frank-ruhl-libre/FrankRuhlLibre-Variable-Latin.woff2" },
  ],
  weight: "400 900",
  variable: "--font-frank",
  display: "swap",
  preload: false,
});
const assistant = localFont({
  src: [
    { path: "./fonts/assistant/Assistant-Variable-Hebrew.woff2" },
    { path: "./fonts/assistant/Assistant-Variable-Latin.woff2" },
  ],
  weight: "300 800",
  variable: "--font-assistant",
  display: "swap",
});
// Added for the profession-tailored document design feature (2026-08).
// Same self-hosted next/font/local pattern as the three fonts above - see
// the block comment there for why (no Google Fonts CDN call at request
// time, ever, including from the PDF route's headless Chrome). Both are
// only ever referenced by document-paper.css's --d-font/--d-font-serif
// vars when a business has actually chosen a template that uses them, so
// preload:false keeps them out of every page's initial payload the same
// way Frank Ruhl already is.
// Inter carries every LATIN run (English words, digits, punctuation) since
// the 2026-09-07 brand pass: the face is declared with a Latin-only
// unicode-range and sits FIRST in every font stack, so "FriendlyInvoice",
// "WhatsApp", "AI", numbers and English UI labels render in Inter while
// Hebrew glyphs fall through to Heebo - with no markup changes anywhere.
// Self-hosted like the rest (see the 2026-08-14 note above).
const inter = localFont({
  src: "./fonts/inter/Inter-Variable-latin.woff2",
  weight: "100 900",
  variable: "--font-inter-base",
  display: "swap",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
// Separate faces let the browser fetch extended Latin only when needed.
// Giving both subset files the same range eagerly loaded an extra 85 KB.
const interExtended = localFont({
  src: "./fonts/inter/Inter-Variable-latin-ext.woff2",
  weight: "100 900",
  variable: "--font-inter-extended",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20A9, U+20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});
// The frequently displayed shekel must not pull in the full extended face.
// Generated from that face by scripts/subset-currency-font.py, same license.
const interCurrency = localFont({
  src: "./fonts/inter/Inter-Variable-shekel.woff2",
  weight: "100 900",
  variable: "--font-inter-currency",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+20AA" }],
});
// Playfair Display carries ONE string in the whole product: the English
// signature "Friendly Invoice" under the Hebrew name in the brand lockup
// (brand book 4). Same self-hosted next/font/local pattern as `inter` above;
// preload:false because the face is only painted where `.brand-latin` is,
// which is a handful of lockups, never a full page of body copy.
const playfair = localFont({
  src: "./fonts/playfair-display/PlayfairDisplay-Variable-latin.woff2",
  weight: "400 900",
  variable: "--font-playfair",
  display: "swap",
  preload: false,
});
const rubik = localFont({
  src: [
    { path: "./fonts/rubik/Rubik-Variable-Hebrew.woff2" },
    { path: "./fonts/rubik/Rubik-Variable-Latin.woff2" },
  ],
  weight: "300 900",
  variable: "--font-rubik",
  display: "swap",
  preload: false,
});
const miriamLibre = localFont({
  src: [
    { path: "./fonts/miriam-libre/MiriamLibre-Variable-Hebrew.woff2" },
    { path: "./fonts/miriam-libre/MiriamLibre-Variable-Latin.woff2" },
  ],
  weight: "400 700",
  variable: "--font-miriam",
  display: "swap",
  preload: false,
});
// 2026-08-18: five more document-font choices (Asaf asked for handwriting,
// a minimalist face and a hi-tech face). Same self-hosted, preload:false
// pattern; only referenced through document-paper.css vars.
const playpen = localFont({
  src: [
    { path: "./fonts/playpen-sans-hebrew/PlaypenSansHebrew-Variable-Hebrew.woff2" },
    { path: "./fonts/playpen-sans-hebrew/PlaypenSansHebrew-Variable-Latin.woff2" },
  ],
  weight: "100 800",
  variable: "--font-playpen",
  display: "swap",
  preload: false,
});
const amatic = localFont({
  src: [
    { path: "./fonts/amatic-sc/AmaticSC-Regular-Hebrew.woff2", weight: "400" },
    { path: "./fonts/amatic-sc/AmaticSC-Regular-Latin.woff2", weight: "400" },
    { path: "./fonts/amatic-sc/AmaticSC-Bold-Hebrew.woff2", weight: "700" },
    { path: "./fonts/amatic-sc/AmaticSC-Bold-Latin.woff2", weight: "700" },
  ],
  variable: "--font-amatic",
  display: "swap",
  preload: false,
});
const alef = localFont({
  src: [
    { path: "./fonts/alef/Alef-Regular-Hebrew.woff2", weight: "400" },
    { path: "./fonts/alef/Alef-Regular-Latin.woff2", weight: "400" },
    { path: "./fonts/alef/Alef-Bold-Hebrew.woff2", weight: "700" },
    { path: "./fonts/alef/Alef-Bold-Latin.woff2", weight: "700" },
  ],
  variable: "--font-alef",
  display: "swap",
  preload: false,
});
const plexHebrew = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-hebrew/IBMPlexSansHebrew-400-Hebrew.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-sans-hebrew/IBMPlexSansHebrew-400-Latin.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-sans-hebrew/IBMPlexSansHebrew-500-Hebrew.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-sans-hebrew/IBMPlexSansHebrew-500-Latin.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-sans-hebrew/IBMPlexSansHebrew-600-Hebrew.woff2", weight: "600" },
    { path: "./fonts/ibm-plex-sans-hebrew/IBMPlexSansHebrew-600-Latin.woff2", weight: "600" },
    { path: "./fonts/ibm-plex-sans-hebrew/IBMPlexSansHebrew-700-Hebrew.woff2", weight: "700" },
    { path: "./fonts/ibm-plex-sans-hebrew/IBMPlexSansHebrew-700-Latin.woff2", weight: "700" },
  ],
  variable: "--font-plex",
  display: "swap",
  preload: false,
});
const varelaRound = localFont({
  src: [
    { path: "./fonts/varela-round/VarelaRound-Regular-Hebrew.woff2", weight: "400" },
    { path: "./fonts/varela-round/VarelaRound-Regular-Latin.woff2", weight: "400" },
  ],
  variable: "--font-varela",
  display: "swap",
  preload: false,
});

// NOTE (2026-07-20): there used to be a synchronous inline <head> script here
// that read localStorage and set html[data-skin] before first paint, so the
// gated skin applied without a flash of the legacy coral look. Both the gate
// and the coral fallback are gone (app-skin.css now applies unconditionally),
// so the script had no job left. Deleting it also removed a render-blocking
// localStorage read and the React hydration-attribute warning it caused. The
// `classList.remove("dark")` it also carried was belt-and-braces for a class
// nothing in the app ever adds, and which could not survive a page load anyway
// (the server renders <html>'s className).
// Orphan keys `invoice-app:skin` / `invoice-app:skin-default-gold` may linger
// in returning users' localStorage; nothing reads them. Not worth re-adding a
// blocking script to clear.

const SITE_URL = CANONICAL_ORIGIN;

// Google Search Console ownership token, emitted as
// <meta name="google-site-verification">. Kept in an env var, not committed:
// verifying a NEW property (e.g. after buying a domain) then costs a variable
// change plus a redeploy, with no code edit and no stray google*.html file
// sitting in public/ forever. Unset = no tag rendered, which is the correct
// behaviour rather than an empty meta.
const GOOGLE_SITE_VERIFICATION = process.env.GOOGLE_SITE_VERIFICATION?.trim();

// Meta (Facebook) domain-ownership token, emitted as
// <meta name="facebook-domain-verification">. Required for Meta Business
// verification, which in turn gates taking the WhatsApp channel out of
// development mode. Same env-var reasoning as the Google token above; the
// value is not secret (it ships in the public HTML) but keeping it out of
// git means re-verifying a domain never needs a code change.
const FACEBOOK_DOMAIN_VERIFICATION =
  process.env.FACEBOOK_DOMAIN_VERIFICATION?.trim();

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  ...(GOOGLE_SITE_VERIFICATION
    ? { verification: { google: GOOGLE_SITE_VERIFICATION } }
    : {}),
  ...(FACEBOOK_DOMAIN_VERIFICATION
    ? {
        other: {
          "facebook-domain-verification": FACEBOOK_DOMAIN_VERIFICATION,
        },
      }
    : {}),
  /**
   * Title/description/OG refreshed 2026-08-11. The previous copy
   * ("חשבוניות וקבלות בלי כאב ראש" + "ניהול לקוחות, שליחה במייל, דשבורד
   * עם גרפים") predated every current differentiator, so the search result
   * and the WhatsApp/Facebook link preview - the first impression for most
   * arrivals - described a generic invoicing app and contradicted the
   * landing page. These now lead with what actually sets the product apart
   * and are kept in sync with the homepage's advantage grid + the
   * `featureList` in src/lib/jsonld.ts. Hebrew brand first: `חשבונית
   * ידידותית` is what the header, footer and Organization node all show;
   * the Latin name stays an alternateName for the pre-rename search
   * association (see the LEGACY_APP_NAME comment in jsonld.ts).
   * The WhatsApp channel IS named here since 2026-08-15: it went live
   * (Meta approval closed) and every on-page `בקרוב` marker came off, so
   * metadata may now claim it.
   */
  title: {
    default: "חשבונית ידידותית | תוכנת חשבוניות לעצמאים ולעסקים קטנים",
    template: "%s | חשבונית ידידותית",
  },
  description:
    "הפקת חשבוניות וקבלות, מספרי הקצאה אוטומטיים, ניהול הכנסות והוצאות, עוזר AI ושליחה ללקוחות במקום אחד. פשוט, ברור וידידותי לעצמאים בישראל",
  keywords: [
    "חשבוניות",
    "קבלות",
    "עוסק פטור",
    "עוסק מורשה",
    "חשבונית מס",
    "חשבון עסקה",
    "חשבוניות אונליין",
    "ניהול עסק",
  ],
  manifest: "/manifest.json",
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "חשבונית ידידותית",
  },
  openGraph: {
    type: "website",
    locale: "he_IL",
    url: SITE_URL,
    siteName: "חשבונית ידידותית",
    title: "חשבונית ידידותית | תוכנת חשבוניות לעצמאים ולעסקים קטנים",
    description:
      "הפקת חשבוניות וקבלות, מספרי הקצאה אוטומטיים, ניהול הכנסות והוצאות, עוזר AI ושליחה ללקוחות במקום אחד. פשוט, ברור וידידותי לעצמאים בישראל",
    // images intentionally omitted; Next picks up src/app/opengraph-image.tsx
    // automatically and generates a 1200x630 card.
  },
  twitter: {
    card: "summary_large_image",
    title: "חשבונית ידידותית | תוכנת חשבוניות לעצמאים ולעסקים קטנים",
    description:
      "הפקת חשבוניות וקבלות, מספרי הקצאה אוטומטיים, ניהול הכנסות והוצאות ועוזר AI במקום אחד. פשוט, ברור וידידותי לעצמאים בישראל.",
    // images: same, file-based generation handles it.
  },
};

export const viewport: Viewport = {
  // Warm Cream: matches the light app shell's page background.
  themeColor: "#F7F2EB",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`h-full antialiased ${heebo.variable} ${inter.variable} ${interExtended.variable} ${interCurrency.variable} ${playfair.variable} ${frankRuhl.variable} ${assistant.variable} ${rubik.variable} ${miriamLibre.variable} ${playpen.variable} ${amatic.variable} ${alef.variable} ${plexHebrew.variable} ${varelaRound.variable}`}
    >
      <body className="min-h-full flex flex-col font-sans text-stone-800">
        {children}
        <SwRegister />
        <AttributionCapture />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
