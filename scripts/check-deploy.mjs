import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").filter((l)=>l&&!l.startsWith("#"))
  .reduce((a,l)=>{const[k,...r]=l.split("=");if(k)a[k.trim()]=r.join("=").trim();return a;},{});
const TOKEN=env.VERCEL_ACCESS_TOKEN;
if(!TOKEN){ console.error("VERCEL_ACCESS_TOKEN missing in .env.local"); process.exit(1); }
const PID=env.VERCEL_PROJECT_ID || "prj_TvmyEkfULUU4vcQSvEySbrEhuqGB";
let r;
try{
  r=await fetch(`https://api.vercel.com/v6/deployments?projectId=${PID}&target=production&limit=3`,
    {headers:{Authorization:`Bearer ${TOKEN}`}});
}catch(e){
  console.error(`Vercel API request failed: ${e.message}`);
  process.exit(1);
}
if(!r.ok){ console.error(`Vercel API returned ${r.status}`); process.exit(1); }
const d=await r.json().catch((e)=>{ console.error(`Failed to parse Vercel response: ${e.message}`); return {}; });
for(const dep of (d.deployments||[])){
  console.log(`${dep.state}\t${(dep.meta?.githubCommitSha||"").slice(0,7)}\t${dep.url}\t${dep.meta?.githubCommitMessage?.split("\n")[0]||""}`);
}
