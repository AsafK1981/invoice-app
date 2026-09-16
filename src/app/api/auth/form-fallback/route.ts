import { NextRequest, NextResponse } from "next/server";

/**
 * Where the login form goes if it is ever submitted before its JavaScript
 * handler is attached.
 *
 * The form is handled entirely in JavaScript (handleSubmit calls Supabase).
 * It had no method, so a plain browser submit would have been a GET, putting
 * the email and password into the URL - the address bar, browser history,
 * request logs and Referer headers. That happened on the local dev server on
 * 2026-09-16, where the page is server-rendered and the form is visible
 * before hydration.
 *
 * Production is not exposed today: /login is static and LoginClient renders
 * inside <Suspense fallback={null}>, so the form only appears once the client
 * has rendered it with its handler attached (the static HTML contains no
 * password field at all). This is the guard for the day that stops being
 * true - a server-rendered login page, a changed fallback - so the failure
 * mode is a harmless reload instead of a password in a URL.
 *
 * The form POSTs here. A POST body never enters the URL or the request log,
 * and pointing at a route rather than at /login itself (a static page, which
 * answers POST with 405) gives the user a normal page back.
 *
 * This handler deliberately NEVER READS THE BODY. It does not try to sign
 * anyone in, so it adds no credential-handling surface. 303 turns the POST
 * into a GET so a refresh cannot resubmit anything.
 */
export function POST(req: NextRequest) {
  const target = new URL("/login", req.url);
  target.searchParams.set("error", "form_early");
  return NextResponse.redirect(target, 303);
}
