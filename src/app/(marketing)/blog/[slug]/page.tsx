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
import { CANONICAL_ORIGIN } from "@/lib/public-url";
import { parseFaq } from "@/lib/blog-faq";
import { POST_RELATED } from "@/lib/related-links";
import {
  graph,
  organization,
  article,
  breadcrumbList,
  faqPage,
} from "@/lib/jsonld";
import JsonLd from "../../components/JsonLd";
import RelatedLinks from "../../components/RelatedLinks";
import SignupCta from "../../components/SignupCta";

const BASE = CANONICAL_ORIGIN;

// Pre-render every post (drafts included) so a draft is reachable by direct
// URL for review, while still hidden from the index + sitemap and marked
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
    title: `${post.title} | חשבונית סופר ידידותית`,
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

  // FAQPage is derived from the article's own "## שאלות נפוצות" section, so the
  // markup can never describe questions the page does not visibly show.
  const faq = parseFaq(rawMd);

  // Drafts are noindex and excluded from the sitemap; emitting structured data
  // for them would advertise a page we deliberately hid.
  const jsonLd = post.published
    ? graph(
        organization(),
        article(post),
        breadcrumbList([
          { name: "בית", path: "/" },
          { name: "מגזין", path: "/blog" },
          { name: post.title, path: `/blog/${post.slug}` },
        ]),
        ...(faq.length > 0 ? [faqPage(faq)] : []),
      )
    : null;

  return (
    <>
      {jsonLd && <JsonLd data={jsonLd} />}

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
              טיוטה: עדיין לא פורסם
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

          <RelatedLinks targets={POST_RELATED[post.slug] ?? {}} />
          <SignupCta />
        </div>
      </main>

      <FooterV2 />
    </>
  );
}
