import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt =
  "חשבונית ידידותית - התנהלות פשוטה לעסק מצליח";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// This card's content is fully static (no per-request data), but without a
// cache header it was regenerating on every single request (1.5-4.4s per
// hit, Cache-Control: public, max-age=0, must-revalidate).
//
// The route-segment `export const revalidate = 86400` was tried first
// (the usual App Router mechanism, and what most Next docs show), but it
// measurably did NOT change anything here: two live curl -I checks after
// deploy still showed max-age=0 and X-Vercel-Cache: MISS on every request.
// `dynamic: "force-static"` was tried too, but Next warns it's
// incompatible with `runtime: "edge"` at build time, and removing edge
// runtime breaks the build outright - Node's fetch() has no file: support,
// and the local-TTF `fetch(new URL(...))` below (chosen specifically to
// avoid a request-time fonts.gstatic.com dependency, see loadHeeboBold)
// needs edge's fetch implementation.
//
// What actually works on this Next/Vercel combo: set Cache-Control
// directly on the ImageResponse (it's a real Response, options.headers
// passes straight through), which does not depend on the route-segment
// cache config at all. Verified against the deployed response.
const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
};

/**
 * Heebo Bold (weight 800), local, so satori (the engine behind
 * ImageResponse) can shape Hebrew correctly without a request-time
 * network fetch. Previously this called Google's CSS2 API + fetched the
 * binary at request time (`loadGoogleFont`); that made every OG-card
 * render depend on fonts.googleapis.com/fonts.gstatic.com being up and
 * returning the expected CSS shape - the same class of build-time
 * dependency that broke two production deploys on 2026-08-14 for the
 * page fonts (see the comment in src/app/layout.tsx), just at request
 * time instead of build time.
 *
 * This is a SEPARATE file from `./fonts/heebo/Heebo-Variable-*.woff2`
 * (used by the page layouts via next/font/local): satori does not
 * accept woff2 - it needs a raw TTF/OTF/WOFF1 - so the page fonts
 * (woff2, variable, for the browser) and this OG font (static TTF, for
 * satori) are necessarily different files even though both are Heebo.
 * Sourced from Google's own Heebo build (fonts.gstatic.com's hebrew+latin
 * static instance at wght=800), which is a static TTF instance rather
 * than the variable font satori can't select a weight from - and is
 * covered by the same OFL.txt already committed alongside it.
 */
async function loadHeeboBold() {
  return fetch(new URL("./fonts/heebo/Heebo-Bold.ttf", import.meta.url)).then((res) =>
    res.arrayBuffer(),
  );
}

/**
 * satori does NOT implement the Unicode Bidi Algorithm. It renders
 * every character left-to-right in storage order. For Hebrew that
 * means characters end up visually reversed (the logical first
 * character lands on the LEFT, but Hebrew readers expect it on the
 * right). CSS `direction: rtl` and the JSX `dir` attribute are both
 * ignored by satori for inline text shaping.
 *
 * Workaround: pre-reverse the string at the code-point level so
 * left-to-right glyph emission produces the visually correct RTL
 * order. We split with Array.from to handle surrogate pairs and
 * combining marks safely (Heebo has no combining marks for our
 * letters, but the cost is negligible and the safety is real).
 */
function visualRtl(s: string): string {
  return Array.from(s).reverse().join("");
}

export default async function OpengraphImage() {
  // Rebrand 2026-09-06 (graphite / mint / peach, the smiling-document mark).
  // The differentiator keeps the top slot (2026-08-23 ranking); the identity
  // line under it now carries the tagline and the Latin name FriendlyInvoice
  // (the domain), not the old MyFriendlyInvoiceApp wordmark.
  //
  // The headline is split across two lines rather than shrunk: at one line
  // it needs ~1150px of the 1040px usable width at a size worth reading.
  // Punctuation is the one thing visualRtl below cannot place safely, so
  // there is none.
  const headlineTop = visualRtl("מספר הקצאה מרשות המסים");
  const headlineBottom = visualRtl("בלחיצה אחת");
  const brandHebrew = visualRtl("חשבונית ידידותית");
  const tagline = visualRtl("התנהלות פשוטה לעסק מצליח");

  const heeboBold = await loadHeeboBold();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          // Off-white field, the app's page background.
          backgroundColor: "#F7F7F2",
          padding: 80,
          textAlign: "center",
        }}
      >
        {/* The brand mark (same drawing as src/components/brand-mark.tsx;
            satori renders basic svg paths and circles). */}
        <svg width={124} height={143} viewBox="0 0 130 150" fill="none" style={{ marginBottom: 26 }}>
          <path d="M24 6h52l36 36v90a14 14 0 0 1-14 14H24a14 14 0 0 1-14-14V20A14 14 0 0 1 24 6z" fill="#FFFFFF" stroke="#2F3A45" strokeWidth="8" strokeLinejoin="round" />
          <path d="M76 6v22a14 14 0 0 0 14 14h22z" fill="#F6B89E" stroke="#2F3A45" strokeWidth="8" strokeLinejoin="round" />
          <path d="M32 58q10-12 20 0M70 58q10-12 20 0" stroke="#2F3A45" strokeWidth="7" strokeLinecap="round" />
          <path d="M46 74q15 14 30 0" stroke="#2F3A45" strokeWidth="7" strokeLinecap="round" />
          <circle cx="28" cy="72" r="6.5" fill="#F6B89E" />
          <circle cx="94" cy="72" r="6.5" fill="#F6B89E" />
          <path d="M30 100h60M30 114h46M30 128h32" stroke="#9ED8C3" strokeWidth="8" strokeLinecap="round" />
          <circle cx="100" cy="122" r="17" fill="#9ED8C3" stroke="#FFFFFF" strokeWidth="5" />
          <path d="M91 122l6 6 12-13" stroke="#2F3A45" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div
          style={{
            fontSize: 68,
            fontWeight: 800,
            color: "#2F3A45",
            letterSpacing: -1,
            lineHeight: 1.15,
            display: "flex",
          }}
        >
          {headlineTop}
        </div>
        {/* The payoff line sits on a mint marker, the same highlight the
            homepage headline uses. */}
        <div
          style={{
            fontSize: 68,
            fontWeight: 800,
            color: "#2F3A45",
            letterSpacing: -1,
            lineHeight: 1.15,
            display: "flex",
            padding: "0 14px",
            backgroundImage: "linear-gradient(transparent 62%, #9ED8C3 62%, #9ED8C3 92%, transparent 92%)",
          }}
        >
          {headlineBottom}
        </div>
        {/* Identity line. Hebrew and Latin are separate elements, never one
            string: visualRtl reverses code points, so a mixed string would
            come out with the Latin name spelled backwards. In a row satori
            emits children left to right, so the Latin name is first (lands
            left) and the Hebrew name last (lands right, where a Hebrew
            reader starts). */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginTop: 40,
            fontSize: 30,
            fontWeight: 800,
            color: "#5F6B76",
          }}
        >
          <div style={{ display: "flex" }}><span style={{ color: "#2F3A45" }}>Friendly</span><span style={{ color: "#9ED8C3" }}>Invoice</span></div>
          <div style={{ display: "flex", color: "#BFC5CB" }}>·</div>
          <div style={{ display: "flex", color: "#5F6B76" }}>{tagline}</div>
          <div style={{ display: "flex", color: "#BFC5CB" }}>·</div>
          <div style={{ display: "flex", color: "#2F3A45" }}>{brandHebrew}</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Heebo", data: heeboBold, style: "normal", weight: 800 }],
      headers: CACHE_HEADERS,
    },
  );
}
