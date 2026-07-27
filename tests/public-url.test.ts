import { describe, it, expect } from "vitest";
import {
  CANONICAL_ORIGIN,
  CANONICAL_HOST,
  absoluteUrl,
  publicDocumentUrl,
} from "@/lib/public-url";

/**
 * REGRESSION GUARD: the canonical origin is the one value a domain migration
 * has to change.
 *
 * Before this existed, "mysuperfriendlyinvoiceapp.vercel.app" was written out
 * by hand in ~30 places (layout metadataBase, sitemap, robots, the PDF footer,
 * eight API routes). Buying a domain therefore meant a 30-file sweep where a
 * single miss ships a wrong canonical or a dead share link, silently.
 *
 * These tests pin the contract the rest of the app now depends on:
 *   - no trailing slash, so `${CANONICAL_ORIGIN}/foo` is always well formed
 *   - CANONICAL_HOST is bare (no protocol), because the document/PDF footer
 *     prints it as text rather than linking it
 *   - absoluteUrl tolerates a missing leading slash
 *
 * Note these assert SHAPE, not the specific vercel.app domain — pinning the
 * domain here would make this suite fail on the very migration it protects.
 */
describe("canonical origin", () => {
  it("is an absolute https origin with no trailing slash", () => {
    expect(CANONICAL_ORIGIN).toMatch(/^https:\/\/[^/]+$/);
    expect(CANONICAL_ORIGIN.endsWith("/")).toBe(false);
  });

  it("exposes a bare host with no protocol or slashes", () => {
    expect(CANONICAL_HOST).not.toContain("://");
    expect(CANONICAL_HOST).not.toContain("/");
    expect(CANONICAL_ORIGIN).toContain(CANONICAL_HOST);
  });
});

describe("absoluteUrl", () => {
  it("joins an app-relative path onto the origin", () => {
    expect(absoluteUrl("/sitemap.xml")).toBe(`${CANONICAL_ORIGIN}/sitemap.xml`);
  });

  it("adds the missing leading slash rather than concatenating blindly", () => {
    expect(absoluteUrl("blog/x")).toBe(`${CANONICAL_ORIGIN}/blog/x`);
  });

  it("never produces a doubled slash after the origin", () => {
    for (const path of ["/", "/vs", "vs", "/blog/a-post"]) {
      expect(absoluteUrl(path)).not.toMatch(/[^:]\/\//);
    }
  });
});

describe("publicDocumentUrl", () => {
  // The 2026-05-03 incident this whole module exists for: share links captured
  // on a per-deploy hash URL kept serving pre-fix code for days.
  it("always builds on the canonical origin, never a deploy-hash host", () => {
    const url = publicDocumentUrl("abc-123");
    expect(url).toBe(`${CANONICAL_ORIGIN}/view/abc-123`);
    expect(url.startsWith(CANONICAL_ORIGIN)).toBe(true);
  });
});
