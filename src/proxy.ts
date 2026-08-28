import { NextResponse, type NextRequest } from "next/server";

/**
 * Case-fold the /product landing page.
 *
 * Asaf hands the page out by voice and in group replies as
 * "FriendlyInvoice.co.il/Product" (28.08.2026). App routes are case-sensitive,
 * so the capitalised path typed by hand was a 404.
 *
 * Why a proxy (the file convention that replaced middleware) and not
 * `redirects()` in next.config: Next matches redirect
 * sources case-INSENSITIVELY, so `{ source: "/Product", destination: "/product" }`
 * also matched /product itself and sent production into an infinite 308 loop
 * (shipped and reverted within minutes on 28.08.2026). Plain string comparison
 * here is case-sensitive, so the lowercase path passes straight through.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const lower = pathname.toLowerCase();
  // Only the landing page is case-folded; everything else passes untouched.
  if (pathname !== lower && (lower === "/product" || lower.startsWith("/product/"))) {
    const url = req.nextUrl.clone();
    url.pathname = lower;
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

// The matcher is case-SENSITIVE (verified locally 28.08.2026: a matcher of
// "/product" never saw /Product), so it has to be broad enough to catch the
// capitalised spellings. Static assets and API routes are excluded; the
// function above returns immediately for every other path.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|downloads/).*)"],
};
