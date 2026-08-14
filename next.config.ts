import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Content-Security-Policy — defense-in-depth against XSS. Verified in a real
// browser via Report-Only mode first (only violation was recharts/d3 string
// evaluation, hence 'unsafe-eval'; our own code contains zero eval). Now
// enforcing. Allowed origins reflect what the app actually loads: Vercel
// analytics/speed-insights, Supabase (REST + realtime wss), Sentry ingest,
// the recharts charting lib, and Google Identity Services (the /gsi/
// entries below are the exact set Google's GIS CSP guide requires for the
// sign-in button: script, connect, frame, style). Google Fonts is NOT
// listed: every font (page fonts + the opengraph-image.tsx OG card font)
// is self-hosted as of 2026-08-14 - see the comments in src/app/layout.tsx
// and src/app/opengraph-image.tsx. Don't re-add fonts.googleapis.com /
// fonts.gstatic.com here without also reintroducing a runtime font fetch.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://va.vercel-scripts.com https://vitals.vercel-insights.com https://*.sentry.io https://*.ingest.sentry.io https://accounts.google.com/gsi/",
  "frame-src https://accounts.google.com/gsi/",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  // Keep the headless-Chrome deps out of the Server Components bundle so the
  // native chromium binary is loaded via require() rather than traced/bundled
  // (which breaks its executablePath resolution on Vercel). Both are already
  // on Next's built-in externals list; listing them here is explicit + safe.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  // @sparticuz/chromium loads its brotli-compressed binaries (bin/chromium.br,
  // etc.) dynamically at runtime, so @vercel/nft's static file tracer never
  // copies them into the serverless function — the JS is externalized but the
  // bin/ blobs are missing, causing a 500 ("input directory .../bin does not
  // exist") on Vercel. Force-include them for the PDF route. Only one route
  // lives under /api/documents (the pdf route), so this broad glob is precise
  // in practice and sidesteps picomatch treating "[id]" as a character class.
  outputFileTracingIncludes: {
    "/api/documents/**": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  // The black-gold marketing site was promoted from /v2 to the root domain
  // (it IS the published site now). Permanently redirect the old /v2 URLs to
  // their new root equivalents so any external/bookmarked /v2 link + old
  // /v2/login land on the real pages and consolidate SEO on the root.
  async redirects() {
    return [
      { source: "/v2", destination: "/", permanent: true },
      { source: "/v2/:path*", destination: "/:path*", permanent: true },
      // The app now lives on its own domain (friendlyinvoice.co.il), but the
      // original *.vercel.app deployment still served every page with a 200 —
      // i.e. the whole site existed twice as far as a crawler is concerned.
      // The canonical tags already pointed at the real domain, which mitigates
      // it, but a 308 is the unambiguous signal and consolidates link equity
      // on the domain we actually want ranked. Scoped by `has: host` so it can
      // only ever fire for the legacy hostname; the custom domain and local
      // dev are untouched. Preview deploys (*-hash.vercel.app) don't match the
      // literal host either, so they keep working normally.
      {
        source: "/:path*",
        has: [{ type: "host", value: "mysuperfriendlyinvoiceapp.vercel.app" }],
        destination: "https://friendlyinvoice.co.il/:path*",
        permanent: true,
      },
    ];
  },
  // security.txt is generated (its Canonical/Policy URLs follow
  // CANONICAL_ORIGIN) rather than served as a static file. A dot-prefixed
  // app-router segment is unreliable, so the well-known path is rewritten to
  // a normal route instead.
  async rewrites() {
    return [
      { source: "/.well-known/security.txt", destination: "/api/security-txt" },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "mysuperfriendlyinvoiceapp",
  project: "invoice-app",
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
