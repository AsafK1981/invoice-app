// The origin a request actually arrived on, for building redirect URLs that
// point back at the same host the user is using.
//
// The app answers on several hosts (the canonical domain, the old
// vercel.app host, preview deploys, localhost), and an OAuth redirect_uri
// has to match one that is registered AND be the one the user came from -
// a redirect to a different host would drop their session cookie. Vercel
// puts the public host in x-forwarded-host; locally there is only Host.
//
// The header is client-influenced, so the host is checked against the short
// list of hosts this app is actually served on before it is trusted. Anything
// else falls back to the canonical origin: a request that lies about its host
// gets sent to the real site, never to the host it named. (Council review
// 2026-09-07: Google's exact redirect_uri match already contains the OAuth
// side; this closes the post-callback redirect as well.)

import { CANONICAL_HOST, CANONICAL_ORIGIN } from "./public-url";

const EXACT_HOSTS = new Set([
  CANONICAL_HOST,
  `www.${CANONICAL_HOST}`,
  "mysuperfriendlyinvoiceapp.vercel.app", // domain-literal-ok: the old host stays attached on purpose, see AGENTS.md
]);

/** Vercel preview deploys of this project, e.g. mysuperfriendlyinvoiceapp-abc123-asafk1981s-projects.vercel.app */
const PREVIEW_HOST = /^mysuperfriendlyinvoiceapp-[a-z0-9]+-asafk1981s-projects\.vercel\.app$/;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d{2,5})?$/;

export function isAllowedRequestHost(host: string): boolean {
  const h = host.toLowerCase();
  return EXACT_HOSTS.has(h) || PREVIEW_HOST.test(h) || LOCAL_HOST.test(h);
}

export function requestOrigin(req: Request): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = (forwardedHost || req.headers.get("host") || "").split(",")[0].trim().toLowerCase();
  if (!host || !isAllowedRequestHost(host)) return CANONICAL_ORIGIN;
  const proto = LOCAL_HOST.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}
