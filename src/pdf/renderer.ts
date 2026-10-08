/**
 * Page rasterisation helpers shared by the viewer, thumbnails and the
 * flattened export fallback.
 */
import type { PDFPageProxy, PageViewport } from './pdfjs';
import type { RenderTask } from 'pdfjs-dist';
import { getDisplayPage } from './displayPage';
import type { EditorPage } from '../editor/types';
import { totalRotation } from '../editor/pageUtils';

/** Upper bound on backing-store pixels for a single canvas. */
const MAX_CANVAS_PIXELS = 16_000_000;

export function effectivePixelRatio(viewport: PageViewport, requested: number): number {
  const pixels = viewport.width * viewport.height * requested * requested;
  if (pixels <= MAX_CANVAS_PIXELS) return requested;
  return Math.max(0.5, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
}

/** Render a page into `canvas`, sizing it for the given pixel ratio. */
export function renderToCanvas(
  pdfPage: PDFPageProxy,
  canvas: HTMLCanvasElement,
  viewport: PageViewport,
  pixelRatio: number,
): RenderTask {
  const ratio = effectivePixelRatio(viewport, pixelRatio);
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return pdfPage.render({
    canvasContext: ctx,
    viewport,
    transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
    canvas,
  } as Parameters<PDFPageProxy['render']>[0]);
}

/** Rasterise a page (visual orientation) to PNG bytes for flattened export. */
export async function renderPageToPng(page: EditorPage, maxDimension = 2600): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  if (!page.source) throw new Error('Blank pages do not need rasterising');
  const pdfPage = await getDisplayPage(page);
  const base = pdfPage.getViewport({ scale: 1, rotation: totalRotation(page) });
  const scale = Math.min(3, maxDimension / Math.max(base.width, base.height));
  const viewport = pdfPage.getViewport({ scale, rotation: totalRotation(page) });
  const canvas = document.createElement('canvas');
  await renderToCanvas(pdfPage, canvas, viewport, 1).promise;
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not rasterise page'))), 'image/png'),
  );
  canvas.width = 0;
  canvas.height = 0;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: base.width, height: base.height };
}
