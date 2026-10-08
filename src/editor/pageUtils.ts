import { createPageGeometry, normalizeRotation } from '../pdf/geometry';
import type { EditorElement, EditorPage, Rect } from './types';
import { TEXT_PADDING, layoutText } from '../pdf/fonts';

export function totalRotation(page: EditorPage): number {
  return normalizeRotation(page.baseRotation + page.rotation);
}

/** Visual page size in points (after rotation). */
export function pageSize(page: EditorPage): { width: number; height: number } {
  const g = createPageGeometry(page.view, totalRotation(page));
  return { width: g.width, height: g.height };
}

export function findElement(
  pages: EditorPage[],
  id: string,
): { pageIndex: number; element: EditorElement; elementIndex: number } | null {
  for (let p = 0; p < pages.length; p++) {
    const idx = pages[p].elements.findIndex((e) => e.id === id);
    if (idx >= 0) return { pageIndex: p, element: pages[p].elements[idx], elementIndex: idx };
  }
  return null;
}

export function pageIndexOfElement(pages: EditorPage[], id: string): number {
  return pages.findIndex((p) => p.elements.some((e) => e.id === id));
}

/** Return a copy of `pages` with page `pageIndex` replaced by `fn(page)`. */
export function mapPage(pages: EditorPage[], pageIndex: number, fn: (page: EditorPage) => EditorPage): EditorPage[] {
  const next = pages.slice();
  next[pageIndex] = fn(pages[pageIndex]);
  return next;
}

/** Keep derived properties consistent (e.g. text box height follows content). */
export function normalizeElement(el: EditorElement): EditorElement {
  if (el.type === 'text') {
    const layout = layoutText(el);
    const width = el.autoWidth ? Math.max(10, Math.max(0, ...layout.lineWidths) + TEXT_PADDING * 2 + el.fontSize * 0.1) : el.width;
    if (Math.abs(layout.height - el.height) > 0.01 || Math.abs(width - el.width) > 0.01) return { ...el, height: layout.height, width };
  }
  return el;
}

/** Keep an element within the page (or at least overlapping it when larger than the page). */
export function clampToPage(el: EditorElement, size: { width: number; height: number }): EditorElement {
  const maxX = Math.max(0, size.width - el.width);
  const maxY = Math.max(0, size.height - el.height);
  const x = el.width > size.width ? Math.min(0, Math.max(size.width - el.width, el.x)) : Math.min(maxX, Math.max(0, el.x));
  const y = el.height > size.height ? Math.min(0, Math.max(size.height - el.height, el.y)) : Math.min(maxY, Math.max(0, el.y));
  if (x === el.x && y === el.y) return el;
  const dx = x - el.x;
  const dy = y - el.y;
  const moved = { ...el, x, y } as EditorElement;
  if (moved.type === 'markup') moved.rects = moved.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
  return moved;
}

export function elementBounds(el: EditorElement): Rect {
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

export function referencedSourceIds(pages: EditorPage[]): Set<string> {
  const set = new Set<string>();
  for (const p of pages) if (p.source) set.add(p.source.sourceId);
  return set;
}

export function referencedAssetIds(pages: EditorPage[][]): Set<string> {
  const set = new Set<string>();
  for (const snapshot of pages)
    for (const p of snapshot) for (const e of p.elements) if (e.type === 'image') set.add(e.assetId);
  return set;
}
