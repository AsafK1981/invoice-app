import { notFound } from "next/navigation";
import { DocumentBody } from "@/components/document-body";
import {
  DOCUMENT_TEMPLATES,
  designToCssVars,
  normalizeDocumentDesign,
  LAYOUT_KEYS,
  type LayoutKey,
} from "@/lib/document-themes";
import type { Business, DocumentItem } from "@/lib/types";

/**
 * DEV-ONLY design gallery: every profession template rendered on the real
 * paper (`.doc-paper` + DocumentBody) at print width, side by side, so a
 * layout/CSS change can be eyeballed across all templates in one page and
 * screenshotted by QA tooling. 404s in production - it exists for the
 * design loop, not for users. Query: ?t=<templateId> renders one template
 * only; ?layout=<LayoutKey> forces that structure on every template.
 */

const BIZ: Business = {
  id: "gallery",
  name: "אסף קוטלר",
  businessType: "exempt",
  taxId: "049040686",
  address: "התלת\"ן 12, עודים",
  phone: "054-900-0684",
  email: "asafkotlar@gmail.com",
  bankName: "בנק הפועלים",
  bankBranch: "612",
  bankAccount: "123456",
};

const ITEMS: DocumentItem[] = [
  { id: "g1", description: "הופעה חיה - אירוע חברה", quantity: 1, unitPrice: 4200, total: 4200 },
  { id: "g2", description: "חזרה + הגברה", quantity: 2, unitPrice: 350, total: 700 },
  { id: "g3", description: "נסיעות", quantity: 1, unitPrice: 180, total: 180 },
];
const SUBTOTAL = 5080;

export const dynamic = "force-dynamic";

export default async function DesignGalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; layout?: string; fluid?: string; font?: string; accent?: string; pattern?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const sp = await searchParams;
  const only = sp.t;
  const forcedLayout = LAYOUT_KEYS.includes(sp.layout as LayoutKey)
    ? (sp.layout as LayoutKey)
    : undefined;

  const templates = DOCUMENT_TEMPLATES.filter((t) => !only || t.id === only);
  // ?fluid=1 renders the sheet the way the public /view page does on a
  // phone (.is-fluid, full viewport width) so the <=700px rules can be QA'd.
  const fluid = sp.fluid === "1";
  const sheetWidth = fluid ? "100%" : 794;

  return (
    <div
      dir="rtl"
      style={{
        background: "#d9d4c7",
        padding: 24,
        display: "grid",
        gridTemplateColumns: fluid ? "1fr" : only ? "794px" : "repeat(auto-fill, 794px)",
        gap: 32,
        justifyContent: "center",
      }}
    >
      {templates.map((tpl) => {
        // font/accent are passed raw on purpose: normalizeDocumentDesign is
        // the boundary and falls back to the template default for junk.
        const design = normalizeDocumentDesign({
          template: tpl.id,
          layout: forcedLayout,
          font: sp.font,
          accent: sp.accent,
          pattern: sp.pattern,
        });
        const vars = designToCssVars(design);
        return (
          <div key={tpl.id} data-gallery-template={tpl.id} style={{ width: sheetWidth }}>
            <div
              style={{
                fontFamily: "system-ui, sans-serif",
                fontSize: 13,
                fontWeight: 600,
                color: "#3a3428",
                margin: "0 0 8px",
              }}
            >
              {tpl.label} · {tpl.id} · {design?.layout} · {design?.font} · {design?.accent}
            </div>
            <div
              className={`receipt-view doc-paper${fluid ? " is-fluid" : ""}`}
              style={{ width: sheetWidth, ...vars }}
              data-doc-template={design?.template ?? "general"}
              data-doc-layout={design?.layout ?? "cards"}
              data-doc-pattern={design?.pattern ?? "none"}
              data-logo-pos="right"
            >
              <DocumentBody
                business={BIZ}
                client={{
                  name: "דנה כהן בע״מ",
                  taxId: "514236987",
                  address: "רח' ויצמן 22, רמת גן",
                }}
                documentType="tax_invoice_receipt"
                number={118}
                date="2026-08-18"
                subject="הופעה - אירוע חברה, יולי 2026"
                items={ITEMS}
                subtotal={SUBTOTAL}
                vat={0}
                vatRate={0}
                total={SUBTOTAL}
                paymentMethod="bank_transfer"
                notes="תודה על ההזמנה. נתראה בהופעה הבאה."
                allocationNumber="187025961"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
