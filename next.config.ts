import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Content-Security-Policy — defense-in-depth against XSS. Verified in a real
// browser via Report-Only mode first (only violation was recharts/d3 string
// evaluation, hence 'unsafe-eval'; our own code contains zero eval). Now
// enforcing. Allowed origins reflect what the app actually loads: Vercel
// analytics/speed-insights, Google Fonts, Supabase (REST + realtime wss),
// Sentry ingest, and the recharts charting lib.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://va.vercel-scripts.com https://vitals.vercel-insights.com https://*.sentry.io https://*.ingest.sentry.io",
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
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "mysuperfriendlyinvoiceapp",
  project: "invoice-app",
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
