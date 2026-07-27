import { ImapFlow } from "imapflow";
import { readFileSync } from "node:fs";
const env = (()=>{try{return readFileSync(new URL("../.env.local", import.meta.url),"utf8");}catch{console.error("ENV_FILE_GUARD: .env.local not found next to scripts/, run from the project with .env.local present");process.exit(1);}})()
  .split("\n").filter((l)=>l&&!l.startsWith("#"))
  .reduce((a,l)=>{const[k,...r]=l.split("=");if(k)a[k.trim()]=r.join("=").trim();return a;},{});
if(!env.GMAIL_USER||!env.GMAIL_APP_PASSWORD){
  console.error("GMAIL_USER / GMAIL_APP_PASSWORD missing in .env.local");
  process.exit(1);
}
const client = new ImapFlow({host:"imap.gmail.com",port:993,secure:true,
  connectionTimeout:15000,greetingTimeout:10000,socketTimeout:30000,
  auth:{user:env.GMAIL_USER,pass:env.GMAIL_APP_PASSWORD.replace(/\s+/g,"")},logger:false});
function b64decodeAll(raw){
  const lines=raw.split(/\r?\n/); let b="";
  for(const l of lines){ if(/^[A-Za-z0-9+/=]{30,}$/.test(l.trim())) b+=l.trim(); }
  try{ return Buffer.from(b,"base64").toString("utf8"); }catch(e){ console.error(`base64 decode failed: ${e.message}`); return ""; }
}
const out=[];
try{
  try{
    await client.connect();
  }catch(e){
    console.error(`IMAP connect failed: ${e.message}`);
    process.exit(1);
  }
  for(const folder of ["INBOX","[Gmail]/Sent Mail"]){
    const lock=await client.getMailboxLock(folder);
    try{
      const uids=await client.search({or:[{from:"taxes.gov.il"},{to:"taxes.gov.il"}]});
      for(const uid of (uids||[])){
        try{
          const msg=await client.fetchOne(uid,{source:true,envelope:true});
          const raw=msg.source?.toString("binary")||"";
          const dec=b64decodeAll(raw);
          const hay=raw+" "+dec;
          // look for software-number-ish mentions
          if(/תוכנה|software|מספר רישום|Accounting|רישום|מרשם/i.test(hay)){
            out.push({date:msg.envelope?.date?.toISOString?.()||"?",
              subj:msg.envelope?.subject||"",
              from:msg.envelope?.from?.[0]?.address||"",
              snippet: dec.replace(/\s+/g," ").slice(0,500)});
          }
        }catch(e){ console.error(`skip uid ${uid}: ${e.message}`); }
      }
    }finally{ lock.release(); }
  }
}finally{
  try{ await client.logout(); }catch{ /* already disconnected */ }
}
out.sort((a,b)=>a.date.localeCompare(b.date));
for(const m of out){ console.log(`\n[${m.date}] ${m.from}\n${m.subj}\n${m.snippet}\n${"-".repeat(50)}`); }
console.log(`\nTotal: ${out.length}`);
