"use client";

// Browser half of web push: what this device is allowed to do, whether it is
// already subscribed, and the two buttons that change that.
//
// Nothing here asks for permission on its own. `Notification.requestPermission`
// is only ever reached from subscribeToPush(), which the settings card calls
// from a click - a permission prompt that appears on page load is how a user
// learns to press "block" forever.

import { supabase } from "./supabase";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

export type PushPermission = "granted" | "denied" | "default" | "unsupported";

/**
 * Is the feature deployed at all? Separate from isPushSupported() on purpose:
 * a build without a VAPID key must hide the settings card, not tell the user
 * their browser is at fault.
 */
export function isPushConfigured(): boolean {
  return VAPID_PUBLIC_KEY.length > 0;
}

/** True when this browser can do web push at all (SW + Push API + VAPID key). */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    isPushConfigured()
  );
}

export function getPermissionState(): PushPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as PushPermission;
}

/**
 * iOS only delivers web push to a site that was added to the home screen.
 * Returns true for an iPhone/iPad that is NOT running as an installed app, so
 * the settings card can say "add to home screen first" instead of showing a
 * button that can only fail.
 */
export function isIosWithoutInstall(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (/Macintosh/.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  const standalone =
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone;
}

/**
 * The VAPID public key travels as base64url; PushManager wants raw bytes.
 * Returns Uint8Array<ArrayBuffer> explicitly (not the default
 * ArrayBufferLike): applicationServerKey is typed as BufferSource, which a
 * possibly-shared buffer does not satisfy.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  // SwRegister registers /sw.js on load; register again (idempotent) so this
  // still works on a page opened before that effect ran.
  await navigator.serviceWorker.register("/sw.js").catch(() => {});
  return navigator.serviceWorker.ready;
}

async function authHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("ההתחברות שלך פגה. רעננו את הדף ונסו שוב.");
  return { Authorization: `Bearer ${session.access_token}` };
}

/** Is THIS browser already subscribed? (Per device, not per account.) */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return null;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export class PushPermissionDeniedError extends Error {}

/**
 * Ask for permission, subscribe this device, and register it with the server.
 * Must be called from a user gesture.
 */
export async function subscribeToPush(): Promise<void> {
  if (!isPushSupported()) throw new Error("הדפדפן הזה לא תומך בהתרעות.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new PushPermissionDeniedError("ההרשאה להתרעות לא ניתנה.");
  }

  const registration = await readyRegistration();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));

  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      userAgent: navigator.userAgent,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "ההרשמה להתרעות נכשלה.");
  }
}

/**
 * Stop this device receiving push: drop the row on the server first (so a
 * failure there does not leave an orphan the sender keeps trying), then let
 * the browser go.
 */
export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getExistingSubscription();
  if (!subscription) return;

  const res = await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "כיבוי ההתרעות נכשל.");
  }

  await subscription.unsubscribe().catch(() => {});
}

/** "שלחו התרעת בדיקה" - proves the device shows anything at all. */
export async function sendTestPush(): Promise<void> {
  const res = await fetch("/api/push/test", {
    method: "POST",
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "שליחת הבדיקה נכשלה.");
  }
}
