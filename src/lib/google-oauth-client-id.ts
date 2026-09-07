// The one Google OAuth client this app uses, in GCP project "for my website"
// (299738514450).
//
// It is a PUBLIC value by design - it ships in every "Sign in with Google"
// button on the web - so it lives in source rather than in an env var, where
// a missing variable would silently break login. The matching client SECRET
// is never here: it is read server-side from GOOGLE_OAUTH_CLIENT_SECRET and
// is only needed by the Gmail connect flow, not by sign-in.
//
// Two features share it, which is why it is its own module:
//   * sign-in (Google Identity Services, redirect mode) - login-client.tsx
//   * "חבר את Gmail" for expenses from email - src/lib/gmail-connect.ts
//
// Because they share one client, both of their redirect URIs have to stay
// registered under "Authorized redirect URIs" on that client in GCP:
//   /api/auth/google-redirect   (sign-in)
//   /api/gmail/callback         (Gmail connect)
// on every origin the app answers on.
export const GOOGLE_OAUTH_CLIENT_ID =
  "299738514450-l904155luql8fn7focq4hrlf921u3uvt.apps.googleusercontent.com";
