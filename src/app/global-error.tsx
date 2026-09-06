"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Global error boundary]", error);
  }, [error]);

  return (
    <html lang="he" dir="rtl">
      <body
        style={{
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Heebo, Arial, sans-serif",
          background: "linear-gradient(135deg, #fff7ed, #fef3c7)",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          padding: 16,
        }}
      >
        <div
          style={{
            background: "white",
            borderRadius: 24,
            padding: 32,
            maxWidth: 420,
            width: "100%",
            textAlign: "center",
            boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "#fee2e2",
              margin: "0 auto 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
            }}
          >
            ⚠️
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px", color: "#1c1917" }}>
            תקלה לא צפויה
          </h1>
          <p style={{ fontSize: 14, color: "#57534e", margin: "0 0 24px" }}>
            המערכת נתקלה בשגיאה. נסה לרענן את העמוד.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: "#a8a29e", margin: "0 0 20px", fontFamily: "monospace" }}>
              קוד: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              background: "linear-gradient(135deg, #2F3A45, #263039)",
              color: "white",
              border: "none",
              padding: "12px 24px",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            רענן ונסה שוב
          </button>
        </div>
      </body>
    </html>
  );
}
