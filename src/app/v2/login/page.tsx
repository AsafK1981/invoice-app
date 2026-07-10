"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, LogIn, UserPlus, Eye, EyeOff, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { track } from "@vercel/analytics";
import LogoV2 from "../components/LogoV2";

type Mode = "login" | "signup" | "forgot";

// Temporarily hidden: the Google OAuth consent screen shows the raw Supabase
// project URL ("…supabase.co") instead of the app name, which reads like a
// phishing prompt to a first-time user. Re-enable (flip to true) once the
// OAuth consent screen is branded (App name + logo in Google Cloud Console)
// and/or a Supabase custom auth domain is set up. Email signup is unaffected.
const GOOGLE_SIGNIN_ENABLED = false;

export default function LoginPageV2() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("login");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (mode === "signup") {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=/onboarding` },
      });
      if (signUpError) {
        setError(signUpError.message);
      } else {
        track("sign_up");
        setSuccess(
          `שלחנו אימייל אישור אל ${email}. פתח את ההודעה (אולי בתיקיית הספאם) ולחץ על "אשר את הרישום".`
        );
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
    <>
      {/* deco outer frame — matches the /v2 landing */}
      <div className="v2-frame" aria-hidden="true">
        <i className="tl" />
        <i className="tr" />
        <i className="bl" />
        <i className="br" />
      </div>

      <main className="v2-auth-main">
        <div className="v2-auth-shell">
          <div className="v2-auth-head">
            <Link href="/v2" aria-label="חשבונית — לדף הבית">
              <LogoV2 />
            </Link>
            <div>
              <div className="v2-auth-title v2-gold">{titles[mode]}</div>
              <div className="v2-auth-sub">
                המערכת הכי ידידותית לעוסקים פטורים בישראל
              </div>
            </div>
          </div>

          <div className="v2-auth-card">
            <i className="corner c1" />
            <i className="corner c2" />
            <i className="corner c3" />
            <i className="corner c4" />

            <form onSubmit={handleSubmit} className="v2-auth-form">
              <div className="v2-field">
                <label className="v2-label">אימייל</label>
                <div className="v2-input-wrap">
                  <Mail className="v2-input-icon" />
                  <input
                    type="email"
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="v2-input"
                  />
                </div>
              </div>

              {mode !== "forgot" && (
                <div className="v2-field">
                  <div className="v2-field-row">
                    <label className="v2-label">סיסמה</label>
                    {mode === "login" && (
                      <button
                        type="button"
                        onClick={() => switchMode("forgot")}
                        className="v2-link"
                      >
                        שכחתי את הסיסמה
                      </button>
                    )}
                  </div>
                  <div className="v2-input-wrap">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="v2-input-toggle"
                      tabIndex={-1}
                      aria-label={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </button>
                    <input
                      type={showPassword ? "text" : "password"}
                      dir="ltr"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className="v2-input"
                    />
                  </div>
                </div>
              )}

              {error && <div className="v2-alert err">{error}</div>}

              {success && <div className="v2-alert ok">{success}</div>}

              <button type="submit" disabled={loading} className="v2-auth-btn">
                {loading ? (
                  "..."
                ) : mode === "login" ? (
                  <>
                    <LogIn />
                    התחבר
                  </>
                ) : mode === "signup" ? (
                  <>
                    <UserPlus />
                    צור חשבון
                  </>
                ) : (
                  <>
                    <Mail />
                    שלח קישור איפוס
                  </>
                )}
              </button>
            </form>

            {GOOGLE_SIGNIN_ENABLED && mode !== "forgot" && (
              <>
                <div className="v2-auth-or">
                  <span>או</span>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    await supabase.auth.signInWithOAuth({
                      provider: "google",
                      options: { redirectTo: `${window.location.origin}/dashboard` },
                    });
                  }}
                  className="v2-google-btn"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  התחבר עם Google
                </button>
              </>
            )}

            <div className="v2-auth-switch">
              {mode === "login" ? (
                <>
                  אין לך חשבון?{" "}
                  <button onClick={() => switchMode("signup")} className="v2-link">
                    הרשם
                  </button>
                </>
              ) : mode === "signup" ? (
                <>
                  יש לך חשבון?{" "}
                  <button onClick={() => switchMode("login")} className="v2-link">
                    התחבר
                  </button>
                </>
              ) : (
                <button
                  onClick={() => switchMode("login")}
                  className="v2-link v2-auth-back"
                >
                  <ArrowRight />
                  חזרה להתחברות
                </button>
              )}
            </div>
          </div>

          <div className="v2-auth-home">
            <Link href="/v2">חזרה לדף הבית</Link>
          </div>
        </div>
      </main>
    </>
  );
}
