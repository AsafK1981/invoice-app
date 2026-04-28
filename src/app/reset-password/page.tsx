"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, Lock, Eye, EyeOff, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionReady(true);
      if (!session) {
        setError(
          "קישור האיפוס פג תוקף או אינו תקין. בקש קישור חדש מעמוד ההתחברות."
        );
      }
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("הסיסמה חייבת להיות לפחות 6 תווים");
      return;
    }
    if (password !== confirmPassword) {
      setError("הסיסמאות לא תואמות");
      return;
    }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => {
      router.push("/dashboard");
      router.refresh();
    }, 2000);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-orange-50 to-amber-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8 animate-fade-in-up">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center mx-auto shadow-xl shadow-orange-200/50 btn-glow">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold text-stone-900 mt-4">איפוס סיסמה</h1>
          <p className="text-sm text-stone-600 mt-1">בחר סיסמה חדשה לחשבון שלך</p>
        </div>

        <div className="card-soft p-8 animate-fade-in-up stagger-2">
          {success ? (
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center mx-auto shadow-md mb-4">
                <CheckCircle2 className="w-8 h-8 text-white" />
              </div>
              <h2 className="font-bold text-stone-900 text-lg">הסיסמה עודכנה!</h2>
              <p className="text-sm text-stone-700 mt-2">מעביר אותך לדשבורד...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-stone-700 mb-1 block">סיסמה חדשה</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
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
                    disabled={!sessionReady || !!error}
                    className="input-warm pl-3 pr-10"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-stone-700 mb-1 block">אישור סיסמה</label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    dir="ltr"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    disabled={!sessionReady || !!error}
                    className="input-warm pr-10"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-xl">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !sessionReady || !!error}
                className="w-full btn-glow inline-flex items-center justify-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200/60 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {loading ? "שומר..." : "עדכן סיסמה"}
              </button>

              <Link
                href="/login"
                className="block text-center text-sm text-stone-600 hover:text-stone-900"
              >
                חזרה להתחברות
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
