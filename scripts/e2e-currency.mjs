import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const env = (()=>{try{return readFileSync(new URL("../.env.local", import.meta.url),"utf8");}catch{console.error("ENV_FILE_GUARD: .env.local not found next to scripts/ — run from the project with .env.local present");process.exit(1);}})().split("\n").filter(l=>l&&!l.startsWith("#")).reduce((a,l)=>{const[k,...r]=l.split("=");if(k)a[k.trim()]=r.join("=").trim();return a;},{});
const SUPA=env.NEXT_PUBLIC_SUPABASE_URL, SK=env.SUPABASE_SERVICE_ROLE_KEY, AK=env.NEXT_PUBLIC_SUPABASE_ANON_KEY, EMAIL="asafkotlar@gmail.com";
const admin=createClient(SUPA,SK,{auth:{persistSession:false}});
const anon=createClient(SUPA,AK,{auth:{persistSession:false}});
const {data:list}=await admin.auth.admin.listUsers();
const user=list.users.find(u=>u.email===EMAIL);
if(!user){console.error("user not found:",EMAIL);process.exit(1);}
const {data:link,error:gerr}=await admin.auth.admin.generateLink({type:"magiclink",email:EMAIL});
if(gerr||!link?.properties?.email_otp){console.error("generateLink failed:",gerr?.message||"no otp");process.exit(1);}
let {data:sess,error:ve}=await anon.auth.verifyOtp({email:EMAIL,token:link.properties.email_otp,type:"email"});
let verr;
if(ve){({data:sess,error:verr}=await anon.auth.verifyOtp({email:EMAIL,token:link.properties.email_otp,type:"magiclink"}));}
if(verr||!sess?.session){console.error("OTP verification failed:",verr?.message??ve?.message);process.exit(1);}
const tok=sess.session.access_token;
const userClient=createClient(SUPA,AK,{global:{headers:{Authorization:`Bearer ${tok}`}},auth:{persistSession:false}});
const {data:bizs}=await admin.from("businesses").select("id").eq("user_id",user.id);
if(!bizs||!bizs.length){console.error("no business found for user");process.exit(1);}
const bid=bizs[0].id;
const id=randomUUID();
// USD zero-rated export: $1000, rate 2.938 -> ₪2938
const {data,error}=await userClient.rpc("create_document_atomic",{
  p_business_id:bid,p_id:id,p_type:"tax_invoice",p_date:"2026-06-09",p_client_id:null,
  p_client_name:"E2E Currency Test",p_subject:"USD export smoke",p_status:"draft",
  p_subtotal:1000,p_vat:0,p_total:1000,p_payment_method:null,p_notes:null,p_items:[],
  p_currency:"USD",p_exchange_rate:2.938,p_subtotal_ils:2938,p_vat_ils:0,p_total_ils:2938,p_zero_rated:true
});
console.log("create_document_atomic:", error?("ERR: "+error.message):JSON.stringify(data));
if(!error){
  const {data:row}=await admin.from("documents").select("currency,exchange_rate,total,total_ils,zero_rated,vat").eq("id",id).maybeSingle();
  console.log("persisted row:", JSON.stringify(row));
  if(!row){console.error("row not found after insert");process.exit(1);}
  const ok = row.currency==="USD" && Number(row.total)===1000 && Number(row.total_ils)===2938 && row.zero_rated===true && Number(row.vat)===0;
  console.log(ok ? "✓ PASS — USD doc persisted with correct ₪ snapshot + zero-rated" : "✗ FAIL — values off");
  // cleanup the test doc
  await admin.from("document_items").delete().eq("document_id",id);
  await admin.from("documents").delete().eq("id",id);
  console.log("cleaned up test doc");
}
