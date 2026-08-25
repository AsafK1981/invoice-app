// Calibration probe for the assistant's "no dead end" rule.
//
// Sends how-to questions (the kind that used to get "אין לי אפשרות") straight
// to the model with the live SYSTEM prompt from src/app/api/assistant/route.ts,
// tools off, and prints each answer next to the isDeadEndReply verdict. Run it
// from Node, not through a shell pipe, so the Hebrew arrives intact.
//
//   node scripts/test-assistant-howto.mjs
//
// PAID: one Haiku call per question (~$0.002 each). Ask before running.

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const key = env.match(/^ANTHROPIC_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("ANTHROPIC_API_KEY missing from .env.local");

const route = readFileSync(new URL("../src/app/api/assistant/route.ts", import.meta.url), "utf8");
const SYSTEM = route
  .match(/const SYSTEM = `([\s\S]*?)`;\r?\n/)?.[1]
  ?.replace(/\$\{MAX_DRAFTS\}/g, route.match(/const MAX_DRAFTS = (\d+)/)?.[1] ?? "8");
if (!SYSTEM) throw new Error("SYSTEM prompt not found in route.ts");
const MODEL = route.match(/const MODEL = "([^"]+)"/)[1];

// Same patterns as src/lib/assistant-reply.ts (kept inline: this is an .mjs
// probe and the lib is TS).
const DEAD_END = [
  /(?:אני |אינני |אנחנו )?לא (?:יכול|יכולה|מסוגל|מסוגלת|אוכל|נוכל) (?:לעזור|לסייע|לבצע|לעשות|לענות|לתת|לספק|לטפל|לייבא|להעביר|לגשת)/,
  /אינני (?:יכול|יכולה|מסוגל)/,
  /אין (?:לי|לנו|באפשרותי|ביכולתי) (?:אפשרות|יכולת|דרך|תשובה|מידע|גישה|כלי)/,
  /לא (?:בטוח|בטוחה|יודע|יודעת) (?:איך|כיצד|מה|אם|לאן|היכן)/,
  /לא (?:קיימת?|נתמכת?|זמינה?|אפשרי) (?:אפשרות|תכונה|פיצ'ר|אופציה|כרגע|במערכת|באפליקציה)/,
];

const QUESTIONS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "איך אני מייבא את הלקוחות והחשבוניות שלי מהאפליקציה האחרת שאני עובד איתה?",
      "אני עובר מחשבונית ירוקה, איך מעבירים את כל ההיסטוריה?",
      "יש לי קובץ אקסל עם כל הלקוחות, מה עושים איתו?",
      "איך אני מוריד גיבוי של כל הנתונים שלי?",
      "איך מחברים את האפליקציה לרשות המסים?",
      "אפשר לשלוח ללקוח קישור לתשלום בכרטיס אשראי?",
      "איך משנים את המספר של החשבונית הבאה?",
      "איך אני מוחק חשבונית שכבר הפקתי?",
      "אפשר להוציא חשבוניות בדולרים?",
      "איך אני מוסיף לוגו למסמכים?",
    ];

const client = new Anthropic({ apiKey: key });
const today = new Date().toISOString().slice(0, 10);
let bad = 0;
for (const q of QUESTIONS) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: `${SYSTEM}\n\nהתאריך היום: ${today}.`,
    messages: [{ role: "user", content: q }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const dead = DEAD_END.some((re) => re.test(text.replace(/\s+/g, " ")));
  if (dead) bad++;
  console.log(`\n${dead ? "✗ DEAD END" : "✓"}  ${q}\n${"-".repeat(60)}\n${text}`);
}
console.log(`\n${QUESTIONS.length - bad}/${QUESTIONS.length} answers gave the user a next step.`);
