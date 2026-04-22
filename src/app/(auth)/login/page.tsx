"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Mail, Lock, LogIn, UserPlus, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (mode === "signup") {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });
      if (signUpError) {
        setError(signUpError.message);
      } else {
        setSuccess("נשלח מייל אישור. בדוק את תיבת המייל שלך ולחץ על הקישור.");
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

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-orange-50 to-amber-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8 animate-fade-in-up">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center mx-auto shadow-xl shadow-orange-200/50 btn-glow">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold text-stone-900 mt-4">MySuperFriendlyInvoiceApp</h1>
          <p className="text-sm text-stone-600 mt-1">
            {mode === "login" ? "התחבר לחשבון שלך" : "צור חשבון חדש"}
          </p>
        </div>

        <div className="card-soft p-8 animate-fade-in-up stagger-2">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-stone-700 mb-1 block">אימייל</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
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

            <div>
              <label className="text-xs font-semibold text-stone-700 mb-1 block">סיסמה</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <input
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
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  צור חשבון
                </>
              )}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-orange-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-3 text-xs text-stone-500">או</span>
            </div>
          </div>

          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signInWithOAuth({
                provider: "google",
                options: { redirectTo: `${window.location.origin}/dashboard` },
              });
            }}
            className="w-full inline-flex items-center justify-center gap-3 bg-white border-2 border-stone-200 text-stone-800 py-3 rounded-2xl text-sm font-semibold hover:bg-stone-50 hover:border-stone-300 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:shadow-md cursor-pointer transition-all duration-200"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            התחבר עם Google
          </button>

          <div className="mt-5 text-center text-sm text-stone-600">
            {mode === "login" ? (
              <>
                אין לך חשבון?{" "}
                <button
                  onClick={() => { setMode("signup"); setError(null); setSuccess(null); }}
                  className="text-orange-600 font-semibold hover:underline"
                >
                  הרשם
                </button>
              </>
            ) : (
              <>
                יש לך חשבון?{" "}
                <button
                  onClick={() => { setMode("login"); setError(null); setSuccess(null); }}
                  className="text-orange-600 font-semibold hover:underline"
                >
                  התחבר
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
