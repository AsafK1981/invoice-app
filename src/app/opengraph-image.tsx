import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "MySuperFriendlyInvoiceApp - חשבוניות וקבלות בלי כאב ראש";
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
  const pillsLogical = "חינם · עברית · עוסק פטור";
  const headline = visualRtl(headlineLogical);
  const pills = visualRtl(pillsLogical);
  const allHebrew = headlineLogical + pillsLogical;

  // Load two weights so the headline can be heavier than the pills.
  const [heeboBold, heeboMedium] = await Promise.all([
    loadGoogleFont("Heebo", 800, allHebrew),
    loadGoogleFont("Heebo", 500, allHebrew),
  ]);

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
          background: "linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%)",
          padding: 80,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 140,
            height: 140,
            borderRadius: 36,
            background: "linear-gradient(135deg, #fb923c 0%, #f43f5e 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 40,
            boxShadow: "0 20px 50px rgba(251, 146, 60, 0.4)",
            fontSize: 84,
          }}
        >
          ✨
        </div>
        <div
          style={{
            fontSize: 76,
            fontWeight: 800,
            color: "#1c1917",
            letterSpacing: -2,
            lineHeight: 1.05,
            display: "flex",
          }}
        >
          MySuperFriendlyInvoiceApp
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 800,
            color: "#57534e",
            marginTop: 28,
            display: "flex",
          }}
        >
          {headline}
        </div>
        <div
          style={{
            fontSize: 24,
            color: "#a8a29e",
            marginTop: 60,
            display: "flex",
            fontWeight: 500,
          }}
        >
          {pills}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Heebo", data: heeboBold, style: "normal", weight: 800 },
        { name: "Heebo", data: heeboMedium, style: "normal", weight: 500 },
      ],
    },
  );
}
