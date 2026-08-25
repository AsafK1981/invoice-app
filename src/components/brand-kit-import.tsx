"use client";

import { useRef, useState } from "react";
import { Sparkles, Upload, Loader2, CheckCircle2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Business } from "@/lib/types";
import type { BrandKit } from "@/lib/brand-kit";

/**
 * "ייבוא ברנדבוק" - drop a brand book (PDF) and/or logo files, get the
 * brand colours, font and logo applied to the design draft in one go
 * (Asaf, 2026-08-25). The parent owns the draft: onApply receives the kit
 * plus the uploaded logo URL and returns the Hebrew summary lines to show.
 *
 * Logo handling is deliberately client-side and file-based: the model can
 * read a PDF but cannot hand back an image, so an image file dropped here
 * becomes the logo (uploaded to the same bucket the business form uses),
 * while a PDF-only import tells the user to add the logo as an image.
 */

const ANALYZABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"]);
const MAX_EDGE = 1600;
// Keep the JSON body under Vercel's ~4.5MB limit (base64 inflates by 4/3).
const MAX_TOTAL_BYTES = 3_000_000;

type Phase = "idle" | "working" | "done" | "error";

export function BrandKitImport({
  business,
  onApply,
}: {
  business: Business;
  onApply: (kit: BrandKit, logoUrl: string | undefined) => string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<{ kit: BrandKit; logoUrl?: string; summary: string[] } | null>(null);

  async function handleFiles(list: FileList | File[]) {
    const files = Array.from(list);
    if (files.length === 0) return;
    setError(null);
    setResult(null);

    const logoFile =
      files.find((f) => LOGO_TYPES.has(f.type) && /logo|לוגו/i.test(f.name)) ??
      files.find((f) => LOGO_TYPES.has(f.type));
    const analyzable = files.filter((f) => ANALYZABLE.has(f.type)).slice(0, 3);
    if (analyzable.length === 0 && !logoFile) {
      setError("לא זוהה קובץ מתאים. העלה את קובץ המיתוג (PDF) ו/או לוגו (PNG, JPG, WebP, SVG).");
      return;
    }

    setPhase("working");
    try {
      let logoUrl: string | undefined;
      if (logoFile) {
        setStep("מעלה את הלוגו...");
        logoUrl = await uploadLogo(business.id, logoFile);
      }

      let kit: BrandKit | null = null;
      if (analyzable.length > 0) {
        setStep("קורא את קובץ המיתוג...");
        const payload: { data: string }[] = [];
        let total = 0;
        for (const f of analyzable) {
          const data = await prepareFile(f);
          total += Math.ceil((data.length * 3) / 4);
          if (total > MAX_TOTAL_BYTES) {
            throw new Error("הקבצים גדולים מדי (עד 3MB יחד). ייצא מקובץ המיתוג רק את העמודים של הצבעים והגופנים, או צלם אותם.");
          }
          payload.push({ data });
        }
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("ההתחברות שלך פגה. רענן את הדף ונסה שוב.");
        const res = await fetch("/api/design/brand-import", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ files: payload }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) throw new Error(json?.error || "ייבוא קובץ המיתוג נכשל. נסה שוב.");
        kit = json.kit as BrandKit;
      }

      setStep("מחיל על התצוגה המקדימה...");
      const effectiveKit: BrandKit = kit ?? {
        colors: [],
        fonts: [],
        style: "unknown",
        hasLogo: !!logoUrl,
        logoDescription: null,
        businessName: null,
        notes: null,
      };
      const summary = onApply(effectiveKit, logoUrl);
      const lines = [...summary];
      if (logoUrl) lines.push("לוגו: הועלה והוצב על המסמך");
      else if (effectiveKit.hasLogo) lines.push("לוגו: יש לוגו בקובץ המיתוג, אבל אי אפשר לחלץ אותו מ-PDF. גרור לכאן את קובץ הלוגו (PNG/SVG) והוא יתווסף.");
      setResult({ kit: effectiveKit, logoUrl, summary: lines });
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ייבוא קובץ המיתוג נכשל.");
      setPhase("error");
    } finally {
      setStep("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy = phase === "working";

  return (
    <div className="rounded-2xl border border-orange-100 bg-orange-50/40 p-4">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-orange-500" />
        <h3 className="text-sm font-semibold text-stone-900">ייבוא קובץ מיתוג</h3>
      </div>
      <p className="text-xs text-stone-600 mb-3 leading-relaxed">
        קיבלת מהמעצב קובץ מיתוג (PDF עם הלוגו, הצבעים והגופנים)? העלה אותו יחד עם הלוגו ונחיל הכל
        על המסמך בבת אחת. אפשר גם רק לוגו: ניקח ממנו את הצבע.
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!busy) void handleFiles(e.dataTransfer.files);
        }}
        className={`w-full rounded-xl border-2 border-dashed px-4 py-5 text-sm transition-colors flex flex-col items-center gap-1.5 ${
          dragOver ? "border-orange-400 bg-orange-100/60" : "border-orange-200 bg-white hover:border-orange-300"
        } disabled:opacity-70`}
      >
        {busy ? (
          <>
            <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />
            <span className="text-stone-700">{step || "עובד..."}</span>
          </>
        ) : (
          <>
            <Upload className="w-5 h-5 text-orange-500" />
            <span className="font-medium text-stone-800">גרור לכאן את קובץ המיתוג והלוגו, או לחץ לבחירה</span>
            <span className="text-[11px] text-stone-500">PDF, PNG, JPG, WebP, SVG · עד 3 קבצים · עד 3MB יחד</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,application/pdf,image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={(e) => e.target.files && void handleFiles(e.target.files)}
      />

      {error && (
        <div className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-xl">{error}</div>
      )}

      {result && phase === "done" && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-emerald-800">
              <CheckCircle2 className="w-4 h-4" />
              הוחל על התצוגה המקדימה. לחץ &quot;שמור עיצוב&quot; כדי לשמור.
            </div>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setPhase("idle");
              }}
              className="text-stone-400 hover:text-stone-600"
              aria-label="סגור"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {result.kit.colors.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {result.kit.colors.map((c) => (
                <span key={c.hex} className="inline-flex items-center gap-1.5 text-[11px] text-stone-700" title={c.role}>
                  <span className="w-5 h-5 rounded-full border border-stone-200" style={{ background: c.hex }} />
                  <span dir="ltr">{c.hex}</span>
                </span>
              ))}
              {result.logoUrl && (
                <img src={result.logoUrl} alt="לוגו" className="h-8 max-w-[96px] object-contain rounded-md bg-white border border-stone-200 p-0.5" />
              )}
            </div>
          )}

          <ul className="mt-2 space-y-1 text-stone-700">
            {result.summary.map((line, i) => (
              <li key={i}>· {line}</li>
            ))}
            {result.kit.notes && <li>· {result.kit.notes}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

async function uploadLogo(businessId: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const fileName = `${businessId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("business-logos").upload(fileName, file, { upsert: true });
  if (error) throw new Error(`שגיאה בהעלאת הלוגו: ${error.message}`);
  return supabase.storage.from("business-logos").getPublicUrl(fileName).data.publicUrl;
}

/** PDFs pass through; images are downsized to a JPEG the model reads well. */
async function prepareFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) return fileToDataUrl(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    return fileToDataUrl(file);
  }
  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return fileToDataUrl(file);
    // White backing: a transparent logo on black would read as a dark brand.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  } finally {
    bitmap.close();
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}
