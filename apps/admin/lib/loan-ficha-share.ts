import { jsPDF } from "jspdf";
import type { LoanReportDocument } from "@/lib/loan-report";
import { loanReportPdfFileName } from "@/lib/loan-report-pdf";

const PAGE_MARGIN_MM = 8;
const JPEG_QUALITY = 0.92;

/** Captura la ficha visible (como screenshot) en un solo PDF, aunque sea larga. */
export async function shareLoanFichaCapture(
  root: HTMLElement,
  report: LoanReportDocument,
) {
  if (typeof window === "undefined") return;

  root.classList.add("is-sharing");
  // Deja pintar el CSS que oculta Compartir/volver antes de capturar.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

  try {
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(root, {
      backgroundColor: "#ffffff",
      scale: Math.min(2, window.devicePixelRatio || 2),
      useCORS: true,
      logging: false,
      scrollX: 0,
      scrollY: 0,
    });

    const blob = await canvasToPdfBlob(canvas);
    const fileName = loanReportPdfFileName(report).replace(/^informe-/, "ficha-");
    const file = new File([blob], fileName, { type: "application/pdf" });
    const caption = `${report.clientName.trim()} · ${report.loanRef}`;

    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
    };

    if (typeof nav.share === "function") {
      const withFile: ShareData = { title: caption, text: caption, files: [file] };
      try {
        if (typeof nav.canShare !== "function" || nav.canShare(withFile)) {
          await nav.share(withFile);
          return;
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } finally {
    root.classList.remove("is-sharing");
  }
}

async function canvasToPdfBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const pageW = 210; // A4 mm
  const pageH = 297;
  const contentW = pageW - PAGE_MARGIN_MM * 2;
  const contentH = pageH - PAGE_MARGIN_MM * 2;
  const imgWmm = contentW;
  const imgHmm = (canvas.height * imgWmm) / canvas.width;

  // Una sola página alta si cabe en un documento razonable; si no, trocea en A4.
  const maxSingleHmm = pageH * 4;
  if (imgHmm <= contentH) {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    doc.addImage(
      canvas.toDataURL("image/jpeg", JPEG_QUALITY),
      "JPEG",
      PAGE_MARGIN_MM,
      PAGE_MARGIN_MM,
      imgWmm,
      imgHmm,
    );
    return doc.output("blob");
  }

  if (imgHmm <= maxSingleHmm) {
    const doc = new jsPDF({
      unit: "mm",
      format: [pageW, imgHmm + PAGE_MARGIN_MM * 2],
      orientation: "portrait",
    });
    doc.addImage(
      canvas.toDataURL("image/jpeg", JPEG_QUALITY),
      "JPEG",
      PAGE_MARGIN_MM,
      PAGE_MARGIN_MM,
      imgWmm,
      imgHmm,
    );
    return doc.output("blob");
  }

  // Lista muy larga → varias páginas A4, un solo archivo.
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pxPerMm = canvas.width / imgWmm;
  const sliceHmm = contentH;
  const slicePx = Math.floor(sliceHmm * pxPerMm);
  let srcY = 0;
  let page = 0;

  while (srcY < canvas.height) {
    const sliceH = Math.min(slicePx, canvas.height - srcY);
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceH;
    const ctx = sliceCanvas.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

    if (page > 0) doc.addPage();
    const sliceHmmActual = sliceH / pxPerMm;
    doc.addImage(
      sliceCanvas.toDataURL("image/jpeg", JPEG_QUALITY),
      "JPEG",
      PAGE_MARGIN_MM,
      PAGE_MARGIN_MM,
      imgWmm,
      sliceHmmActual,
    );
    srcY += sliceH;
    page += 1;
  }

  return doc.output("blob");
}
