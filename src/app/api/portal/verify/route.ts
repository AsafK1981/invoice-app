import { NextRequest, NextResponse } from "next/server";
import {
  verifyPortalToken,
  signPortalToken,
  PORTAL_COOKIE,
  PORTAL_SESSION_TTL_MS,
} from "@/lib/portal-token";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  // Demand aud="link" — refuse to bootstrap a session from anything
  // other than a freshly-emailed magic link.
  const payload = verifyPortalToken(token, "link");

  const baseUrl = "https://mysuperfriendlyinvoiceapp.vercel.app";

  if (!payload) {
    return NextResponse.redirect(
      `${baseUrl}/portal?error=expired`,
      { status: 303 },
    );
  }

  const sessionToken = signPortalToken(payload.email, PORTAL_SESSION_TTL_MS, "session");

  const res = NextResponse.redirect(`${baseUrl}/portal/me`, { status: 303 });
  res.cookies.set(PORTAL_COOKIE, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(PORTAL_SESSION_TTL_MS / 1000),
  });
  return res;
}
