import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = (()=>{try{return readFileSync(new URL("../.env.local", import.meta.url),"utf8");}catch{console.error("ENV_FILE_GUARD: .env.local not found next to scripts/, run from the project with .env.local present");process.exit(1);}})()
  .split("\n").filter(l=>l&&!l.startsWith("#"))
  .reduce((a,l)=>{const[k,...r]=l.split("=");if(k)a[k.trim()]=r.join("=").trim();return a;},{});
const SUPA_URL=env.NEXT_PUBLIC_SUPABASE_URL, SK=env.SUPABASE_SERVICE_ROLE_KEY, AK=env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL="asafkotlar@gmail.com";
const BASE=process.env.BASE_URL || "https://mysuperfriendlyinvoiceapp.vercel.app";
const admin=createClient(SUPA_URL,SK,{auth:{autoRefreshToken:false,persistSession:false}});
const anon=createClient(SUPA_URL,AK,{auth:{persistSession:false}});

// 1. find user
const { data:list } = await admin.auth.admin.listUsers();
const user=list.users.find(u=>u.email===EMAIL);
if(!user){ console.error("user not found"); process.exit(1); }
console.log("user:", user.id);

// 2. mint a session token via admin magiclink + verifyOtp (no email sent by generateLink)
const { data:link, error:gerr } = await admin.auth.admin.generateLink({ type:"magiclink", email:EMAIL });
if(gerr){ console.error("generateLink:", gerr.message); process.exit(1); }
const otp=link.properties.email_otp;
let { data:sess, error:verr } = await anon.auth.verifyOtp({ email:EMAIL, token:otp, type:"email" });
if(verr){ ({data:sess,error:verr}=await anon.auth.verifyOtp({email:EMAIL,token:otp,type:"magiclink"})); }
if(verr||!sess?.session){ console.error("verifyOtp:", verr?.message); process.exit(1); }
const tok=sess.session.access_token;
console.log("minted access token (len):", tok.length);

// 3. find a real document owned by this user's business
const { data:bizs } = await admin.from("businesses").select("id, name").eq("user_id", user.id);
const bizIds=(bizs||[]).map(b=>b.id);
const { data:doc } = await admin.from("documents").select("id, number, total, client_name").in("business_id", bizIds).limit(1).maybeSingle();
if(!doc){ console.error("no document owned by this user"); process.exit(1); }
console.log("real doc:", JSON.stringify(doc), "| real business:", bizs[0]?.name);

// 4. call live endpoint with SPOOFED body content (should be IGNORED)
try {
  const res=await fetch(`${BASE}/api/send-email`,{method:"POST",headers:{Authorization:`Bearer ${tok}`,"Content-Type":"application/json"},
    body:JSON.stringify({ documentId:doc.id, to:EMAIL, clientName:"SPOOFED-CLIENT", receiptNumber:"99999", total:123456, businessName:"SPOOFED-BUSINESS", subject:"E2E ownership test" })});
  const out=await res.json().catch(()=>({error:"non-JSON response"}));
  console.log("\n=== /api/send-email response ===");
  console.log("HTTP", res.status, JSON.stringify(out));

  // 5. negative test: a random (unowned) documentId must be 403/404
  const res2=await fetch(`${BASE}/api/send-email`,{method:"POST",headers:{Authorization:`Bearer ${tok}`,"Content-Type":"application/json"},
    body:JSON.stringify({ documentId:"00000000-0000-4000-8000-000000000000", to:EMAIL })});
  console.log("unowned documentId →", res2.status, "(expect 404/403)");
} catch (err) {
  console.error("network error calling /api/send-email:", err instanceof Error ? err.message : err);
  process.exit(1);
}
