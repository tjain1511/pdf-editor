/**
 * Registry of loaded source PDFs. Kept outside React state because it holds
 * large binary data and worker-backed proxies that should never be cloned or
 * put into the undo history.
 */
import type { PDFDocumentProxy, PDFPageProxy } from './pdfjs';

export interface PdfSource {
  id: string;
  name: string;
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
  destroy: () => Promise<void>;
  /** True if pdf-lib cannot rewrite this file (encrypted/unparseable). */
  flattenOnly: boolean;
}

const sources = new Map<string, PdfSource>();
const pageCache = new Map<string, Promise<PDFPageProxy>>();
const cleanups: (() => void)[] = [];

/** Register a callback run whenever all sources are cleared. */
export function registerCleanup(fn: () => void): void {
  cleanups.push(fn);
}

export function registerSource(source: PdfSource): void {
  sources.set(source.id, source);
}

export function getSource(id: string): PdfSource | undefined {
  return sources.get(id);
}

export function getSourcePage(sourceId: string, pageIndex: number): Promise<PDFPageProxy> {
  const key = `${sourceId}:${pageIndex}`;
  let p = pageCache.get(key);
  if (!p) {
    const source = sources.get(sourceId);
    if (!source) return Promise.reject(new Error('Unknown PDF source'));
    p = source.pdf.getPage(pageIndex + 1);
    pageCache.set(key, p);
  }
  return p;
}

export function allSources(): PdfSource[] {
  return [...sources.values()];
}

/** Destroy every loaded source and free worker memory. */
export async function clearSources(): Promise<void> {
  const list = [...sources.values()];
  sources.clear();
  pageCache.clear();
  for (const fn of cleanups) fn();
  await Promise.all(list.map((s) => s.destroy().catch(() => undefined)));
}

/** Drop sources no longer referenced by any page. */
export function pruneSources(referenced: Set<string>): void {
  for (const [id, source] of sources) {
    if (!referenced.has(id)) {
      sources.delete(id);
      for (const key of pageCache.keys()) if (key.startsWith(`${id}:`)) pageCache.delete(key);
      source.destroy().catch(() => undefined);
    }
  }
}
