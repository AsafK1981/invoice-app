"use client";

import { Suspense, useEffect, useId, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Mail, LogIn, UserPlus, Eye, EyeOff, ArrowRight, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { track } from "@vercel/analytics";

type Mode = "login" | "signup" | "forgot";

// Google sign-in uses the GIS (Google Identity Services) pre-built button +
// signInWithIdToken, NOT signInWithOAuth. The OAuth redirect flow was tested
// end to end on 2026-08-04 and abandoned: Google renders "continue to
// <project-ref>.supabase.co" because the redirect URI lives on Supabase's
// domain, and only the paid custom-domain add-on changes that. The GIS flow
// keeps the ID token on OUR origin, so the consent screen says
// friendlyinvoice.co.il. Free on every Supabase plan.
//
// ux_mode is "redirect", not "popup" (2026-08-12): the popup flow silently
// died on mobile - users picked their Google account and the credential
// never made it back to the opener tab (Safari ITP / in-app browsers), so
// the exchange never even reached Supabase. In redirect mode Google
// full-page-navigates and POSTs the credential to /api/auth/google-redirect
// on our origin - no popup, no cross-tab handoff, works everywhere. That
// login_uri must stay registered under "Authorized redirect URIs" on the
// GCP OAuth client (project "for my website").
const GOOGLE_CLIENT_ID =
  "299738514450-l904155luql8fn7focq4hrlf921u3uvt.apps.googleusercontent.com";

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    nonce?: string;
    ux_mode?: "popup" | "redirect";
    login_uri?: string;
    use_fedcm_for_prompt?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type?: string;
      theme?: string;
      size?: string;
      text?: string;
      shape?: string;
      width?: number;
      locale?: string;
    },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

/** Friendly Hebrew message for ?error= codes set by /api/auth/google-redirect. */
function googleErrorMessage(code: string | null): string | null {
  if (!code || !code.startsWith("google")) return null;
  return "ההתחברות עם Google לא הושלמה. נסה שוב.";
}

/** SHA-256 hex digest - GIS receives the hashed nonce, Supabase the raw one. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Deep-link support: the marketing trial CTAs point at /login?mode=signup
  // so the register form opens directly instead of the login form.
  const [mode, setMode] = useState<Mode>(
    searchParams.get("mode") === "signup" ? "signup" : "login"
  );
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  // A failed redirect-mode Google sign-in lands back here with ?error=google_*.
  const [error, setError] = useState<string | null>(
    googleErrorMessage(searchParams.get("error"))
  );
  const [success, setSuccess] = useState<string | null>(null);
  // Resend-confirmation state for the post-signup screen.
  const [signupEmailSent, setSignupEmailSent] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [googleReady, setGoogleReady] = useState(false);

  // Load the GIS script once and render the official Google button. The
  // pre-built button is required: only GIS-rendered UI can issue the ID token
  // credential on our own origin (which is what keeps supabase.co out of the
  // consent screen).
  useEffect(() => {
    if (mode === "forgot") return;
    let cancelled = false;

    async function renderGoogleButton() {
      const gsi = window.google?.accounts?.id;
      const parent = googleButtonRef.current;
      if (cancelled || !gsi || !parent) return;
      // GIS gets the SHA-256 of the nonce; the raw value rides a short-lived
      // cookie so /api/auth/google-redirect can hand it to Supabase, which
      // hashes it and compares against the ID token's nonce claim.
      // SameSite=None because Google's page POSTs to us cross-site - a Lax
      // cookie would simply not be sent on that request.
      const nonce = crypto.randomUUID();
      document.cookie = `g_oidc_nonce=${nonce}; path=/; max-age=600; secure; samesite=none`;
      gsi.initialize({
        client_id: GOOGLE_CLIENT_ID,
        ux_mode: "redirect",
        login_uri: `${window.location.origin}/api/auth/google-redirect`,
        nonce: await sha256Hex(nonce),
      });
      parent.innerHTML = "";
      gsi.renderButton(parent, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: mode === "signup" ? "signup_with" : "signin_with",
        shape: "pill",
        width: 320,
        locale: "he",
      });
      setGoogleReady(true);
    }

    if (window.google?.accounts?.id) {
      renderGoogleButton();
    } else {
      const existing = document.getElementById("google-gsi-script") as HTMLScriptElement | null;
      const script = existing ?? document.createElement("script");
      if (!existing) {
        script.id = "google-gsi-script";
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", renderGoogleButton);
      return () => {
        cancelled = true;
        script.removeEventListener("load", renderGoogleButton);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setSuccess(null);
    setSignupEmailSent(false);
  }

  async function handleResend() {
    if (resending || resendCooldown > 0) return;
    setResending(true);
    setError(null);
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email,
    });
    setResending(false);
    if (resendError) {
      setError(resendError.message);
    } else {
      setResendCooldown(60);
      setSuccess(`שלחנו שוב אימייל אישור אל ${email}. בדוק את תיבת הדואר (וגם ספאם).`);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (mode === "signup") {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=/onboarding` },
      });
      if (signUpError) {
        setError(signUpError.message);
      } else {
        track("sign_up");
        // Deferred email verification: whether signUp() itself hands back a
        // session (some GoTrue configs sign the caller in immediately when
        // unverified sign-ins are allowed) is not guaranteed the same way
        // across all cases - so try both. If signUp already produced a
        // session, use it. Otherwise attempt an immediate password sign-in
        // with the same credentials (this is what actually returns a
        // session on the configs we've seen). Only if NEITHER produces a
        // session do we fall back to the original "check your inbox" flow,
        // which is exactly today's behaviour and stays fully correct if the
        // Supabase flag is ever off.
        let session = signUpData.session;
        if (!session) {
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          // A real rejection here (e.g. a weak-password policy already
          // surfaced by signUp, or some other credential issue) must not be
          // swallowed - but it also shouldn't override a genuine signUpError
          // since we already know signUp succeeded. Any signInWithPassword
          // failure here just means "no session yet", so we fall through to
          // the inbox screen; the original signup itself already succeeded.
          if (!signInError && signInData.session) {
            session = signInData.session;
          }
        }
        if (session) {
          router.push("/onboarding");
          router.refresh();
        } else {
          setSignupEmailSent(true);
          setResendCooldown(30);
          setSuccess(
            `שלחנו אימייל אישור אל ${email}. פתח את ההודעה (אולי בתיקיית הספאם) ולחץ על "אשר את הרישום".`
          );
        }
      }
    } else if (mode === "forgot") {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) {
        setError(resetError.message);
      } else {
        setSuccess(
          "אם הכתובת קיימת במערכת, ישלח אליה מייל עם קישור לאיפוס הסיסמה. בדוק את תיבת המייל שלך."
        );
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError(
          signInError.message === "Invalid login credentials"
            ? "אימייל או סיסמה שגויים"
            : signInError.message
        );
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    }
    setLoading(false);
  }

  const titles: Record<Mode, string> = {
    login: "התחבר לחשבון שלך",
    signup: "צור חשבון חדש",
    forgot: "איפוס סיסמה",
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-orange-50 to-amber-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8 animate-fade-in-up">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center mx-auto shadow-xl shadow-orange-200/50 btn-glow">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          {/* Hebrew brand, 2026-08-11. This page is the last step of the
              marketing funnel, and it used to greet arrivals with the Latin
              "MyFriendlyInvoiceApp" while every surface they had just read -
              header, footer, hero, page title - says "חשבונית ידידותית".
              Same name here or the click feels like it landed somewhere
              else. (The gold accent is NOT a bug: app-skin.css re-tints the
              coral family to gold app-wide, an approved decision, and this
              page is the app's front door.) */}
          <h1 className="text-xl font-bold text-stone-900 mt-4">חשבונית ידידותית</h1>
          <p className="text-sm text-stone-600 mt-1">{titles[mode]}</p>
        </div>

        {/* The launch-period promise, restated at the point of hesitation.
            The landing page makes it three times ("חינם בתקופת ההשקה, בלי
            כרטיס אשראי") and the form used to drop it entirely, which is
            exactly where a visitor decides whether to type an email.
            Signup only - it would be noise for someone logging back in or
            resetting a password. Wording matches the homepage hero and the
            pricing band verbatim so the two cannot drift apart. */}
        {mode === "signup" && (
          <ul className="mb-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-semibold text-stone-600 animate-fade-in-up">
            <li className="flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              חינם בתקופת ההשקה
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              בלי כרטיס אשראי
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              אפשר לבטל בכל רגע
            </li>
          </ul>
        )}

        <div className="card-soft p-8 animate-fade-in-up stagger-2">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor={emailId} className="text-xs font-semibold text-stone-700 mb-1 block">אימייל</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  id={emailId}
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="input-warm pr-10"
                />
              </div>
            </div>

            {mode !== "forgot" && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor={passwordId} className="text-xs font-semibold text-stone-700">סיסמה</label>
                  {mode === "login" && (
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="text-xs text-orange-600 hover:underline"
                    >
                      שכחתי את הסיסמה
                    </button>
                  )}
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 transition-colors"
                    aria-label={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <input
                    id={passwordId}
                    type={showPassword ? "text" : "password"}
                    dir="ltr"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="input-warm pl-3 pr-10"
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-xl">
                {error}
              </div>
            )}

            {success && (
              <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-xl">
                {success}
              </div>
            )}

            {mode === "signup" && signupEmailSent && (
              <div className="text-center text-sm text-stone-600">
                לא קיבלת את המייל?{" "}
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending || resendCooldown > 0}
                  className="text-orange-600 font-semibold hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
                >
                  {resending
                    ? "שולח..."
                    : resendCooldown > 0
                      ? `שלח שוב בעוד ${resendCooldown} שנ׳`
                      : "שלח שוב את המייל"}
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-glow inline-flex items-center justify-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200/60 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none transition-all duration-200"
            >
              {loading ? (
                "..."
              ) : mode === "login" ? (
                <>
                  <LogIn className="w-4 h-4" />
                  התחבר
                </>
              ) : mode === "signup" ? (
                <>
                  <UserPlus className="w-4 h-4" />
                  צור חשבון
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4" />
                  שלח קישור איפוס
                </>
              )}
            </button>
          </form>

          {mode !== "forgot" && (
            <>
              <div className={`relative my-6 ${googleReady ? "" : "hidden"}`}>
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-orange-200" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-xs text-stone-500">או</span>
                </div>
              </div>
              {/* GIS renders the official Google button in here */}
              <div ref={googleButtonRef} className="flex justify-center" />
            </>
          )}

          <div className="mt-5 text-center text-sm text-stone-600">
            {mode === "login" ? (
              <>
                אין לך חשבון?{" "}
                <button onClick={() => switchMode("signup")} className="text-orange-600 font-semibold hover:underline">
                  הרשם
                </button>
              </>
            ) : mode === "signup" ? (
              <>
                יש לך חשבון?{" "}
                <button onClick={() => switchMode("login")} className="text-orange-600 font-semibold hover:underline">
                  התחבר
                </button>
              </>
            ) : (
              <button
                onClick={() => switchMode("login")}
                className="inline-flex items-center gap-1 text-orange-600 font-semibold hover:underline"
              >
                <ArrowRight className="w-3 h-3" />
                חזרה להתחברות
              </button>
            )}
          </div>
        </div>

        {/* Way back to the marketing site. Without it this page is a dead
            end for anyone who arrived to look rather than to sign up - the
            only exits were "submit" or the browser's back button. */}
        <p className="mt-6 text-center">
          <a
            href="/"
            className="inline-flex items-center gap-1 text-xs font-semibold text-stone-500 hover:text-stone-800 transition-colors"
          >
            <ArrowRight className="w-3 h-3" aria-hidden="true" />
            חזרה לעמוד הבית
          </a>
        </p>
      </div>
    </div>
  );
}

export default function LoginClient() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
