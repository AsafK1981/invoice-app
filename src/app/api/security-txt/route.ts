import { absoluteUrl } from "@/lib/public-url";

// Serves /.well-known/security.txt via a rewrite in next.config.ts.
//
// Why not src/app/.well-known/security.txt/route.ts: a dot-prefixed segment is
// not reliably picked up by the Next build, so the well-known path is mapped
// here with a rewrite instead. Replaces the former static
// public/.well-known/security.txt (the two cannot coexist).
export const dynamic = "force-static";

// RFC 9116 requires an absolute Expires timestamp. Kept as a literal so it is
// an explicit, reviewable date rather than a moving target.
const EXPIRES = "2027-05-06T00:00:00.000Z";

export function GET(): Response {
  const body = [
    "Contact: mailto:asafkotlar@gmail.com",
    `Expires: ${EXPIRES}`,
    "Preferred-Languages: he, en",
    `Canonical: ${absoluteUrl("/.well-known/security.txt")}`,
    `Policy: ${absoluteUrl("/privacy")}`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
