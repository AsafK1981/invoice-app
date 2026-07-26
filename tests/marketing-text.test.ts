import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COMPETITORS } from "@/lib/comparison-data";

/**
 * REGRESSION GUARD: split-literal Hebrew joins.
 *
 * The bug this exists to stop (shipped to production 2026-07):
 *
 *   <h1 className="v2-h1">
 *     מי כדאי לי,{" "}
 *     <br />
 *     <span className="v2-gold">באמת?</span>
 *   </h1>
 *
 * Each literal is individually unremarkable, but joined they read
 * "מי כדאי לי, באמת?" — "who is worth it for me, really?", which is not a
 * grammatical Hebrew question about software. The sentence a reader actually
 * sees NEVER EXISTS as a string in the source, so grep, string search, diff
 * review and every existing test were structurally blind to it: only the
 * browser's JOINED `textContent` is wrong. The same structural blindness in
 * its missing-space form produced "חשבוניתסופר ידידותית" in the logo wordmark
 * (fixed in f7b330c). Both are caught here by asserting the joined text.
 *
 * ── Why renderToStaticMarkup and not jsdom / .next HTML ──────────────────
 *
 * Three approaches were on the table:
 *
 *   1. jsdom + @testing-library/react — real `textContent`, but BOTH are new
 *      dependencies (jsdom alone pulls ~50 transitive packages) for one test.
 *      Rejected: not worth the surface area.
 *   2. Parse `.next/server/app/**​/*.html` after `next build` — highest
 *      fidelity (asserts exactly what ships), but the test can only run AFTER
 *      a build, so it must either fail spuriously or silently SKIP in a plain
 *      `npx vitest run` / pre-commit hook / CI job that doesn't build. A guard
 *      that skips is a guard that isn't there on the day it matters. Rejected.
 *   3. (chosen) `react-dom/server`'s `renderToStaticMarkup` on the real page
 *      modules, then strip tags. React and react-dom are already dependencies
 *      — ZERO new packages. Runs in well under a second, ALWAYS, with no build
 *      prerequisite, and it renders the ACTUAL page components rather than a
 *      copy of their JSX, so it catches the bug at its source.
 *
 * Tag-stripping is equivalent to `textContent` for this bug class: an element
 * boundary contributes no characters in either model, so `foo<br /><span>bar`
 * yields "foobar" here exactly as it does in a browser. That equivalence IS
 * the bug, which is precisely why this substitute works.
 *
 * The one concession: `next/navigation`'s `useRouter` throws outside a Next
 * runtime, so it is stubbed below. That is the entire shim — no DOM, no router
 * context, no test renderer.
 */

// Minimal stub so client components that call useRouter() (RedirectIfAuthed on
// the landing page) can render. Nothing under test depends on router behaviour.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect: () => {},
  notFound: () => {},
}));

const APP_NAME = "חשבונית סופר ידידותית";

/** JSON-LD and CSS are machine-read, not page copy. */
function stripNonText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** The `textContent` of a fragment of markup. */
function toText(html: string): string {
  return decodeEntities(
    stripNonText(html)
      .replace(/<!--[\s\S]*?-->/g, "") // React separator comments
      .replace(/<[^>]+>/g, ""),
  );
}

async function renderPage(importer: () => Promise<{ default: unknown }>) {
  const mod = await importer();
  const Page = mod.default as () => ReactElement;
  return stripNonText(renderToStaticMarkup(createElement(Page)));
}

// Page modules under test. The import paths are inline literals so Vite can
// statically analyse them.
const PAGES: Record<string, () => Promise<{ default: unknown }>> = {
  "/": () => import("../src/app/(marketing)/page"),
  "/vs": () => import("../src/app/(marketing)/vs/page"),
  "/vs/invoice4u": () => import("../src/app/(marketing)/vs/invoice4u/page"),
  "/vs/greeninvoice": () => import("../src/app/(marketing)/vs/greeninvoice/page"),
  "/vs/ifreelance": () => import("../src/app/(marketing)/vs/ifreelance/page"),
  "/vs/sumit": () => import("../src/app/(marketing)/vs/sumit/page"),
  "/vs/icount": () => import("../src/app/(marketing)/vs/icount/page"),
  "/vs/ezcount": () => import("../src/app/(marketing)/vs/ezcount/page"),
};
const ROUTES = Object.keys(PAGES);

const htmlCache = new Map<string, string>();
async function pageHtml(route: string): Promise<string> {
  const cached = htmlCache.get(route);
  if (cached !== undefined) return cached;
  const rendered = await renderPage(PAGES[route]);
  htmlCache.set(route, rendered);
  return rendered;
}

interface TextBlock {
  tag: string;
  text: string;
}

const BLOCK_TAGS =
  "div|p|li|h[1-6]|td|th|section|header|footer|main|nav|article|ul|ol|table|tr|thead|tbody|figcaption|blockquote|dt|dd|summary|caption|form|label|button";

/**
 * Every LEAF block element's joined text — i.e. an element that contains no
 * further block element, only inline markup (<span>, <br>, <a>, <b>, <svg>…).
 *
 * Leaf scope is what makes this checkable. A whole-page text dump glues the
 * end of one paragraph onto the start of the next (a real element boundary,
 * not a bug) and would flag ~8 false positives per page. Scoped to leaves,
 * every join inside a block is one an author wrote — exactly the bug class.
 */
function textBlocks(html: string): TextBlock[] {
  const re = new RegExp(
    String.raw`<(${BLOCK_TAGS})\b[^>]*>((?:(?!<(?:${BLOCK_TAGS})\b)[\s\S])*?)</\1>`,
    "gi",
  );
  const out: TextBlock[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = toText(m[2]).trim();
    if (text) out.push({ tag: m[1].toLowerCase(), text });
  }
  return out;
}

/** Headings and table headers, whether or not they are leaves. */
function headings(html: string): TextBlock[] {
  const re = /<(h[1-6]|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const out: TextBlock[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({ tag: m[1].toLowerCase(), text: toText(m[2]).trim() });
  }
  return out;
}

async function h1Of(route: string): Promise<string> {
  const h = headings(await pageHtml(route)).find((x) => x.tag === "h1");
  if (!h) throw new Error(`${route}: no <h1> rendered`);
  return h.text;
}

describe("marketing pages — joined heading text", () => {
  it("/vs H1 reads as one sentence across its <br>", async () => {
    // This exact heading is the one that shipped reading as nonsense; the
    // assertion is on the joined sentence, not on either literal.
    expect(await h1Of("/vs")).toBe("איזו תוכנה באמת מתאימה לך?");
  });

  it("landing H1 reads as one sentence across its <br>", async () => {
    expect(await h1Of("/")).toBe("החשבונית שלך, יוקרתית כמו העסק");
  });

  it("every /vs/<competitor> hero H1 reads '<app> מול <competitor>'", async () => {
    for (const c of Object.values(COMPETITORS)) {
      expect(await h1Of(`/vs/${c.slug}`), `H1 of /vs/${c.slug}`).toBe(
        `${APP_NAME} מול ${c.name}`,
      );
    }
  });

  it("the feature-matrix 'us' <th> joins to the full app name", async () => {
    // Authored as "חשבונית" + <br /> + "סופר ידידותית" — the exact shape that
    // silently loses its space.
    for (const c of Object.values(COMPETITORS)) {
      const ths = headings(await pageHtml(`/vs/${c.slug}`))
        .filter((h) => h.tag === "th")
        .map((h) => h.text);
      expect(ths, `feature-matrix <th> on /vs/${c.slug}`).toContain(APP_NAME);
    }
  });

  it("/vs index card headings read '<app> מול <competitor>'", async () => {
    const h2s = headings(await pageHtml("/vs"))
      .filter((h) => h.tag === "h2")
      .map((h) => h.text);
    for (const c of Object.values(COMPETITORS)) {
      expect(h2s, `card heading for ${c.slug}`).toContain(`${APP_NAME} מול ${c.name}`);
    }
  });
});

describe("marketing pages — brand wordmark", () => {
  it("the logo wordmark joins to 'חשבונית סופר ידידותית', not 'חשבוניתסופר…'", async () => {
    const { default: LogoV2 } = await import("../src/app/(marketing)/components/LogoV2");
    const full = toText(renderToStaticMarkup(createElement(LogoV2))).trim();
    expect(full).toBe(APP_NAME);

    const mark = toText(
      renderToStaticMarkup(createElement(LogoV2, { variant: "mark" as const })),
    ).trim();
    expect(mark).toBe(APP_NAME);
  });

  it("the wordmark survives inside the header and footer of every page", async () => {
    for (const route of ROUTES) {
      const text = toText(await pageHtml(route));
      expect(text, `${route}: no unmangled wordmark in the page text`).toContain(APP_NAME);
      // Spelled out so the failure message names the actual defect.
      expect(text, `${route}: mangled wordmark "חשבוניתסופר"`).not.toContain("חשבוניתסופר");
    }
  });
});

/**
 * Generic sweep. The assertions above only cover strings someone thought to
 * list; this catches the same bug class anywhere on the page. A missing space
 * between two Hebrew WORDS is undetectable without a dictionary, so instead we
 * assert the two machine-checkable signatures of a bad join:
 *   • punctuation glued straight onto a Hebrew letter — "לי,באמת" (the symptom)
 *   • a double space — the inverse, a join applied twice
 */
const HEBREW = "֐-׿";
const GLUED_PUNCT = new RegExp(`[,.;:!?][${HEBREW}]`);
const DOUBLE_SPACE = /\s{2,}/;

describe("marketing pages — generic split-literal signatures", () => {
  it("no text block glues punctuation directly onto a Hebrew letter", async () => {
    const offenders: string[] = [];
    for (const route of ROUTES) {
      for (const b of textBlocks(await pageHtml(route))) {
        const hit = GLUED_PUNCT.exec(b.text);
        if (hit) {
          offenders.push(
            `${route} <${b.tag}> "${b.text}"\n    → "${hit[0]}" has no space after the ` +
              `punctuation; split JSX literals were joined without {" "}`,
          );
        }
      }
    }
    expect(offenders, `\n${offenders.join("\n")}\n`).toEqual([]);
  });

  it("no text block contains a double space", async () => {
    const offenders: string[] = [];
    for (const route of ROUTES) {
      for (const b of textBlocks(await pageHtml(route))) {
        if (DOUBLE_SPACE.test(b.text)) {
          offenders.push(`${route} <${b.tag}> ${JSON.stringify(b.text)} → double whitespace`);
        }
      }
    }
    expect(offenders, `\n${offenders.join("\n")}\n`).toEqual([]);
  });

  it("no heading renders empty", async () => {
    for (const route of ROUTES) {
      for (const h of headings(await pageHtml(route))) {
        expect(h.text.length, `${route}: empty <${h.tag}>`).toBeGreaterThan(0);
      }
    }
  });

  // Non-vacuity guard: the two sweeps above pass trivially if extraction ever
  // returns nothing (a markup change, a broken regex, a page that stops
  // rendering). Pin the floor so silence means "clean", not "blind".
  it("actually extracts text from every page", async () => {
    for (const route of ROUTES) {
      const html = await pageHtml(route);
      expect(textBlocks(html).length, `${route}: too few text blocks extracted`).toBeGreaterThan(
        15,
      );
      expect(headings(html).length, `${route}: no headings extracted`).toBeGreaterThan(0);
    }
  });
});

/**
 * Data-level sweep of comparison-data.ts. Cheap (no rendering) and it protects
 * the strings that feed the headings and verdicts above: a double space or a
 * missing space after a comma in the DATA reaches the page identically to the
 * JSX bug, and no render assertion above pins every field.
 */
describe("comparison-data string hygiene", () => {
  const strings: Array<{ path: string; value: string }> = [];
  (function walk(node: unknown, path: string) {
    if (typeof node === "string") strings.push({ path, value: node });
    else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    }
  })(COMPETITORS, "COMPETITORS");
  // URLs and slugs are machine strings, not prose.
  const prose = strings.filter(({ path }) => !/\.(url|slug)$/.test(path));
  const report = (bad: typeof prose) => bad.map((b) => `${b.path}: ${JSON.stringify(b.value)}`);

  it("collected the data strings", () => {
    expect(prose.length).toBeGreaterThan(200);
  });

  it("has no double spaces", () => {
    expect(report(prose.filter((s) => /  /.test(s.value)))).toEqual([]);
  });

  it("has no punctuation glued to the following Hebrew letter", () => {
    expect(report(prose.filter((s) => GLUED_PUNCT.test(s.value)))).toEqual([]);
  });

  it("has no leading/trailing whitespace or embedded newlines/tabs", () => {
    expect(
      report(prose.filter((s) => s.value !== s.value.trim() || /[\n\t]/.test(s.value))),
    ).toEqual([]);
  });
});
