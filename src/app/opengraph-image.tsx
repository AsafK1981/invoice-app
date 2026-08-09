import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "MyFriendlyInvoiceApp - חשבוניות וקבלות בלי כאב ראש";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Loads a Google Font as binary data so satori (the engine behind
 * ImageResponse) can shape Hebrew correctly. Without this, Hebrew
 * renders as reversed unshaped glyphs because satori has no system
 * font fallback and the default doesn't include Hebrew support.
 */
async function loadGoogleFont(family: string, weight: number, text: string) {
  const url = `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const match = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype|woff2?)'\)/);
  if (!match) throw new Error(`couldn't parse font URL from CSS for ${family} ${weight}`);
  const fontRes = await fetch(match[1]);
  if (!fontRes.ok) throw new Error(`failed to load font ${family} ${weight}`);
  return await fontRes.arrayBuffer();
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
  const headlineLogical = "חשבוניות וקבלות בלי כאב ראש";
  const headline = visualRtl(headlineLogical);

  const heeboBold = await loadGoogleFont("Heebo", 800, headlineLogical);

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
          backgroundColor: "#070504",
          // Same two-layer radial depth as `.v2-theme` in v2.css (values
          // copied by hand, not imported - this route renders on the edge
          // runtime via satori, which cannot read the site's stylesheet).
          backgroundImage:
            "radial-gradient(120% 70% at 50% -8%, rgba(190, 158, 78, 0.1), transparent 45%), radial-gradient(100% 120% at 50% 30%, #1a1510 0%, #0d0a07 55%, #070504 100%)",
          padding: 80,
          textAlign: "center",
        }}
      >
        {/* Brand mark: the same gold tile + shield-check glyph the homepage
            uses for its allocation-number differentiator (.v2-tax-band-icon),
            not an emoji - a thumbnail borrows the site's one real icon
            instead of inventing a decoration of its own. */}
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 30,
            background:
              "linear-gradient(177deg, #d8be77 0%, #be9e4e 38%, #8f6f2a 72%, #cbb061 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 40,
            boxShadow: "0 20px 50px -10px rgba(190, 158, 78, 0.45)",
          }}
        >
          <svg
            width={64}
            height={64}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#191206"
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
            // Gold-gradient clip on the brand name (`.v2-gold` in v2.css uses
            // the same background-clip:text technique for real browsers;
            // satori supports it too, verified against this exact bundled
            // version - it builds a real SVG clip-path from the glyph
            // outlines rather than silently ignoring the property).
            backgroundImage: "linear-gradient(90deg, #d8be77 0%, #be9e4e 100%)",
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
            color: "#d6d0c2",
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
    },
  );
}
