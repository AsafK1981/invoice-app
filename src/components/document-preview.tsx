"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

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
  /** מספר הקצאה — mirrors the live allocation-banner value onto the preview. */
  allocationNumber?: string;
}

const PAGE_WIDTH_PX = 794;

export function DocumentPreview(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [naturalHeight, setNaturalHeight] = useState<number>(1100);
  const [zoomed, setZoomed] = useState(false);

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

  useIsoLayoutEffect(() => {
    if (!pageRef.current) return;
    const el = pageRef.current;
    const update = () => {
      const h = el.offsetHeight;
      if (h > 0) {
        setNaturalHeight((prev) => (Math.abs(prev - h) < 1 ? prev : h));
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [zoomed]);

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
            style={{
              height: naturalHeight * scale,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: PAGE_WIDTH_PX,
                transform: `scale(${scale})`,
                transformOrigin: "top right",
              }}
            >
              <div ref={pageRef}>
                <div className="receipt-view doc-paper shadow-md" dir="rtl">
                  {body}
                </div>
              </div>
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
                תצוגה מקדימה — לחץ מחוץ למסמך או על X כדי לסגור
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
            <div className="relative z-10 flex-1 overflow-auto py-6 px-4">
              <div
                className="receipt-view doc-paper shadow-2xl mx-auto"
                style={{ width: PAGE_WIDTH_PX, maxWidth: "100%" }}
                dir="rtl"
                onClick={(e) => e.stopPropagation()}
              >
                {body}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
