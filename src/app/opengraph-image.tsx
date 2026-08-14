import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt =
  "חשבונית ידידותית - מספר הקצאה מרשות המסים, בלחיצה אחת";
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
  // Retagged 2026-08-11 alongside the page metadata: the old
  // "חשבוניות וקבלות בלי כאב ראש" described a generic invoicing app. The
  // card now carries the one differentiator, matching the landing page's
  // lede. The Latin wordmark below stays deliberately (it matches the
  // domain and the pre-rename search association - see jsonld.ts).
  const headlineLogical = "מספר הקצאה מרשות המסים, בלחיצה אחת";
  const headline = visualRtl(headlineLogical);

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
          // Warm cream field, matching the "warm friendly" homepage redesign
          // (2026-08-10) - flat, not a gradient: the approved mockup's page
          // background is flat cream, same value as `--ml-cream` in
          // marketing-light.css.
          backgroundColor: "#faf7f2",
          padding: 80,
          textAlign: "center",
        }}
      >
        {/* Brand mark: the same shield-check glyph the homepage used for its
            allocation-number differentiator, not an emoji - a thumbnail
            borrows the site's one real icon instead of inventing a
            decoration of its own. Tile now carries the orange->rose brand
            gradient (`--ml-grad`) with a white glyph, same treatment as the
            homepage's flagship advantage card. */}
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 30,
            background: "linear-gradient(135deg, #f97316 0%, #e11d48 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 40,
            boxShadow:
              "0 20px 50px -10px rgba(225, 29, 72, 0.35), 0 8px 20px -8px rgba(249, 115, 22, 0.3)",
          }}
        >
          <svg
            width={64}
            height={64}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <div
          style={{
            fontSize: 76,
            fontWeight: 800,
            // Orange->rose gradient clip on the brand name (background-clip:
            // text - the same technique the previous gold version used;
            // satori supports it, verified against this exact bundled
            // version - it builds a real SVG clip-path from the glyph
            // outlines rather than silently ignoring the property).
            backgroundImage: "linear-gradient(90deg, #f97316 0%, #e11d48 100%)",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
            letterSpacing: -2,
            lineHeight: 1.05,
            display: "flex",
          }}
        >
          MyFriendlyInvoiceApp
        </div>
        <div
          style={{
            fontSize: 44,
            fontWeight: 800,
            // Warm stone, matching `--ml-ink-2` on the redesigned homepage.
            color: "#57534e",
            marginTop: 36,
            display: "flex",
          }}
        >
          {headline}
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
