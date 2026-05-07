import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "MySuperFriendlyInvoiceApp - חשבוניות וקבלות בלי כאב ראש";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
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
          fontFamily: "system-ui, -apple-system, sans-serif",
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
            fontWeight: 500,
            color: "#57534e",
            marginTop: 28,
            display: "flex",
          }}
        >
          חשבוניות וקבלות בלי כאב ראש
        </div>
        <div
          style={{
            fontSize: 24,
            color: "#a8a29e",
            marginTop: 60,
            display: "flex",
            gap: 24,
          }}
        >
          <span>חינם</span>
          <span>·</span>
          <span>עברית</span>
          <span>·</span>
          <span>עוסק פטור</span>
        </div>
      </div>
    ),
    size,
  );
}
