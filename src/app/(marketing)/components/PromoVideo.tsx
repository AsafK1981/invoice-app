"use client";

import { useEffect, useRef } from "react";
import "./promo-video.css";

/**
 * The 18-second promo video, embedded on the landing page (2026-09-30).
 *
 * Lazy by construction so the landing's LCP cannot regress: the server
 * renders a <video> with NO src and NO poster, so the first paint fetches
 * nothing for it. When the frame comes within ~600px of the viewport the
 * poster and the MP4 are attached (preload="metadata"), and while at least
 * half of it is on screen it plays, muted; scrolled away it pauses.
 *
 * Also hidden behind a mobile demo tab: an element with display:none never
 * intersects, so a visitor who never opens the tab never downloads it.
 *
 * Without JS the video has no source, so a plain link to /video (the share
 * page, which plays it natively) stands in.
 */
export const PROMO_VIDEO_SRC = "/video/friendly-invoice-promo-v3.mp4";
export const PROMO_POSTER_SRC = "/video/friendly-invoice-promo-v2-poster.jpg";

export default function PromoVideo({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video || typeof IntersectionObserver === "undefined") return;

    const attach = () => {
      if (video.getAttribute("src")) return;
      video.poster = PROMO_POSTER_SRC;
      video.preload = "metadata";
      video.src = PROMO_VIDEO_SRC;
    };

    const near = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          attach();
          near.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );

    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const visible = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.5) {
            attach();
            // Autoplay only as an enhancement: muted inline playback is
            // allowed everywhere, and if a browser still refuses, the
            // native controls and poster are there to press play.
            if (!reduceMotion && video.paused) video.play().catch(() => {});
          } else if (!video.paused && !document.fullscreenElement) {
            video.pause();
          }
        }
      },
      { threshold: [0, 0.5] },
    );

    near.observe(video);
    visible.observe(video);
    return () => {
      near.disconnect();
      visible.disconnect();
    };
  }, []);

  return (
    <div className={`promo-frame${className ? ` ${className}` : ""}`}>
      <video
        ref={ref}
        className="vid-player"
        width={1080}
        height={1920}
        muted
        loop
        playsInline
        controls
        preload="none"
        aria-label="סרטון הדגמה של חשבונית ידידותית"
      />
      <noscript>
        <a className="promo-noscript" href="/video">
          צפו בסרטון של 20 שניות
        </a>
      </noscript>
    </div>
  );
}
