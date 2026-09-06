"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, AlertCircle, Loader2, Send, Smartphone } from "lucide-react";
import { useBusiness, savePushKinds } from "@/lib/business-store";
import { useToast } from "@/components/ui/toast";
import { NOTIFICATION_KIND_LABELS, type NotificationKind } from "@/lib/notifications";
import {
  getExistingSubscription,
  getPermissionState,
  isIosWithoutInstall,
  isPushConfigured,
  isPushSupported,
  PushPermissionDeniedError,
  sendTestPush,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-client";

const ALL_KINDS = Object.keys(NOTIFICATION_KIND_LABELS) as NotificationKind[];

/**
 * "התרעות בדפדפן" - the device half of the notifications the app already
 * writes. Two separate decisions live in this one card, and the layout keeps
 * them apart on purpose:
 *
 *  1. Is THIS device receiving anything? A browser subscription, per device,
 *     that only a click can create (a permission prompt on page load is how a
 *     user learns to press "block" forever).
 *  2. WHICH kinds are worth interrupting for? An account-level list, so a
 *     phone and a laptop do not have to be configured twice.
 *
 * Every dead end has a way out written next to it: a blocked browser gets the
 * unblock path, an iPhone gets the add-to-home-screen path, and a subscribed
 * device gets a test button so "did that even work?" has an answer.
 */
export function PushSettingsSection() {
  const { business, ready } = useBusiness();
  const showToast = useToast();

  const [supported, setSupported] = useState<boolean | null>(null);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [permission, setPermission] = useState<ReturnType<typeof getPermissionState>>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState<"toggle" | "test" | null>(null);
  const [savingKind, setSavingKind] = useState<NotificationKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshDeviceState = useCallback(async () => {
    const ok = isPushSupported();
    setSupported(ok);
    setNeedsInstall(isIosWithoutInstall());
    setPermission(getPermissionState());
    if (!ok) {
      setSubscribed(false);
      return;
    }
    setSubscribed((await getExistingSubscription()) !== null);
  }, []);

  useEffect(() => {
    void refreshDeviceState();
  }, [refreshDeviceState]);

  const kinds = business.pushKinds ?? [];

  async function handleToggleDevice() {
    setError(null);
    setBusy("toggle");
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        showToast("ההתרעות כובו במכשיר הזה", "success");
      } else {
        await subscribeToPush();
        // First subscribe with nothing chosen yet would mean a device that
        // receives nothing, so the switch set starts meaningful: everything
        // on, and the rows below are where it gets narrowed.
        if (business.id && kinds.length === 0) {
          await savePushKinds(business.id, ALL_KINDS);
        }
        showToast("ההתרעות הופעלו במכשיר הזה", "success");
      }
      await refreshDeviceState();
    } catch (e) {
      const message =
        e instanceof PushPermissionDeniedError
          ? "הדפדפן חסם את ההתרעות. אפשר לאשר אותן דרך סמל המנעול שבשורת הכתובת."
          : e instanceof Error
            ? e.message
            : "הפעולה נכשלה.";
      setError(message);
      showToast(message, "error");
      await refreshDeviceState();
    } finally {
      setBusy(null);
    }
  }

  async function handleTest() {
    setError(null);
    setBusy("test");
    try {
      await sendTestPush();
      showToast("נשלחה התרעת בדיקה", "success");
    } catch (e) {
      const message = e instanceof Error ? e.message : "שליחת הבדיקה נכשלה.";
      setError(message);
      showToast(message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleKind(kind: NotificationKind, on: boolean) {
    if (!business.id) return;
    setError(null);
    setSavingKind(kind);
    const next = on ? [...kinds, kind] : kinds.filter((k) => k !== kind);
    try {
      await savePushKinds(business.id, next);
      showToast("ההגדרה נשמרה", "success");
    } catch (e) {
      const message = e instanceof Error ? e.message : "שגיאה בשמירה";
      setError(message);
      showToast(message, "error");
    } finally {
      setSavingKind(null);
    }
  }

  // No VAPID key in this build means the feature is not deployed; a card that
  // blames the browser for that would be a lie. A browser that genuinely
  // cannot do push DOES get a line, so someone who came looking for the
  // setting learns why it is not here.
  if (!isPushConfigured()) return null;

  const blocked = permission === "denied";
  const active = subscribed && !blocked;

  return (
    <div id="push" className="card-soft p-6 scroll-mt-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl ftile ftile-orange flex items-center justify-center flex-shrink-0">
          <BellRing className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-stone-900">התרעות בדפדפן</h2>
          <p className="text-sm text-stone-700 mt-1">
            אותן התראות שכבר מופיעות בפעמון, גם כשהאפליקציה סגורה - למשל לקוח שפתח חשבונית או תשלום שזוהה בבנק.
          </p>
        </div>
      </div>

      {/* 1. This device */}
      <div className="rounded-2xl border border-stone-200 bg-stone-50/60 p-4">
        {supported === null || !ready ? (
          <p className="text-sm text-stone-500">טוען...</p>
        ) : !supported ? (
          <div className="flex items-start gap-2 text-sm text-stone-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-stone-500" />
            <span>
              הדפדפן הזה לא תומך בהתרעות. בכרום, ספארי או פיירפוקס עדכניים זה יעבוד, וההתראות ממשיכות להופיע בפעמון בכל מקרה.
            </span>
          </div>
        ) : needsInstall ? (
          <div className="flex items-start gap-2 text-sm text-stone-700">
            <Smartphone className="w-4 h-4 flex-shrink-0 mt-0.5 text-stone-500" />
            <span>
              באייפון התרעות עובדות רק אחרי שמוסיפים את האפליקציה למסך הבית: כפתור השיתוף בסאפרי - הוסף למסך הבית - ואז לחזור לכאן.
            </span>
          </div>
        ) : blocked ? (
          <div className="flex items-start gap-2 text-sm text-stone-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
            <span>
              הדפדפן חוסם התרעות מהאתר הזה. לוחצים על סמל המנעול שליד הכתובת, מאשרים התראות, ומרעננים את הדף.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-stone-800 font-medium">
              {active ? "ההתרעות פעילות במכשיר הזה" : "ההתרעות כבויות במכשיר הזה"}
            </span>
            <div className="flex items-center gap-2 mr-auto flex-wrap">
              <button
                type="button"
                onClick={handleToggleDevice}
                disabled={busy !== null}
                className={
                  active
                    ? "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-stone-200 text-stone-700 hover:bg-stone-50 disabled:opacity-60"
                    : "inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-l from-orange-500 to-orange-700 hover:shadow-md hover:shadow-orange-200 disabled:from-stone-300 disabled:to-stone-300 disabled:shadow-none"
                }
              >
                {busy === "toggle" && <Loader2 className="w-4 h-4 animate-spin" />}
                {active ? "כבו במכשיר הזה" : "הפעילו במכשיר הזה"}
              </button>
              {active && (
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-60"
                >
                  {busy === "test" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  שלחו התרעת בדיקה
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2. Which kinds, for every device of this account */}
      <div className="mt-5">
        <p className="text-xs font-semibold text-stone-500 mb-3">
          על מה לקבל התרעה (חל על כל המכשירים שלכם)
        </p>
        <ul className="space-y-2">
          {ALL_KINDS.map((kind) => {
            const on = kinds.includes(kind);
            return (
              <li key={kind}>
                <label className="flex items-center gap-3 cursor-pointer py-1">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={savingKind !== null || !business.id}
                    onChange={(e) => handleKind(kind, e.target.checked)}
                    className="w-5 h-5 rounded text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm text-stone-900">{NOTIFICATION_KIND_LABELS[kind]}</span>
                  {savingKind === kind && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-400" />
                  )}
                </label>
              </li>
            );
          })}
        </ul>
        {kinds.length === 0 && (
          <p className="text-xs text-stone-500 mt-3">
            כרגע לא נבחר אף סוג, כך שלא תישלח אף התרעה למכשיר.
          </p>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
