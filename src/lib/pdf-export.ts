/**
 * Captures a DOM element as a PDF and triggers a download.
 *
 * Uses html2canvas-pro (the maintained fork) — the original html2canvas
 * has been unmaintained since 2022 and silently fails on modern CSS
 * (oklch, gradients, custom properties, lab/lch). The pro fork is a
 * drop-in API replacement that handles all of those.
 *
 * Heavy libs are dynamically imported only when this function runs,
 * so the initial page bundle stays small.
 */
export async function downloadElementAsPdf(element: HTMLElement, filename: string) {
  let html2canvas: typeof import("html2canvas-pro").default;
  let jsPDF: typeof import("jspdf").jsPDF;
  try {
    const [h2c, jp] = await Promise.all([
      import("html2canvas-pro"),
      import("jspdf"),
    ]);
    html2canvas = h2c.default;
    jsPDF = jp.jsPDF;
  } catch (err) {
    console.error("[pdf-export] failed to load libs", err);
    throw new Error("טעינת הרכיבים ל-PDF נכשלה. רענן את העמוד ונסה שוב.");
  }

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
    });
  } catch (err) {
    console.error("[pdf-export] html2canvas threw", err);
    throw new Error(
      err instanceof Error ? `המרת המסמך לתמונה נכשלה: ${err.message}` : "המרת המסמך לתמונה נכשלה",
    );
  }

  let imgData: string;
  try {
    imgData = canvas.toDataURL("image/png");
  } catch (err) {
    console.error("[pdf-export] canvas tainted (CORS?)", err);
    throw new Error("נכשל בקריאת התמונה — ייתכן שיש תמונה חיצונית עם הרשאות חסרות (CORS)");
  }

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * pageWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position -= pageHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
