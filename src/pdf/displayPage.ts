/**
 * Provides the pdf.js page used for display, text extraction and flattening.
 * Pages without text removals are the original source pages. Pages with
 * removals are rebuilt on demand as a single-page PDF with the removals
 * applied, so the screen shows exactly what will be exported.
 */
import { PDFDocument } from 'pdf-lib';
import type { EditorPage } from '../editor/types';
import { loadPdfDocument, type PDFPageProxy } from './pdfjs';
import { getSource, getSourcePage, registerCleanup } from './sources';
import { analyzeShowOps, applyRemovals } from './textOps';
import { clearEmbeddedFonts } from './embeddedFonts';

const libDocs = new Map<string, Promise<PDFDocument>>();
const patched = new Map<string, { page: Promise<PDFPageProxy>; destroy: () => void }>();
const MAX_PATCHED = 24;

/** Cache key identifying the displayed content of a page. */
export function displayKey(page: EditorPage): string {
  if (!page.source) return 'blank';
  const r = page.removals.length ? `:${page.removals.map((x) => x.id).join(',')}` : '';
  return `${page.source.sourceId}:${page.source.pageIndex}${r}`;
}

/** pdf-lib document for a source (cached). */
export function getLibDocument(sourceId: string): Promise<PDFDocument> {
  let p = libDocs.get(sourceId);
  if (!p) {
    const source = getSource(sourceId);
    if (!source) return Promise.reject(new Error('Unknown PDF source'));
    p = PDFDocument.load(source.bytes, { updateMetadata: false, throwOnInvalidObject: false });
    libDocs.set(sourceId, p);
  }
  return p;
}

/** Whether text can be removed from this page's content (source must be rewritable). */
export function canRemoveText(page: EditorPage): boolean {
  if (!page.source) return false;
  const source = getSource(page.source.sourceId);
  return !!source && !source.flattenOnly;
}

export function getDisplayPage(page: EditorPage): Promise<PDFPageProxy> {
  if (!page.source) return Promise.reject(new Error('Blank page has no PDF content'));
  if (!page.removals.length) return getSourcePage(page.source.sourceId, page.source.pageIndex);
  const key = displayKey(page);
  const cached = patched.get(key);
  if (cached) return cached.page;
  let destroyFn: () => void = () => undefined;
  const promise = (async () => {
    const { sourceId, pageIndex } = page.source!;
    const [lib, sourcePage] = await Promise.all([getLibDocument(sourceId), getSourcePage(sourceId, pageIndex)]);
    const { ops } = await analyzeShowOps(sourcePage);
    const out = await PDFDocument.create();
    const [copy] = await out.copyPages(lib, [pageIndex]);
    out.addPage(copy);
    if (!applyRemovals(copy, page.removals, ops.length)) throw new Error('Could not rewrite page content');
    const bytes = await out.save({ useObjectStreams: false });
    const loaded = await loadPdfDocument(bytes);
    destroyFn = () => void loaded.destroy().catch(() => undefined);
    return loaded.pdf.getPage(1);
  })();
  patched.set(key, { page: promise, destroy: () => destroyFn() });
  promise.catch(() => patched.delete(key));
  // Bound the cache.
  if (patched.size > MAX_PATCHED) {
    const oldest = patched.keys().next().value;
    if (oldest !== undefined && oldest !== key) {
      patched.get(oldest)?.destroy();
      patched.delete(oldest);
    }
  }
  return promise;
}

/** Number of page-level text-showing operators the source page has (for validation on export). */
export async function expectedShowOps(page: EditorPage): Promise<number | undefined> {
  if (!page.source) return undefined;
  const sourcePage = await getSourcePage(page.source.sourceId, page.source.pageIndex);
  return (await analyzeShowOps(sourcePage)).ops.length;
}

registerCleanup(() => {
  clearEmbeddedFonts();
  libDocs.clear();
  for (const entry of patched.values()) entry.destroy();
  patched.clear();
});
