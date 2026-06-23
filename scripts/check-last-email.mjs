import { ImapFlow } from "imapflow";
import { readFileSync } from "node:fs";
import { decodeAllText } from "./lib/mime-decode.mjs";
const env=(()=>{try{return readFileSync(new URL("../.env.local",import.meta.url),"utf8");}catch{console.error("ENV_FILE_GUARD: .env.local not found");process.exit(1);}})().split("\n").filter(l=>l&&!l.startsWith("#")).reduce((a,l)=>{const[k,...r]=l.split("=");if(k)a[k.trim()]=r.join("=").trim();return a;},{});
if(!env.GMAIL_USER||!env.GMAIL_APP_PASSWORD){console.error("gmail creds missing");process.exit(1);}
const c=new ImapFlow({host:"imap.gmail.com",port:993,secure:true,connectionTimeout:15000,greetingTimeout:10000,socketTimeout:30000,auth:{user:env.GMAIL_USER,pass:env.GMAIL_APP_PASSWORD.replace(/\s+/g,"")},logger:false});
try{
  await c.connect();
  for(const folder of ["INBOX","[Gmail]/Sent Mail"]){
    const lock=await c.getMailboxLock(folder);
    try{
      const uids=await c.search({subject:"E2E ownership test"});
      if(!uids||!uids.length){ continue; }
      const uid=uids[uids.length-1];
      const msg=await c.fetchOne(uid,{source:true,envelope:true});
      // Decode per transfer-encoding/charset — Resend sends multipart with
      // QP/base64 parts, so the raw source never contains the Hebrew (or even
      // the ASCII tokens, if base64) literally. Searching raw = false negatives.
      const raw=msg.source?.toString("binary")||"";
      console.log(`\n=== found in ${folder} (subj: ${msg.envelope?.subject}) ===`);
      const hay=decodeAllText(raw);
      console.log("contains REAL business 'אסף קוטלר':", /אסף קוטלר/.test(hay));
      console.log("contains REAL doc number '30036':", /30036/.test(hay));
      console.log("contains REAL total 1,550:", /1[,.]?550/.test(hay));
      console.log("contains SPOOFED 'SPOOFED-BUSINESS':", /SPOOFED-BUSINESS/.test(hay));
      console.log("contains SPOOFED '99999':", /99999/.test(hay));
      console.log("contains SPOOFED '123456':", /123456/.test(hay));
      break;
    } finally { lock.release(); }
  }
} finally { try{await c.logout();}catch{} }
