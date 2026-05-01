"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type Business,
  type DocumentItem,
  type DocumentType,
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
  paymentMethod?: PaymentMethod;
  notes?: string;
}

const PAGE_WIDTH_PX = 794;

export function DocumentPreview(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [naturalHeight, setNaturalHeight] = useState<number>(1100);

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

  return (
    <div ref={wrapRef} className="w-full">
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
            <div className="bg-white rounded-2xl shadow-md p-10" dir="rtl">
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
                paymentMethod={props.paymentMethod}
                notes={props.notes}
                placeholders
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
