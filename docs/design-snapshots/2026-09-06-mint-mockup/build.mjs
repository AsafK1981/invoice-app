// Generates the six .dc.html artboards for the mint / peach / graphite rebrand mockup.
// Shared tokens + logo live here once so every artboard stays consistent.
import { writeFileSync } from "node:fs";

const T = {
  graphite: "#2F3A45",
  mint: "#9ED8C3",
  mintTint: "#E6F5EE",
  mintLine: "#BFE6D6",
  mintInk: "#2A7A62",
  peach: "#F6B89E",
  peachTint: "#FDEEE6",
  peachLine: "#F3CDB9",
  peachInk: "#B85A32",
  off: "#F7F7F2",
  white: "#FFFFFF",
  border: "#E4E7E2",
  text: "#1F252B",
  muted: "#5F6B76",
  faint: "#8B95A0",
};

// The mascot: a smiling document with a mint folded corner, peach cheeks and mint text lines.
const mark = (size, extra = "") =>
  `<svg width="${size}" height="${Math.round((size * 140) / 134)}" viewBox="-14 0 134 140" fill="none" xmlns="http://www.w3.org/2000/svg" ${extra}>
    <path d="M22 8h56l30 30v90a12 12 0 0 1-12 12H22a12 12 0 0 1-12-12V20A12 12 0 0 1 22 8z" fill="${T.white}" stroke="${T.graphite}" stroke-width="7" stroke-linejoin="round"/>
    <path d="M78 8v20a10 10 0 0 0 10 10h20z" fill="${T.mint}" stroke="${T.graphite}" stroke-width="7" stroke-linejoin="round"/>
    <circle cx="40" cy="60" r="5" fill="${T.graphite}"/><circle cx="72" cy="60" r="5" fill="${T.graphite}"/>
    <path d="M43 76q13 12 26 0" stroke="${T.graphite}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="29" cy="72" r="6" fill="${T.peach}"/><circle cx="83" cy="72" r="6" fill="${T.peach}"/>
    <path d="M30 100h50M30 115h30" stroke="${T.mint}" stroke-width="7" stroke-linecap="round"/>
    <path d="M3 118l-10 8M2 106l-12 1" stroke="${T.graphite}" stroke-width="5" stroke-linecap="round"/>
  </svg>`;

const fonts = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800;900&family=Rubik:wght@500;700;800;900&display=swap">`;

const base = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Heebo", "Segoe UI", Arial, sans-serif; color: ${T.text}; background: ${T.off}; -webkit-font-smoothing: antialiased; }
  a { color: ${T.graphite}; text-decoration: none; } a:hover { color: ${T.mintInk}; }
  .wm { font-family: "Rubik", "Heebo", Arial, sans-serif; font-weight: 900; letter-spacing: -0.01em; color: ${T.graphite}; line-height: 1; }
  .h { font-family: "Rubik", "Heebo", Arial, sans-serif; font-weight: 800; color: ${T.graphite}; letter-spacing: -0.01em; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 46px; padding: 0 22px; border-radius: 12px; font-weight: 700; font-size: 15px; border: 1px solid transparent; white-space: nowrap; }
  .btn-primary { background: ${T.graphite}; color: ${T.white}; }
  .btn-secondary { background: ${T.white}; color: ${T.graphite}; border-color: ${T.border}; }
  .btn-mint { background: ${T.mint}; color: ${T.graphite}; }
  .btn-sm { height: 38px; padding: 0 16px; font-size: 14px; border-radius: 10px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border-radius: 999px; font-size: 13px; font-weight: 600; }
  .chip-paid { background: ${T.mintTint}; color: ${T.mintInk}; }
  .chip-wait { background: ${T.peachTint}; color: ${T.peachInk}; }
  .chip-draft { background: #EEF0EE; color: ${T.muted}; }
  .chip-sent { background: #E9EEF5; color: #34506E; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .card { background: ${T.white}; border: 1px solid ${T.border}; border-radius: 16px; }
  .ico { width: 20px; height: 20px; }
  .tile { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
  .num { font-variant-numeric: tabular-nums; }
`;

// Stroke icons on a 24 grid.
const I = {
  doc: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>`,
  users: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5a5 5 0 0 1 6 5"/></svg>`,
  chart: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/></svg>`,
  gear: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  home: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>`,
  box: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>`,
  receipt: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>`,
  repeat: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  bell: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>`,
  clock: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  brush: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3l7 7-9 9H5v-7z"/><path d="M12 5l7 7"/></svg>`,
  search: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`,
  plus: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  check: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>`,
  up: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6 4 4 6-7"/><path d="M15 8h5v5"/></svg>`,
  down: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l6 6 4-4 6 7"/><path d="M15 16h5v-5"/></svg>`,
  shield: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>`,
  spark: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>`,
  chat: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>`,
  zap: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>`,
  camera: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  menu: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
  arrowL: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>`,
};

const wrap = (title, css, body, props = "") => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  ${fonts}
  <style>${base}${css}</style>
</helmet>
${body}
</x-dc>
${props}
</body>
</html>`;

const write = (name, html) => {
  writeFileSync(new URL(`./${name}`, import.meta.url), html, "utf8");
  console.log("wrote", name);
};

const lockup = (size = 34) => `
  <div style="display:flex;align-items:center;gap:10px;">
    ${mark(size)}
    <div style="display:flex;flex-direction:column;gap:2px;">
      <span class="wm" style="font-size:${Math.round(size * 0.62)}px;">חשבונית ידידותית</span>
      <span style="font-size:${Math.round(size * 0.32)}px;color:${T.muted};font-weight:500;letter-spacing:0.02em;">התנהלות פשוטה לעסק מצליח</span>
    </div>
  </div>`;

/* ------------------------------------------------------------------ */
/* 1. Landing, desktop 1440                                            */
/* ------------------------------------------------------------------ */
const landingCss = `
  .page { width: 1440px; background: ${T.off}; direction: rtl; }
  .wrap { width: 1120px; margin: 0 auto; }
  .nav a { font-size: 15px; font-weight: 500; color: ${T.graphite}; }
  .hero-h1 { font-size: 58px; line-height: 1.12; margin: 0; }
  .hi { background: linear-gradient(transparent 62%, ${T.mint} 62%, ${T.mint} 92%, transparent 92%); padding: 0 4px; }
  .lede { font-size: 20px; line-height: 1.6; color: ${T.muted}; margin: 0; max-width: 640px; }
  .trust li { display: flex; align-items: center; gap: 8px; font-size: 15px; color: ${T.muted}; }
  .trust svg { color: ${T.mintInk}; }
  .spot { padding: 22px; display: flex; flex-direction: column; gap: 12px; }
  .spot h3 { margin: 0; font-size: 17px; font-weight: 700; color: ${T.graphite}; }
  .spot p { margin: 0; font-size: 14.5px; line-height: 1.55; color: ${T.muted}; }
  .feat { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
  .feat span { font-size: 15px; font-weight: 600; color: ${T.graphite}; }
  .foot a { font-size: 14px; color: ${T.muted}; }
`;

const spot = (tileBg, tileInk, icon, title, body) => `
  <div class="card spot">
    <div class="tile" style="background:${tileBg};color:${tileInk};">${icon}</div>
    <h3>${title}</h3>
    <p>${body}</p>
  </div>`;

const feat = (icon, label, tone) => `
  <div class="card feat">
    <div class="tile" style="width:38px;height:38px;border-radius:10px;background:${tone === "mint" ? T.mintTint : tone === "peach" ? T.peachTint : T.off};color:${tone === "mint" ? T.mintInk : tone === "peach" ? T.peachInk : T.graphite};">${icon}</div>
    <span>${label}</span>
  </div>`;

// A compact "inside the app" preview used on the landing page (desktop) - same skin as the dashboard artboard.
const appPreview = (w = 900) => `
  <div style="width:${w}px;background:${T.white};border:1px solid ${T.border};border-radius:18px;overflow:hidden;display:grid;grid-template-columns:200px minmax(0,1fr);box-shadow:0 30px 60px -30px rgba(47,58,69,0.35);">
    <div style="background:${T.white};border-left:1px solid ${T.border};padding:18px 14px;display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;align-items:center;gap:8px;padding:0 6px 14px;">${mark(26)}<span class="wm" style="font-size:15px;">חשבונית ידידותית</span></div>
      <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;background:${T.mintTint};color:${T.graphite};font-weight:700;font-size:13.5px;">${I.home}דשבורד</div>
      <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;color:${T.muted};font-size:13.5px;">${I.doc}מסמכים</div>
      <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;color:${T.muted};font-size:13.5px;">${I.users}לקוחות</div>
      <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;color:${T.muted};font-size:13.5px;">${I.chart}דוחות</div>
      <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;color:${T.muted};font-size:13.5px;">${I.gear}הגדרות</div>
    </div>
    <div style="padding:22px 24px;background:${T.off};display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div><div class="h" style="font-size:22px;">שלום, כיף לראות אותך!</div><div style="font-size:13px;color:${T.muted};margin-top:2px;">כאן ניהול העסק פשוט יותר.</div></div>
        <span class="btn btn-primary btn-sm">${I.plus}הפקת חשבונית</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3, minmax(0,1fr));gap:12px;">
        <div class="card" style="padding:14px 16px;"><div style="font-size:12px;color:${T.muted};">חשבוניות החודש</div><div class="h num" style="font-size:24px;margin-top:4px;">12</div></div>
        <div class="card" style="padding:14px 16px;"><div style="font-size:12px;color:${T.muted};">סה"כ הכנסות</div><div class="h num" style="font-size:24px;margin-top:4px;">₪8,450</div></div>
        <div class="card" style="padding:14px 16px;"><div style="font-size:12px;color:${T.muted};">לקוחות פעילים</div><div class="h num" style="font-size:24px;margin-top:4px;">5</div></div>
      </div>
      <div class="card" style="padding:6px 0;">
        <div style="padding:8px 16px 10px;font-size:13px;font-weight:700;color:${T.graphite};">חשבוניות אחרונות</div>
        ${[["1001", "סטודיו ורד", "₪1,250", "paid", "שולם"], ["1000", "לקוח לדוגמה", "₪980", "wait", "ממתין"], ["0999", "גינון ירוק", "₪2,100", "paid", "שולם"]]
          .map(([n, c, a, s, l]) => `<div style="display:grid;grid-template-columns:56px minmax(0,1fr) 90px 80px;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid ${T.border};font-size:13px;"><span class="num" style="color:${T.muted};">${n}</span><span style="font-weight:600;">${c}</span><span class="num" style="font-weight:700;">${a}</span><span class="chip chip-${s}" style="height:24px;font-size:12px;justify-self:end;"><span class="dot" style="background:currentColor;"></span>${l}</span></div>`)
          .join("")}
      </div>
    </div>
  </div>`;

const landing = wrap(
  "Landing",
  landingCss,
  `<div class="page">
    <header style="height:80px;border-bottom:1px solid ${T.border};background:${T.white};">
      <div class="wrap" style="height:80px;display:flex;align-items:center;justify-content:space-between;">
        ${lockup(38)}
        <nav class="nav" style="display:flex;align-items:center;gap:28px;">
          <a>מדריך</a><a>השוואות</a><a>מחירים</a><a>מאמרים</a>
        </nav>
        <div style="display:flex;align-items:center;gap:14px;">
          <a style="font-size:15px;font-weight:600;">כניסה</a>
          <span class="btn btn-primary">התחילו בחינם</span>
        </div>
      </div>
    </header>

    <section style="padding:88px 0 48px;position:relative;overflow:hidden;">
      <div style="position:absolute;inset:auto -120px -260px auto;width:520px;height:520px;border-radius:50%;background:${T.mintTint};opacity:0.9;"></div>
      <div style="position:absolute;inset:40px auto auto -160px;width:420px;height:420px;border-radius:50%;background:${T.peachTint};opacity:0.9;"></div>
      <div class="wrap" style="position:relative;display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:48px;align-items:center;">
        <div style="display:flex;flex-direction:column;gap:26px;">
          <span class="chip" style="background:${T.white};border:1px solid ${T.border};color:${T.graphite};align-self:flex-start;height:32px;">תוכנת חשבוניות ידידותית לעסקים עצמאיים בישראל</span>
          <h1 class="h hero-h1">להוציא חשבונית הפך<br><span class="hi">לחלק הכי קל</span> ביום העבודה שלכם</h1>
          <p class="lede">עומדים בכל הדרישות החדשות של רשות המסים, בלי להתאמץ: מספר ההקצאה מתקבל אוטומטית, בלחיצה אחת, ישירות מתוך המסמך.</p>
          <div style="display:flex;align-items:center;gap:18px;">
            <span class="btn btn-primary" style="height:54px;padding:0 30px;font-size:17px;border-radius:14px;">התחילו בחינם</span>
            <span style="font-size:14.5px;color:${T.muted};">חינם בתקופת ההשקה, בלי כרטיס אשראי</span>
          </div>
          <ul class="trust" style="list-style:none;margin:0;padding:0;display:flex;gap:26px;">
            <li>${I.check}הקמה תוך 5 דקות</li><li>${I.check}תמיכה בעברית</li><li>${I.check}אפשר לבטל בכל רגע</li>
          </ul>
        </div>
        <div style="display:flex;justify-content:center;">${mark(250)}</div>
      </div>
    </section>

    <section style="padding:8px 0 64px;">
      <div class="wrap" style="display:grid;grid-template-columns:repeat(4, minmax(0,1fr));gap:18px;">
        ${spot(T.mintTint, T.mintInk, I.zap, "מספר הקצאה בלחיצה אחת", "מספר ההקצאה מרשות המסים מתקבל אוטומטית מתוך המסמך. בלי טפסים, בלי אתרים נוספים.")}
        ${spot(T.peachTint, T.peachInk, I.chat, "חשבונית מהוואטסאפ", "כותבים לעוזר הודעה קצרה, הוא מכין את הקבלה. מתאים למי שעובד מהטלפון.")}
        ${spot(T.off, T.graphite, I.camera, "סריקת הוצאות בצילום", "מצלמים קבלה והפרטים נקלטים לבד. ההוצאות מסודרות לרואה החשבון בלי עבודה ידנית.")}
        ${spot(T.mintTint, T.mintInk, I.shield, "אבטחה ושקיפות", "כל מסמך שהופק נעול, כל שינוי מתועד, וגיבוי לילי מחוץ לפלטפורמה.")}
      </div>
    </section>

    <section style="padding:0 0 72px;">
      <div class="wrap" style="display:flex;flex-direction:column;gap:22px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;">
          <h2 class="h" style="font-size:30px;margin:0;">כל מה שצריך, בלי סיבוכים</h2>
          <span style="font-size:14.5px;color:${T.muted};">כל היכולות כלולות בכל תוכנית</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4, minmax(0,1fr));gap:12px;">
          ${feat(I.doc, "חשבוניות וקבלות", "mint")}${feat(I.repeat, "חיובים חוזרים", "peach")}${feat(I.users, "ניהול לקוחות", "grey")}${feat(I.chart, "דוחות לרואה חשבון", "mint")}
          ${feat(I.receipt, "מעקב הוצאות", "peach")}${feat(I.bell, "תזכורות תשלום", "grey")}${feat(I.spark, "עוזר AI בעברית", "mint")}${feat(I.brush, "עיצוב מסמך אישי", "peach")}
        </div>
      </div>
    </section>

    <section style="padding:64px 0 80px;background:${T.white};border-top:1px solid ${T.border};border-bottom:1px solid ${T.border};">
      <div class="wrap" style="display:flex;flex-direction:column;align-items:center;gap:30px;">
        <div style="text-align:center;display:flex;flex-direction:column;gap:10px;">
          <h2 class="h" style="font-size:30px;margin:0;">כך זה נראה בפנים</h2>
          <p style="margin:0;font-size:17px;color:${T.muted};">מה שמבטיחים בדף הזה הוא בדיוק מה שמקבלים אחרי הכניסה.</p>
        </div>
        ${appPreview(940)}
      </div>
    </section>

    <section style="padding:72px 0;background:${T.peachTint};">
      <div class="wrap" style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;flex-direction:column;gap:14px;">
          <h2 class="h" style="font-size:38px;margin:0;">חשבוניות בקלות. בדרך שלך.</h2>
          <p style="margin:0;font-size:17px;color:${T.muted};">חינם בתקופת ההשקה. בלי כרטיס אשראי, בלי התחייבות.</p>
          <div><span class="btn btn-primary" style="height:52px;padding:0 28px;font-size:16px;">התחילו בחינם</span></div>
        </div>
        ${lockup(56)}
      </div>
    </section>

    <footer class="foot" style="padding:34px 0;">
      <div class="wrap" style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;">${mark(22)}<span class="wm" style="font-size:15px;">חשבונית ידידותית</span><span style="font-size:12px;color:${T.mintInk};letter-spacing:0.28em;font-weight:600;margin-right:10px;">FRIENDLYINVOICE</span></div>
        <div style="display:flex;gap:22px;"><a>מחירים</a><a>מאמרים</a><a>אבטחה</a><a>נגישות</a><a>תנאי שימוש</a><a>פרטיות</a></div>
      </div>
    </footer>
  </div>`,
);
write("Main.dc.html", landing);

/* ------------------------------------------------------------------ */
/* 2. Landing, mobile 390                                              */
/* ------------------------------------------------------------------ */
const landingMobile = wrap(
  "LandingMobile",
  `.page { width: 390px; min-height: 844px; background: ${T.off}; direction: rtl; }
   .spot-m { display:flex; align-items:center; gap:12px; padding:12px 14px; }
   .spot-m h3 { margin:0; font-size:14.5px; font-weight:700; color:${T.graphite}; }`,
  `<div class="page">
    <header style="height:64px;padding:0 18px;display:flex;align-items:center;justify-content:space-between;background:${T.white};border-bottom:1px solid ${T.border};">
      <div style="display:flex;align-items:center;gap:8px;">${mark(28)}<span class="wm" style="font-size:18px;">חשבונית ידידותית</span></div>
      <span style="color:${T.graphite};">${I.menu}</span>
    </header>
    <section style="padding:34px 20px 22px;display:flex;flex-direction:column;gap:18px;position:relative;overflow:hidden;">
      <div style="position:absolute;inset:-60px -90px auto auto;width:220px;height:220px;border-radius:50%;background:${T.mintTint};"></div>
      <div style="position:relative;display:flex;align-items:flex-end;justify-content:space-between;">
        <span class="chip" style="background:${T.white};border:1px solid ${T.border};height:30px;font-size:12px;">לעסקים עצמאיים בישראל</span>
        ${mark(64)}
      </div>
      <h1 class="h" style="font-size:34px;line-height:1.15;margin:0;position:relative;">להוציא חשבונית הפך <span style="background:linear-gradient(transparent 62%, ${T.mint} 62%, ${T.mint} 92%, transparent 92%);padding:0 3px;">לחלק הכי קל</span> ביום העבודה שלכם</h1>
      <p style="margin:0;font-size:16px;line-height:1.6;color:${T.muted};">מספר ההקצאה מרשות המסים מתקבל אוטומטית, בלחיצה אחת, ישירות מתוך המסמך.</p>
      <span class="btn btn-primary" style="height:52px;font-size:16px;border-radius:14px;">התחילו בחינם</span>
      <span style="font-size:13px;color:${T.muted};text-align:center;">חינם בתקופת ההשקה, בלי כרטיס אשראי</span>
    </section>
    <section style="padding:6px 16px 24px;display:flex;flex-direction:column;gap:10px;">
      <div class="card spot-m"><div class="tile" style="width:38px;height:38px;border-radius:10px;background:${T.mintTint};color:${T.mintInk};">${I.zap}</div><h3>מספר הקצאה בלחיצה אחת</h3></div>
      <div class="card spot-m"><div class="tile" style="width:38px;height:38px;border-radius:10px;background:${T.peachTint};color:${T.peachInk};">${I.chat}</div><h3>חשבונית מהוואטסאפ</h3></div>
      <div class="card spot-m"><div class="tile" style="width:38px;height:38px;border-radius:10px;background:${T.off};color:${T.graphite};">${I.camera}</div><h3>סריקת הוצאות בצילום</h3></div>
      <div class="card spot-m"><div class="tile" style="width:38px;height:38px;border-radius:10px;background:${T.mintTint};color:${T.mintInk};">${I.shield}</div><h3>אבטחה ושקיפות</h3></div>
    </section>
    <section style="padding:22px 20px 30px;background:${T.peachTint};display:flex;flex-direction:column;gap:10px;">
      <div class="h" style="font-size:24px;">חשבוניות בקלות. בדרך שלך.</div>
      <div style="font-size:14px;color:${T.muted};">התנהלות פשוטה לעסק מצליח</div>
    </section>
  </div>`,
);
write("LandingMobile.dc.html", landingMobile);

/* ------------------------------------------------------------------ */
/* 3. Dashboard, desktop 1440                                          */
/* ------------------------------------------------------------------ */
const navItem = (icon, label, active = false, tone = "graphite") => `
  <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;background:${active ? T.mintTint : "transparent"};color:${active ? T.graphite : T.muted};font-weight:${active ? 700 : 500};font-size:14.5px;">
    <span style="display:flex;color:${active ? T.graphite : tone === "mint" ? T.mintInk : tone === "peach" ? T.peachInk : T.graphite};">${icon}</span>${label}
  </div>`;

const kpi = (label, value, delta, tone, icon) => `
  <div class="card" style="padding:18px 20px;display:flex;flex-direction:column;gap:10px;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:13.5px;font-weight:600;color:${T.muted};">${label}</span>
      <span class="tile" style="width:34px;height:34px;border-radius:10px;background:${tone === "mint" ? T.mintTint : tone === "peach" ? T.peachTint : T.off};color:${tone === "mint" ? T.mintInk : tone === "peach" ? T.peachInk : T.graphite};">${icon}</span>
    </div>
    <div class="h num" style="font-size:30px;">${value}</div>
    <span class="chip ${tone === "peach" ? "chip-wait" : "chip-paid"}" style="align-self:flex-start;height:24px;font-size:12px;">${delta}</span>
  </div>`;

const row = (type, tint, client, subject, num, date, status, statusLabel, amount) => `
  <div style="display:grid;grid-template-columns:110px 150px minmax(0,1fr) 80px 100px 110px 110px;align-items:center;gap:12px;padding:0 16px;height:52px;background:${tint};border-top:1px solid ${T.border};font-size:14px;position:relative;">
    <span style="font-weight:600;color:${T.graphite};">${type}</span>
    <span style="font-weight:600;">${client}</span>
    <span style="color:${T.muted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${subject}</span>
    <span class="num" style="color:${T.muted};">#${num}</span>
    <span class="num" style="color:${T.muted};">${date}</span>
    <span class="chip chip-${status}" style="height:26px;font-size:12.5px;justify-self:start;"><span class="dot" style="background:currentColor;"></span>${statusLabel}</span>
    <span class="num" style="font-weight:700;justify-self:end;">${amount}</span>
  </div>`;

const dashboard = wrap(
  "Dashboard",
  `.page { width: 1440px; height: 1000px; background: ${T.off}; direction: rtl; display: grid; grid-template-columns: 240px minmax(0,1fr); overflow: hidden; }
   .th { font-size: 12.5px; font-weight: 700; color: ${T.faint}; }`,
  `<div class="page">
    <aside style="background:${T.white};border-left:1px solid ${T.border};padding:20px 14px;display:flex;flex-direction:column;gap:4px;">
      <div style="display:flex;align-items:center;gap:10px;padding:2px 8px 18px;">
        ${mark(34)}
        <div style="display:flex;flex-direction:column;"><span class="wm" style="font-size:17px;">חשבונית ידידותית</span><span style="font-size:11.5px;color:${T.muted};">סטודיו לדוגמה</span></div>
      </div>
      ${navItem(I.home, "ראשי", true)}
      ${navItem(I.doc, "מסמכים", false, "mint")}
      ${navItem(I.users, "לקוחות", false, "peach")}
      ${navItem(I.box, "מוצרים ושירותים")}
      ${navItem(I.receipt, "הוצאות", false, "mint")}
      ${navItem(I.repeat, "חיובים חוזרים", false, "peach")}
      ${navItem(I.bell, "התראות")}
      ${navItem(I.clock, "תזכורות", false, "mint")}
      ${navItem(I.chart, "דו\"חות", false, "peach")}
      ${navItem(I.brush, "עיצוב מסמך")}
      ${navItem(I.gear, "הגדרות")}
      <div style="flex:1;"></div>
      <div style="padding:12px;border-radius:12px;background:${T.off};display:flex;align-items:center;gap:10px;font-size:12.5px;color:${T.muted};">${mark(22)}<span>עוזר חכם זמין בכל מסך</span></div>
    </aside>

    <main style="padding:22px 32px;display:flex;flex-direction:column;gap:18px;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div><div class="h" style="font-size:30px;">שלום, כיף לראות אותך!</div><div style="font-size:14px;color:${T.muted};margin-top:2px;">סקירה מהירה של הפעילות שלך</div></div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span class="btn btn-secondary btn-sm" style="gap:10px;color:${T.muted};font-weight:500;">${I.search}חיפוש</span>
          <span class="btn btn-primary">${I.plus}מסמך חדש</span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4, minmax(0,1fr));gap:14px;">
        ${kpi("הכנסות", "₪12,450", "▲ 8% מהחודש שעבר", "mint", I.up)}
        ${kpi("הוצאות", "₪3,120", "▼ 4% מהחודש שעבר", "peach", I.down)}
        ${kpi("רווח", "₪9,330", "▲ 12% מהחודש שעבר", "mint", I.chart)}
        ${kpi("ממתין לתשלום", "₪4,700", "3 מסמכים פתוחים", "peach", I.clock)}
      </div>

      <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:14px;">
        <div class="card" style="padding:18px 20px;display:flex;flex-direction:column;gap:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:15px;font-weight:700;color:${T.graphite};">הכנסות והוצאות</span>
            <div style="display:flex;gap:6px;">
              <span class="chip" style="background:${T.graphite};color:${T.white};height:26px;font-size:12px;">6 חודשים</span>
              <span class="chip" style="background:${T.off};color:${T.muted};height:26px;font-size:12px;">שנה</span>
            </div>
          </div>
          <svg viewBox="0 0 700 180" width="100%" height="180" style="direction:ltr;">
            <defs><linearGradient id="mintArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.mint}" stop-opacity="0.45"/><stop offset="1" stop-color="${T.mint}" stop-opacity="0"/></linearGradient></defs>
            <g stroke="${T.border}" stroke-width="1"><line x1="0" y1="40" x2="700" y2="40"/><line x1="0" y1="90" x2="700" y2="90"/><line x1="0" y1="140" x2="700" y2="140"/></g>
            <path d="M20 130 C120 120 160 60 240 70 S360 110 420 60 S560 40 680 30 L680 160 L20 160 Z" fill="url(#mintArea)"/>
            <path d="M20 130 C120 120 160 60 240 70 S360 110 420 60 S560 40 680 30" fill="none" stroke="${T.graphite}" stroke-width="2.5"/>
            <path d="M20 145 C120 150 200 120 260 130 S400 150 460 125 S600 120 680 110" fill="none" stroke="${T.peach}" stroke-width="2.5" stroke-dasharray="6 6"/>
            <circle cx="680" cy="30" r="5" fill="${T.graphite}"/><circle cx="680" cy="30" r="9" fill="${T.mint}" fill-opacity="0.5"/>
            <g font-family="Heebo, Arial" font-size="11" fill="${T.faint}" text-anchor="middle"><text x="20" y="176">אפריל</text><text x="152" y="176">מאי</text><text x="284" y="176">יוני</text><text x="416" y="176">יולי</text><text x="548" y="176">אוגוסט</text><text x="680" y="176">ספטמבר</text></g>
          </svg>
        </div>
        <div class="card" style="padding:18px 20px;display:flex;flex-direction:column;gap:14px;">
          <span style="font-size:15px;font-weight:700;color:${T.graphite};">לקוחות מובילים</span>
          ${[["סטודיו ורד", "₪4,500", 100], ["גינון ירוק", "₪3,200", 71], ["מרפאת שיניים כהן", "₪2,150", 48]]
            .map(([n, a, p], i) => `<div style="display:flex;flex-direction:column;gap:6px;"><div style="display:flex;justify-content:space-between;font-size:13.5px;"><span style="font-weight:600;">${n}</span><span class="num" style="color:${T.muted};">${a}</span></div><div style="height:6px;border-radius:999px;background:${T.off};overflow:hidden;"><div style="width:${p}%;height:100%;background:${i === 0 ? T.mint : T.graphite};opacity:${i === 0 ? 1 : 0.35};"></div></div></div>`)
            .join("")}
        </div>
      </div>

      <div class="card" style="overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;">
          <span style="font-size:15px;font-weight:700;color:${T.graphite};">מסמכים אחרונים</span>
          <a style="font-size:13.5px;font-weight:600;color:${T.mintInk};display:flex;align-items:center;gap:6px;">לכל המסמכים ${I.arrowL}</a>
        </div>
        <div class="th" style="display:grid;grid-template-columns:110px 150px minmax(0,1fr) 80px 100px 110px 110px;gap:12px;padding:0 16px 10px;"><span>סוג</span><span>לקוח</span><span>נושא</span><span>מספר</span><span>תאריך</span><span>סטטוס</span><span style="justify-self:end;">סכום</span></div>
        ${row("הצעת מחיר", "#FBF6E4", "Acme Studios", "Website redesign - September", "88001", "06.09.2026", "sent", "נשלח", "₪3,600")}
        ${row("קבלה", T.mintTint, "סטודיו ורד", "שכר דירה - ספטמבר 2026", "1001", "02.09.2026", "paid", "שולם", "₪4,500")}
        ${row("חשבונית מס", T.peachTint, "גינון ירוק", "עבודות גינון - אוגוסט", "9005", "02.08.2026", "wait", "ממתין לתשלום", "₪5,100")}
        ${row("חשבון עסקה", "#EEEDF6", "מרפאת שיניים כהן", "הצעת מחיר לדוגמה", "1", "03.08.2026", "draft", "טיוטה", "₪585")}
      </div>
    </main>
  </div>`,
);
write("Dashboard.dc.html", dashboard);

/* ------------------------------------------------------------------ */
/* 4. Dashboard, mobile 390                                            */
/* ------------------------------------------------------------------ */
const mrow = (tint, client, date, amount, color) => `
  <div style="display:grid;grid-template-columns:minmax(0,1fr) 78px 84px;align-items:center;gap:8px;padding:0 14px;height:46px;background:${tint};border-top:1px solid ${T.border};font-size:13.5px;">
    <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${client}</span>
    <span class="num" style="color:${T.muted};font-size:12.5px;">${date}</span>
    <span class="num" style="font-weight:700;color:${color};justify-self:end;">${amount}</span>
  </div>`;

const dashMobile = wrap(
  "DashboardMobile",
  `.page { width: 390px; height: 844px; background: ${T.off}; direction: rtl; display:flex; flex-direction:column; overflow:hidden; position:relative; }
   .kpi { display:flex; align-items:center; gap:10px; padding:0 14px; height:60px; }`,
  `<div class="page">
    <header style="height:60px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;background:${T.white};border-bottom:1px solid ${T.border};">
      <div style="display:flex;align-items:center;gap:8px;">${mark(26)}<span class="wm" style="font-size:16px;">חשבונית ידידותית</span></div>
      <div style="display:flex;gap:14px;color:${T.graphite};">${I.search}${I.menu}</div>
    </header>
    <div style="padding:18px 16px 0;display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div class="h" style="font-size:24px;">שלום, כיף לראות אותך!</div>
      </div>
      <span class="btn btn-primary" style="height:48px;">${I.plus}מסמך חדש</span>
      <div class="card" style="overflow:hidden;">
        <div class="kpi"><span class="tile" style="width:32px;height:32px;border-radius:9px;background:${T.mintTint};color:${T.mintInk};">${I.up}</span><span style="font-size:13.5px;color:${T.muted};flex:1;">הכנסות החודש</span><span class="h num" style="font-size:19px;">₪12,450</span></div>
        <div class="kpi" style="border-top:1px solid ${T.border};"><span class="tile" style="width:32px;height:32px;border-radius:9px;background:${T.peachTint};color:${T.peachInk};">${I.down}</span><span style="font-size:13.5px;color:${T.muted};flex:1;">הוצאות</span><span class="h num" style="font-size:19px;">₪3,120</span></div>
        <div class="kpi" style="border-top:1px solid ${T.border};"><span class="tile" style="width:32px;height:32px;border-radius:9px;background:${T.off};color:${T.graphite};">${I.clock}</span><span style="font-size:13.5px;color:${T.muted};flex:1;">ממתין לתשלום</span><span class="h num" style="font-size:19px;">₪4,700</span></div>
      </div>
      <div class="card" style="overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px 8px;"><span style="font-size:14.5px;font-weight:700;color:${T.graphite};">מסמכים אחרונים</span><span style="font-size:12.5px;color:${T.faint};">תאריך · סכום</span></div>
        ${mrow(T.mintTint, "סטודיו ורד", "02.09.26", "₪4,500", T.mintInk)}
        ${mrow(T.peachTint, "גינון ירוק", "02.08.26", "₪5,100", T.peachInk)}
        ${mrow("#FBF6E4", "Acme Studios", "06.09.26", "₪3,600", T.graphite)}
        ${mrow(T.mintTint, "מרפאת שיניים כהן", "03.07.26", "₪2,150", T.mintInk)}
        ${mrow("#EEEDF6", "לקוח לדוגמה", "03.08.26", "₪585", T.faint)}
        ${mrow(T.mintTint, "סטודיו ורד", "03.06.26", "₪4,500", T.mintInk)}
      </div>
    </div>
    <div style="position:absolute;left:16px;bottom:22px;display:flex;align-items:center;gap:8px;height:48px;padding:0 16px 0 12px;border-radius:999px;background:${T.graphite};color:${T.white};font-weight:700;font-size:14px;box-shadow:0 12px 24px -10px rgba(47,58,69,0.5);">${mark(22)}עוזר חכם</div>
  </div>`,
);
write("DashboardMobile.dc.html", dashMobile);

/* ------------------------------------------------------------------ */
/* 5. The document sheet (A4 at ~0.8 scale: 640 x 905)                 */
/* ------------------------------------------------------------------ */
const docSheet = wrap(
  "Document",
  `.page { width: 700px; height: 940px; background: ${T.off}; direction: rtl; padding: 18px; }
   .sheet { width: 664px; height: 904px; background: ${T.white}; border: 1px solid ${T.border}; border-radius: 6px; padding: 44px 48px; display:flex; flex-direction:column; gap: 26px; box-shadow: 0 20px 40px -30px rgba(47,58,69,0.35); }
   .lbl { font-size: 11px; font-weight: 700; color: ${T.faint}; letter-spacing: 0.04em; }
   .cell { font-size: 13.5px; }
   .thead { display:grid; grid-template-columns: minmax(0,1fr) 70px 90px 100px; gap: 12px; padding: 8px 0; border-bottom: 2px solid ${T.mint}; font-size: 12px; font-weight: 700; color: ${T.graphite}; }
   .trow { display:grid; grid-template-columns: minmax(0,1fr) 70px 90px 100px; gap: 12px; padding: 11px 0; border-bottom: 1px solid ${T.border}; font-size: 13.5px; }`,
  `<div class="page"><div class="sheet">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;">
      <div style="display:flex;flex-direction:column;gap:4px;">
        <div class="h" style="font-size:22px;">סטודיו לדוגמה</div>
        <div style="font-size:12.5px;color:${T.muted};">עוסק פטור 000000000 · רחוב הדוגמה 1, תל אביב · 050-0000000</div>
      </div>
      <div style="text-align:left;display:flex;flex-direction:column;gap:4px;">
        <div class="h" style="font-size:20px;">קבלה <span class="num">1001</span></div>
        <div style="font-size:12.5px;color:${T.muted};">מקור · <span class="num">02.09.2026</span></div>
      </div>
    </div>
    <div style="height:1px;background:${T.border};"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
      <div style="display:flex;flex-direction:column;gap:4px;"><span class="lbl">לכבוד</span><span class="cell" style="font-weight:700;">סטודיו ורד</span><span class="cell" style="color:${T.muted};">ע.מ. 000000000</span></div>
      <div style="display:flex;flex-direction:column;gap:4px;"><span class="lbl">בעבור</span><span class="cell" style="font-weight:700;">שכר דירה - ספטמבר 2026</span></div>
    </div>
    <div>
      <div class="thead"><span>תיאור</span><span>כמות</span><span>מחיר</span><span style="text-align:left;">סה"כ</span></div>
      <div class="trow"><span>שכר דירה לחודש ספטמבר</span><span class="num">1</span><span class="num">₪4,500</span><span class="num" style="text-align:left;font-weight:600;">₪4,500</span></div>
      <div class="trow" style="border-bottom:0;"><span style="color:${T.muted};">דמי ניהול</span><span class="num">1</span><span class="num">₪0</span><span class="num" style="text-align:left;">₪0</span></div>
    </div>
    <div style="display:flex;justify-content:flex-end;">
      <div style="width:260px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;color:${T.muted};"><span>סכום</span><span class="num">₪4,500</span></div>
        <div style="display:flex;justify-content:space-between;font-size:13px;color:${T.muted};"><span>מע"מ</span><span>פטור</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-radius:12px;background:${T.mintTint};border:1px solid ${T.mintLine};"><span style="font-weight:700;color:${T.graphite};">סה"כ לתשלום</span><span class="h num" style="font-size:20px;">₪4,500</span></div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      <span class="lbl">אמצעי תשלום</span>
      <span class="cell">העברה בנקאית · בנק 00 · סניף 000 · חשבון 000000</span>
      <span class="chip chip-paid" style="align-self:flex-start;">${I.check} התקבל תשלום מלא</span>
    </div>
    <div style="flex:1;"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding-top:14px;border-top:1px solid ${T.border};">
      <span style="font-size:11.5px;color:${T.faint};">מסמך ממוחשב. הופק כדין.</span>
      <span style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:${T.faint};">הופק באמצעות ${mark(16)} חשבונית ידידותית</span>
    </div>
  </div></div>`,
);
write("Document.dc.html", docSheet);

/* ------------------------------------------------------------------ */
/* 6. Brand + UI kit sheet 1200 x 720                                  */
/* ------------------------------------------------------------------ */
const sw = (hex, name, role) => `
  <div style="display:flex;flex-direction:column;gap:8px;">
    <div style="height:64px;border-radius:12px;background:${hex};border:1px solid ${T.border};"></div>
    <div style="font-size:13px;font-weight:700;color:${T.graphite};">${name}</div>
    <div class="num" style="font-size:12px;color:${T.muted};direction:ltr;text-align:right;">${hex}</div>
    <div style="font-size:11.5px;color:${T.faint};">${role}</div>
  </div>`;

const brand = wrap(
  "Brand",
  `.page { width: 1200px; height: 760px; background: ${T.off}; direction: rtl; padding: 32px; display:grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto auto; gap: 20px; }
   .sec { padding: 22px 24px; display:flex; flex-direction:column; gap: 16px; }
   .sec h3 { margin:0; font-size: 14px; font-weight: 700; color: ${T.faint}; letter-spacing: 0.04em; }
   .field { height:44px; border:1px solid ${T.border}; border-radius:12px; background:${T.white}; display:flex; align-items:center; padding:0 14px; font-size:14px; color:${T.faint}; gap:10px; }
   .field.focus { border-color:${T.mint}; box-shadow:0 0 0 3px ${T.mintTint}; color:${T.text}; }`,
  `<div class="page">
    <div class="card sec" style="grid-row: span 2;">
      <h3>הלוגו</h3>
      <div style="display:flex;align-items:center;gap:28px;">
        ${mark(150)}
        <div style="display:flex;flex-direction:column;gap:6px;">
          <span class="wm" style="font-size:44px;">חשבונית ידידותית</span>
          <span style="font-size:22px;color:${T.muted};font-weight:500;">התנהלות פשוטה לעסק מצליח</span>
          <span style="font-size:14px;color:${T.mintInk};letter-spacing:0.32em;font-weight:600;">FRIENDLYINVOICE</span>
          <span style="width:64px;height:5px;border-radius:999px;background:${T.peach};margin-top:4px;"></span>
        </div>
      </div>
      <div style="height:1px;background:${T.border};"></div>
      <div style="display:flex;align-items:center;gap:26px;flex-wrap:wrap;">
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px;"><div style="width:96px;height:96px;border-radius:24px;background:${T.mint};display:flex;align-items:center;justify-content:center;">${mark(58)}</div><span style="font-size:12px;color:${T.muted};">אייקון אפליקציה</span></div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px;"><div style="width:96px;height:96px;border-radius:24px;background:${T.graphite};display:flex;align-items:center;justify-content:center;">${mark(58)}</div><span style="font-size:12px;color:${T.muted};">גרסה כהה</span></div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px;"><div style="width:96px;height:96px;border-radius:24px;background:${T.white};border:1px solid ${T.border};display:flex;align-items:center;justify-content:center;">${mark(58)}</div><span style="font-size:12px;color:${T.muted};">על לבן</span></div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px;"><div style="width:96px;height:96px;display:flex;align-items:center;justify-content:center;gap:10px;">${mark(32)}${mark(20)}</div><span style="font-size:12px;color:${T.muted};">favicon 32 / 20</span></div>
      </div>
      <div style="height:1px;background:${T.border};"></div>
      <div style="display:flex;align-items:center;gap:10px;background:${T.white};border:1px solid ${T.border};border-radius:12px;padding:12px 14px;">${mark(28)}<span class="wm" style="font-size:18px;">חשבונית ידידותית</span><span style="font-size:12px;color:${T.muted};margin-right:auto;">לוקאפ אופקי לכותרת האתר והאפליקציה</span></div>
    </div>

    <div class="card sec">
      <h3>פלטת הצבעים</h3>
      <div style="display:grid;grid-template-columns:repeat(5, minmax(0,1fr));gap:14px;">
        ${sw(T.graphite, "Graphite", "צבע ראשי, כפתורים, כותרות")}
        ${sw(T.mint, "Mint", "צבע משני, הדגשות, שולם")}
        ${sw(T.peach, "Peach", "הדגשה חמה, ממתין")}
        ${sw(T.off, "Off-white", "רקע האפליקציה")}
        ${sw(T.border, "Border", "גבולות ותמיכה")}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <span class="chip" style="background:${T.mintTint};color:${T.mintInk};">Mint tint ${T.mintTint}</span>
        <span class="chip" style="background:${T.peachTint};color:${T.peachInk};">Peach tint ${T.peachTint}</span>
        <span class="chip" style="background:${T.white};border:1px solid ${T.border};color:${T.text};">Dark text ${T.text}</span>
        <span style="font-size:12px;color:${T.faint};align-self:center;">טקסט על mint או peach תמיד ב-Graphite. Mint כטקסט על לבן מוכהה ל-${T.mintInk}.</span>
      </div>
    </div>

    <div class="card sec">
      <h3>רכיבי ממשק</h3>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span class="btn btn-primary">${I.plus}הפקת חשבונית</span>
        <span class="btn btn-secondary">ייצוא לדוח</span>
        <span class="btn btn-mint">שלח ללקוח</span>
        <span class="btn btn-secondary btn-sm" style="color:${T.peachInk};border-color:${T.peachLine};">מחק</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="field">${I.users}שם הלקוח</div>
        <div class="field focus">${I.search}חיפוש מסמך, לקוח...</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span class="chip chip-paid"><span class="dot" style="background:currentColor;"></span>שולם</span>
        <span class="chip chip-wait"><span class="dot" style="background:currentColor;"></span>ממתין לתשלום</span>
        <span class="chip chip-sent"><span class="dot" style="background:currentColor;"></span>נשלח</span>
        <span class="chip chip-draft"><span class="dot" style="background:currentColor;"></span>טיוטה</span>
        <span style="font-size:12px;color:${T.faint};">תגי סטטוס</span>
      </div>
      <div style="display:flex;align-items:center;gap:16px;">
        <span style="font-family:Rubik, Heebo, Arial;font-weight:800;font-size:22px;color:${T.graphite};">כותרת ראשית Rubik</span>
        <span style="font-size:15px;color:${T.text};">טקסט גוף Heebo, נעים לקריאה, ברור ומזמין.</span>
      </div>
    </div>
  </div>`,
);
write("Brand.dc.html", brand);

/* canvas layout */
const canvas = {
  artboards: [
    { file: "Brand.dc.html", x: 0, y: 0, w: 1200, h: 760, title: "מותג + רכיבים" },
    { file: "Document.dc.html", x: 1300, y: 0, w: 700, h: 940, title: "מסמך (קבלה)" },
    { file: "Main.dc.html", x: 0, y: 1100, w: 1440, h: 2290, title: "דף נחיתה - דסקטופ" },
    { file: "LandingMobile.dc.html", x: 1560, y: 1100, w: 390, h: 844, title: "דף נחיתה - מובייל" },
    { file: "Dashboard.dc.html", x: 0, y: 3540, w: 1440, h: 1000, title: "דשבורד - דסקטופ" },
    { file: "DashboardMobile.dc.html", x: 1560, y: 3540, w: 390, h: 844, title: "דשבורד - מובייל" },
  ],
  annotations: [
    { id: "intro", x: 1300, y: -180, w: 620, text: "מוקאפ הרענון: Graphite כצבע ראשי, Mint כמשני, Peach להדגשה. Rubik לכותרות, Heebo לגוף. הלוגו: מסמך מחייך. התוכן לא השתנה, רק העיצוב." },
  ],
  launch: { view: "canvas" },
};
writeFileSync(new URL("./canvas.json", import.meta.url), JSON.stringify(canvas, null, 2));
console.log("wrote canvas.json");
