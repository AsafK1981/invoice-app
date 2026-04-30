// This script can't actually check Supabase project URL config via the JS SDK.
// It's a reminder of what to verify manually in Supabase Dashboard.
console.log(`
=== ACTION REQUIRED IN SUPABASE DASHBOARD ===

Go to: https://supabase.com/dashboard/project/ddrlnwwuzehatjfachgu/auth/url-configuration

1. Site URL must be:
   https://invoice-app-ochre-five.vercel.app

2. Redirect URLs (allow list) should include:
   https://invoice-app-ochre-five.vercel.app/**
   https://invoice-app-ochre-five.vercel.app/onboarding
   https://invoice-app-ochre-five.vercel.app/reset-password
   https://invoice-app-ochre-five.vercel.app/dashboard
   http://localhost:3000/** (for local dev)

If Site URL is "http://localhost:3000" then email confirmation links
break for everyone except devs running locally.
`);
