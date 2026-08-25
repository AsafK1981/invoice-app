/**
 * Extracts the "שאלות נפוצות" section out of a post's markdown so FAQPage
 * structured data can be DERIVED from the text readers actually see.
 *
 * Why parse instead of hand-authoring a parallel FAQ array: Google requires
 * FAQPage markup to be visibly present on the page. A duplicated array drifts
 * from the rendered article the first time someone edits one and not the
 * other, and drifted FAQ markup earns a structured-data manual action, not
 * just a lost rich result. Parsing makes drift impossible by construction.
 *
 * The format is uniform across every post Peitho drafts:
 *
 *     ## שאלות נפוצות
 *
 *     **Question text?**
 *     Answer paragraph.
 *
 *     **Next question?**
 *     Answer paragraph.
 *
 *     ---
 *
 * so the parser is deliberately strict: a post that deviates yields nothing
 * rather than emitting half-parsed garbage into structured data, and
 * tests/blog-faq.test.ts fails loudly when the format shifts.
 */

export interface FaqItem {
  q: string;
  a: string;
}

const FAQ_HEADING = /^##\s+שאלות נפוצות\s*$/m;

/** Markdown emphasis/links are display syntax; acceptedAnswer.text must be
 *  plain prose, so strip them rather than shipping literal ** and [](). */
function toPlainText(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) -> text
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2") // italics
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\s+/g, " ")
    .trim();
}

export function parseFaq(markdown: string): FaqItem[] {
  const headingMatch = FAQ_HEADING.exec(markdown);
  if (!headingMatch) return [];

  const afterHeading = markdown.slice(headingMatch.index + headingMatch[0].length);

  // The section ends at the next h2, a horizontal rule, or end of document.
  const endMatch = /^(##\s|---\s*$)/m.exec(afterHeading);
  const section = endMatch ? afterHeading.slice(0, endMatch.index) : afterHeading;

  const items: FaqItem[] = [];
  let current: { q: string; a: string[] } | null = null;

  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.trim();

    // A line that is WHOLLY bold is a question. Requiring the whole line
    // avoids mistaking a bolded phrase inside an answer for a new question.
    const questionMatch = /^\*\*(.+)\*\*$/.exec(line);
    if (questionMatch) {
      if (current) items.push({ q: current.q, a: toPlainText(current.a.join(" ")) });
      current = { q: toPlainText(questionMatch[1]), a: [] };
      continue;
    }

    if (current && line) current.a.push(line);
  }

  if (current) items.push({ q: current.q, a: toPlainText(current.a.join(" ")) });

  // A question with no answer is not valid FAQPage data - drop it rather than
  // emitting an empty acceptedAnswer.
  return items.filter((item) => item.q.length > 0 && item.a.length > 0);
}
