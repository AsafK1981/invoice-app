import { CANONICAL_ORIGIN, absoluteUrl } from "@/lib/public-url";

/**
 * Structured-data builders. One module so every page emits consistent,
 * origin-correct JSON-LD instead of hand-rolling a `<script>` per page (which
 * is how the /vs pages ended up with an identical SoftwareApplication block
 * and the /vs and /blog indexes ended up with no markup at all).
 *
 * Pages emit ONE @graph rather than several sibling <script> tags: the nodes
 * get @id anchors and reference each other, the Organization node is stated
 * once instead of per-node, and there is a single place to look when a rich
 * result misbehaves.
 */

export const APP_NAME = "MyFriendlyInvoiceApp";
export const APP_NAME_HE = "חשבונית ידידותית";

/**
 * Pre-2026-07-29 brand. Kept as an alternateName so the existing search-result
 * association survives the rename; drop once the new name has been indexed.
 */
const LEGACY_APP_NAME = "MySuperFriendlyInvoiceApp";
const LEGACY_APP_NAME_HE = "חשבונית סופר ידידותית";

const ORG_ID = `${CANONICAL_ORIGIN}/#organization`;
const SITE_ID = `${CANONICAL_ORIGIN}/#website`;

type JsonLdNode = Record<string, unknown>;

export function organization(): JsonLdNode {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: APP_NAME_HE,
    alternateName: [APP_NAME, LEGACY_APP_NAME_HE, LEGACY_APP_NAME],
    url: CANONICAL_ORIGIN,
    logo: { "@type": "ImageObject", url: absoluteUrl("/logo-v2.svg") },
    slogan: "התנהלות פשוטה לעסק מצליח",
  };
}

export function website(): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": SITE_ID,
    name: APP_NAME_HE,
    url: CANONICAL_ORIGIN,
    inLanguage: "he-IL",
    publisher: { "@id": ORG_ID },
  };
}

/**
 * The app itself. Price is the standing list entry price (₪15/mo); the launch
 * period is currently free, which is surfaced in on-page copy rather than in
 * structured pricing so the markup does not contradict the pricing table.
 *
 * `featureList` mirrors the homepage's "כל מה שיש רק אצלנו" advantage grid
 * (src/app/(marketing)/page.tsx), INCLUDING the WhatsApp bot channel since
 * 2026-08-15, when it went live (Meta approval closed) and every on-page
 * `בקרוב` marker came off. Structured data must only claim what is
 * actually live today - if a future feature ships behind a badge again,
 * exclude it here until the badge drops.
 */
export function softwareApplication(): JsonLdNode {
  return {
    "@type": "SoftwareApplication",
    "@id": `${CANONICAL_ORIGIN}/#app`,
    name: APP_NAME,
    alternateName: LEGACY_APP_NAME,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web, iOS, Android (PWA)",
    inLanguage: "he-IL",
    url: CANONICAL_ORIGIN,
    description:
      "תוכנת חשבוניות בעברית לעסקים עצמאיים בישראל: הפקת חשבוניות וקבלות, אינטגרציה ל-API חשבונית ישראל (הקצאת מספרים), במחיר הוגן.",
    featureList: [
      "הקצאת מספרים אוטומטית מרשות המסים (חשבונית ישראל)",
      "עוזר AI בעברית לשאלות על הכנסות ומסמכים",
      "תזכורות אוטומטיות להוצאת מסמכים ולתשלומי לקוחות שמאחרים",
      "הוצאת קבלות ורישום הוצאות ישירות מתוך וואטסאפ",
      "סריקת קבלות והוצאות בצילום",
      "מעקב תקרת עוסק פטור בזמן אמת",
      "דוחות מוכנים לרואה חשבון: מע״מ תקופתי, עזר ל-1301, הצהרת הון",
      "ייבוא היסטוריה מתוכנות חשבוניות אחרות",
      "שליחת מסמכים במייל, בוואטסאפ ובקישור ציבורי",
    ],
    offers: { "@type": "Offer", price: "15", priceCurrency: "ILS" },
    publisher: { "@id": ORG_ID },
  };
}

export function article(post: {
  slug: string;
  title: string;
  description: string;
  date: string;
}): JsonLdNode {
  const url = absoluteUrl(`/blog/${post.slug}`);
  return {
    "@type": "Article",
    "@id": `${url}#article`,
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    inLanguage: "he-IL",
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    author: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
  };
}

export function breadcrumbList(
  trail: { name: string; path: string }[],
): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

export function faqPage(items: { q: string; a: string }[]): JsonLdNode {
  return {
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function itemList(
  items: { name: string; path: string }[],
): JsonLdNode {
  return {
    "@type": "ItemList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: absoluteUrl(item.path),
    })),
  };
}

/** Wraps nodes into the single @graph a page emits. */
export function graph(...nodes: JsonLdNode[]): JsonLdNode {
  return { "@context": "https://schema.org", "@graph": nodes };
}

/**
 * Serialize for embedding in a <script> tag.
 *
 * The `<` escape is load-bearing, not cosmetic: FAQ answers are lifted
 * verbatim out of article markdown, so a literal `</script>` sequence in
 * post content would otherwise close the tag early and inject raw markup into
 * the page. Escaping it as < keeps the JSON semantically identical while
 * making the breakout impossible.
 */
export function serializeJsonLd(data: JsonLdNode): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
