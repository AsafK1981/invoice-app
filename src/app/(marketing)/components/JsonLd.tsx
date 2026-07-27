import { serializeJsonLd } from "@/lib/jsonld";

/**
 * Emits one JSON-LD @graph for a page. Always goes through serializeJsonLd,
 * which escapes `<` so article-derived content (FAQ answers) cannot break out
 * of the script tag.
 */
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
