import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LtrText } from "@/components/ui/ltr";
import { getPostBySlug } from "@/lib/blog-posts";
import { COMPETITORS } from "@/lib/comparison-data";
import type { RelatedTargets } from "@/lib/related-links";

/**
 * "כדאי לקרוא גם" - the internal-link block that closes an article or a
 * comparison page.
 *
 * Titles are resolved here from BLOG_POSTS/COMPETITORS rather than stored
 * alongside the slugs, so renaming a post updates every link to it. Anything
 * that fails to resolve, or resolves to an UNPUBLISHED post, is dropped: a
 * draft is noindex and excluded from the sitemap, so linking to it would emit
 * a crawlable path to a page we deliberately hid.
 *
 * Markup deliberately reuses `.v2-blog-list` / `.v2-blog-card` / `.v2-card-link`
 * from the /blog index so this needs no new card CSS.
 */
export default function RelatedLinks({
  targets,
  heading = "כדאי לקרוא גם",
}: {
  targets: RelatedTargets;
  heading?: string;
}) {
  const postLinks = (targets.posts ?? [])
    .map((slug) => getPostBySlug(slug))
    .filter((post) => post?.published)
    .map((post) => ({
      href: `/blog/${post!.slug}`,
      title: post!.title,
      blurb: post!.description,
    }));

  const vsLinks = (targets.vs ?? [])
    .map((slug) => COMPETITORS[slug])
    .filter(Boolean)
    .map((competitor) => ({
      href: `/vs/${competitor.slug}`,
      title: `השוואה מול ${competitor.name}`,
      blurb: `מה ההבדל במחיר, בפיצ׳רים ובהתאמה לעוסק פטור מול ${competitor.name}.`,
    }));

  const links = [...postLinks, ...vsLinks];
  if (links.length === 0) return null;

  return (
    <section className="v2-related" aria-labelledby="v2-related-heading">
      <div className="v2-eyebrow-row">
        <i className="ln" />
        <span id="v2-related-heading">{heading}</span>
      </div>

      <div className="v2-blog-list">
        {links.map((link) => (
          <article key={link.href} className="v2-blog-card">
            <h3>
              <Link href={link.href} className="v2-card-link">
                <LtrText text={link.title} />
              </Link>
            </h3>
            <p>
              <LtrText text={link.blurb} />
            </p>
            <span className="more" aria-hidden="true">
              לקריאה
              <ArrowLeft />
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
