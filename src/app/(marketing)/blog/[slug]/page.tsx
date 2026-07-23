import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, FileEdit } from "lucide-react";
import { marked } from "marked";
import HeaderV2 from "../../components/HeaderV2";
import FooterV2 from "../../components/FooterV2";
import {
  BLOG_POSTS,
  getPostBySlug,
  loadPostMarkdown,
} from "@/lib/blog-posts";

const BASE = "https://mysuperfriendlyinvoiceapp.vercel.app";

// Pre-render every post (drafts included) so a draft is reachable by direct
// URL for review — while still hidden from the index + sitemap and marked
// noindex below.
export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};

  const url = `${BASE}/blog/${post.slug}`;

  return {
    title: `${post.title} — חשבונית סופר ידידותית`,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    // REVIEW-FIRST: drafts must never be indexed. Flip published:true in
    // src/lib/blog-posts.ts to make a post indexable.
    robots: post.published
      ? undefined
      : { index: false, follow: false },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url,
      publishedTime: post.date,
    },
  };
}

/** Strip the leading H1 from the markdown so it renders once, as the styled
 *  page title (v2-doc-title), instead of a duplicate H1 inside the prose. */
function stripLeadingH1(md: string): string {
  return md.replace(/^\s*#\s+.+\r?\n+/, "");
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const rawMd = loadPostMarkdown(post.slug);
  const html = await marked.parse(stripLeadingH1(rawMd));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    inLanguage: "he-IL",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${BASE}/blog/${post.slug}`,
    },
    author: { "@type": "Organization", name: "חשבונית סופר ידידותית" },
    publisher: {
      "@type": "Organization",
      name: "חשבונית סופר ידידותית",
      logo: { "@type": "ImageObject", url: `${BASE}/logo-v2.svg` },
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="v2-frame" aria-hidden="true">
        <i className="tl" />
        <i className="tr" />
        <i className="bl" />
        <i className="br" />
      </div>

      <HeaderV2 />

      <main className="v2-main">
        <div className="v2-doc">
          <Link href="/blog" className="v2-back">
            <ArrowRight />
            חזרה למגזין
          </Link>

          {!post.published && (
            <div className="v2-draft-banner" role="status">
              <FileEdit />
              טיוטה — עדיין לא פורסם
            </div>
          )}

          <div className="v2-doc-head">
            <div className="v2-eyebrow-row">
              <i className="ln" />
              <span>מגזין</span>
            </div>
            <h1 className="v2-doc-title v2-gold">{post.title}</h1>
            <p className="v2-doc-updated">
              {new Date(post.date).toLocaleDateString("he-IL", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>

          <article
            className="v2-prose"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </main>

      <FooterV2 />
    </>
  );
}
