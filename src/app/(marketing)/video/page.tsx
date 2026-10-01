import type { Metadata } from "next";
import HeaderLight from "../components/HeaderLight";
import FooterLight from "../components/FooterLight";
import SignupLink from "../components/SignupLink";
import { pageMetadata } from "@/lib/page-metadata";
import { absoluteUrl } from "@/lib/public-url";
import "../marketing-light.css";
import "../components/promo-video.css";
import "./video.css";

/**
 * /video - a one-screen share page for the promo video (Asaf, 2026-09-28):
 * the link that goes into Facebook comments and WhatsApp. Headline, the
 * vertical video, one signup button. Nothing else.
 *
 * The preview card comes from the file-based opengraph-image.jpg /
 * twitter-image.jpg next to this file (a frame of the video on the site
 * cream). og:video points at the same MP4 the page plays.
 * No personal name/email/phone here (FooterLight hides its operator line on
 * this path).
 */
const VIDEO_SRC = "/video/friendly-invoice-promo-v3.mp4";
const POSTER_SRC = "/video/friendly-invoice-promo-v2-poster.jpg";

const base = pageMetadata({
  path: "/video",
  title: "ככה מוציאים חשבונית ב-20 שניות",
  ogTitle: "ככה מוציאים חשבונית ב-20 שניות | חשבונית ידידותית",
  description:
    "סרטון קצר: חשבונית חדשה, מספר הקצאה אוטומטי ושליחה ללקוח בוואטסאפ. חינם לתמיד עד 5 מסמכים בחודש.",
});

export const metadata: Metadata = {
  ...base,
  openGraph: {
    ...base.openGraph,
    videos: [
      {
        url: absoluteUrl(VIDEO_SRC),
        secureUrl: absoluteUrl(VIDEO_SRC),
        type: "video/mp4",
        width: 1080,
        height: 1920,
      },
    ],
  },
};

export default function VideoPage() {
  return (
    <div className="ml-theme">
      <HeaderLight />

      <main id="main-content">
        <section className="ml-hero vid-hero">
          <div className="ml-wrap ml-hero-in">
            <h1 className="ml-hero-h1 vid-h1">
              ככה מוציאים חשבונית <span className="ml-grad-text">ב-20 שניות</span>
            </h1>

            <div className="vid-frame">
              <video
                className="vid-player"
                src={VIDEO_SRC}
                poster={POSTER_SRC}
                width={1080}
                height={1920}
                autoPlay
                muted
                loop
                playsInline
                controls
                preload="metadata"
                aria-label="סרטון הדגמה של חשבונית ידידותית"
              />
            </div>

            <div className="ml-hero-actions vid-actions">
              <SignupLink className="ml-btn ml-btn-primary ml-btn-lg">
                להתחיל בחינם
              </SignupLink>
              <span className="ml-hero-note">
                חינם לתמיד עד 5 מסמכים בחודש, בלי כרטיס אשראי
              </span>
            </div>
          </div>
        </section>
      </main>

      <FooterLight />
    </div>
  );
}
