import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  environment: process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === "production",
  // supabase-js coordinates auth-token refreshes between tabs with the
  // Web Locks API. When two tabs (or two parallel loads of /dashboard)
  // contend for the lock, the library deliberately steals it after a
  // timeout and the loser throws one of these. Nothing is lost - the
  // session is refreshed by whichever side won - so they are pure noise.
  ignoreErrors: [
    /Lock ".*" was released because another request stole it/,
    /Lock was stolen by another request/,
    /NavigatorLockAcquireTimeoutError/,
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
