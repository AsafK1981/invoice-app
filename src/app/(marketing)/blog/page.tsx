import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowLeft } from "lucide-react";
import HeaderV2 from "../components/HeaderV2";
import FooterV2 from "../components/FooterV2";
import { LtrText } from "@/components/ui/ltr";
import { getPublishedPosts } from "@/lib/blog-posts";

export const metadata: Metadata = {
  title: "מגזין | חשבונית סופר ידידותית",
  description:
    "מדריכים פשוטים לעצמאים בישראל: עוסק פטור ומורשה, מספר הקצאה, רפורמת חשבונית ישראל, והוצאת חשבוניות כחוק, בשפה ברורה, בלי ז׳רגון.",
  alternates: { canonical: "/blog" },
};

/**
 * /blog, magazine index. Lists ONLY published posts (published: true),
 * newest first. Draft posts (published: false) are intentionally omitted
 * here; they stay reachable by direct URL for review. See src/lib/blog-posts.ts.
 */
export default function BlogIndexPage() {
  const posts = getPublishedPosts();

  return (
    <>
      <div className="v2-frame" aria-hidden="true">
        <i className="tl" />
        <i className="tr" />
        <i className="bl" />
        <i className="br" />
      </div>

      <HeaderV2 />

      {/* `v2-doc-wide`: the index body is a card GRID, not prose, so it wants
          the wide container rather than the narrow reading column that
          /blog/<slug>, /terms and /privacy use. */}
      <main className="v2-main">
        <div className="v2-doc v2-doc-wide">
          <Link href="/" className="v2-back">
            <ArrowRight />
            חזרה לעמוד הבית
          </Link>

          <div className="v2-doc-head">
            <div className="v2-eyebrow-row">
              <i className="ln" />
              <span>מגזין</span>
            </div>
            <h1 className="v2-doc-title v2-gold">מדריכים לעצמאים</h1>
            <p className="v2-doc-lead">
              כל מה שעוסק פטור ומורשה צריך לדעת על חשבוניות, מספר הקצאה ורפורמת
              חשבונית ישראל, בשפה פשוטה, בלי ז׳רגון ובלי טפסים מפחידים.
            </p>
          </div>

          {posts.length === 0 ? (
            <div className="v2-blog-empty">
              עוד רגע יהיה כאן תוכן. אנחנו כותבים.
            </div>
          ) : (
            <div className="v2-blog-list">
              {posts.map((post) => (
                /* The card is an <article>, not a link. Its heading holds the
                   one real anchor; `.v2-card-link::after` stretches that anchor
                   over the whole card so the surface stays clickable. */
                <article key={post.slug} className="v2-blog-card">
                  <span className="date">
                    {new Date(post.date).toLocaleDateString("he-IL", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </span>
                  <h2>
                    <Link href={`/blog/${post.slug}`} className="v2-card-link">
                      <LtrText text={post.title} />
                    </Link>
                  </h2>
                  <p>
                    <LtrText text={post.description} />
                  </p>
                  <span className="more" aria-hidden="true">
                    לקריאה
                    <ArrowLeft />
                  </span>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>

      <FooterV2 />
    </>
  );
}
