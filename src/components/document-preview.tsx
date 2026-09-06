"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import {
  type Business,
  type DocumentItem,
  type DocumentType,
  type PaymentDetails,
  type PaymentMethod,
} from "@/lib/types";
import { DocumentBody, type DocumentBodyClient } from "./document-body";
import { designToCssVars, normalizeDocumentDesign } from "@/lib/document-themes";
import { docDir, toDocLang } from "@/lib/document-strings";

export type PreviewClient = DocumentBodyClient;

interface Props {
  business: Business;
  client: PreviewClient | null;
  documentType: DocumentType;
  number?: number | null;
  date: string;
  subject?: string;
  items: DocumentItem[];
  subtotal: number;
  vat: number;
  vatRate: number;
  total: number;
  rounding?: number;
  paymentMethod?: PaymentMethod;
  paymentDetails?: PaymentDetails;
  discount?: number;
  withholdingRate?: number;
  withholdingAmount?: number;
  notes?: string;
  currency?: string;
  exchangeRate?: number;
  totalIls?: number;
  zeroRated?: boolean;
  /** מספר הקצאה, mirrors the live allocation-banner value onto the preview. */
  allocationNumber?: string;
  /** Document language: "he" (default, unchanged RTL) or "en" (LTR English). */
  language?: string;
}

const PAGE_WIDTH_PX = 794;
// The enlarged view used to show the sheet at its natural A4 width (794px),
// which on a typical laptop is barely bigger than the inline preview (Asaf,
// 2026-08-27, twice: "not big enough, not wide enough, not spread over the
// page"). It now scales the sheet to fill ZOOMED_VIEWPORT_FRACTION of the
// window width (a 1290px viewport gets a ~1190px sheet), never beyond
// ZOOMED_MAX_SCALE on very wide monitors.
const ZOOMED_MAX_SCALE = 1.8;
const ZOOMED_VIEWPORT_FRACTION = 0.92;

export function DocumentPreview(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [zoomed, setZoomed] = useState(false);
  const [zoomedScale, setZoomedScale] = useState(1);

  // Fit the enlarged sheet to the window: as big as ZOOMED_MAX_SCALE allows
  // on wide screens. CSS `zoom` (not a transform) so text re-rasterises
  // sharp at the new size. On a screen narrower than the A4 sheet (phones)
  // the scale stays 1 and the sheet reflows to the screen width instead,
  // so the text keeps its readable size rather than shrinking to fit.
  useEffect(() => {
    if (!zoomed) return;
    const update = () => {
      const available = window.innerWidth * ZOOMED_VIEWPORT_FRACTION;
      setZoomedScale(
        available >= PAGE_WIDTH_PX ? Math.min(ZOOMED_MAX_SCALE, available / PAGE_WIDTH_PX) : 1,
      );
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [zoomed]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / PAGE_WIDTH_PX));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Zoomed state closes on: X, Escape, a click/tap ANYWHERE outside the
  // sheet (the whole overlay, not just the blurred backdrop strip beside
  // the sheet), and the browser/phone Back button. Back works by pushing a
  // history entry when the zoom opens; popstate closes it and, if the user
  // closed it another way, we pop our own entry so Back afterwards still
  // does what it did before the zoom.
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(false);
    };
    let closedByPop = false;
    const onPop = () => {
      closedByPop = true;
      setZoomed(false);
    };
    window.history.pushState({ docPreviewZoom: true }, "");
    window.addEventListener("popstate", onPop);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = "";
      if (!closedByPop && window.history.state?.docPreviewZoom) {
        window.history.back();
      }
    };
  }, [zoomed]);

  // Same security boundary as receipt-view.tsx: business.documentDesign is
  // untrusted, normalizeDocumentDesign() + designToCssVars() are the only
  // functions allowed to turn it into CSS. Live: as the Settings design
  // panel edits an in-progress design, it passes a `business` object with
  // `documentDesign` set to that in-progress (still-unsaved) object, so
  // this preview updates instantly without any new prop on this component.
  const design = normalizeDocumentDesign(props.business.documentDesign);
  const themeVars = designToCssVars(design);
  const themeAttrs = {
    style: themeVars,
    "data-doc-template": design?.template ?? "general",
    "data-doc-layout": design?.layout ?? "cards",
    "data-doc-pattern": design?.pattern ?? "none",
    "data-logo-pos": design?.logoPosition ?? "right",
  } as const;

  // Same sheet, two reading directions: the preview must show exactly what the
  // issued document will look like, so the language drives both the words
  // (DocumentBody) and the paper's `dir` in both render sites below.
  const language = toDocLang(props.language);
  const dir = docDir(language);

  const body = (
    <DocumentBody
      business={props.business}
      client={props.client}
      documentType={props.documentType}
      number={props.number ?? null}
      date={props.date}
      subject={props.subject}
      items={props.items}
      subtotal={props.subtotal}
      vat={props.vat}
      vatRate={props.vatRate}
      total={props.total}
      rounding={props.rounding}
      paymentMethod={props.paymentMethod}
      paymentDetails={props.paymentDetails}
      discount={props.discount}
      withholdingRate={props.withholdingRate}
      withholdingAmount={props.withholdingAmount}
      notes={props.notes}
      currency={props.currency}
      exchangeRate={props.exchangeRate}
      totalIls={props.totalIls}
      zeroRated={props.zeroRated}
      allocationNumber={props.allocationNumber}
      language={language}
      placeholders
    />
  );

  return (
    <>
      <div ref={wrapRef} className="gk-doc-preview w-full">
        <button
          type="button"
          onClick={() => setZoomed(true)}
          className="group relative block w-full cursor-zoom-in"
          aria-label="הגדל תצוגה מקדימה"
        >
          <div
            style={
              {
                width: PAGE_WIDTH_PX,
                zoom: scale,
              } as CSSProperties
            }
          >
            <div className="receipt-view doc-paper shadow-md" dir={dir} lang={language} {...themeAttrs}>
              {body}
            </div>
          </div>
          <div
            className="absolute inset-0 rounded-2xl bg-stone-900/0 group-hover:bg-stone-900/15 transition-colors flex items-start justify-end p-3 pointer-events-none"
          >
            <span className="inline-flex items-center gap-1.5 bg-stone-900/80 text-white text-xs font-medium px-3 py-1.5 rounded-full opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity shadow-lg">
              <Maximize2 className="w-3.5 h-3.5" />
              לחץ לתצוגה מוגדלת
            </span>
          </div>
        </button>
      </div>

      {zoomed && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex flex-col">
            <div
              className="absolute inset-0 bg-stone-900/70 backdrop-blur-sm"
              onClick={() => setZoomed(false)}
              aria-hidden="true"
            />
            <div className="relative z-10 flex items-center justify-between px-4 py-3 bg-stone-900/80 backdrop-blur-sm">
              <span className="text-sm text-stone-100 font-medium">
                תצוגה מקדימה, לחץ מחוץ למסמך או על X כדי לסגור
              </span>
              <button
                type="button"
                onClick={() => setZoomed(false)}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                aria-label="סגור תצוגה מוגדלת"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div
              className="relative z-10 flex-1 overflow-auto py-6 px-4 cursor-zoom-out"
              onClick={() => setZoomed(false)}
            >
              {/* Same trick as the inline preview: lay the sheet out at its
                  real A4 width and let `zoom` scale it, so the document's
                  own layout never reflows and text stays crisp. */}
              <div className="flex justify-center">
                <div
                  style={
                    {
                      width: zoomedScale > 1 ? PAGE_WIDTH_PX : "100%",
                      zoom: zoomedScale,
                    } as CSSProperties
                  }
                >
                  {/* In reflow mode (phones) the sheet really is as wide as the
                      screen, so it gets `is-fluid` and the <=700px rules stack
                      the header (business name over number) instead of
                      squeezing both blocks into one row where they overlap. */}
                  <div
                    className={`receipt-view doc-paper shadow-2xl cursor-default${zoomedScale === 1 ? " is-fluid" : ""}`}
                    style={{ width: PAGE_WIDTH_PX, maxWidth: "100%", ...themeVars }}
                    dir={dir}
                    lang={language}
                    data-doc-template={design?.template ?? "general"}
                    data-doc-layout={design?.layout ?? "cards"}
                    data-doc-pattern={design?.pattern ?? "none"}
                    data-logo-pos={design?.logoPosition ?? "right"}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {body}
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
