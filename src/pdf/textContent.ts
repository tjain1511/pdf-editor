/**
 * Text extraction. Produces positioned text runs in visual page coordinates
 * (points, scale 1) used for the selectable text layer, search and the
 * "edit existing text" feature.
 */
import { pdfjs } from './pdfjs';
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';
import { displayKey, getDisplayPage } from './displayPage';
import type { EditorPage, Rect } from '../editor/types';

export interface TextRun {
  str: string;
  /** Left of the run's box, visual points. */
  x: number;
  /** Top of the run's box, visual points. */
  y: number;
  width: number;
  /** Font height (box height). */
  height: number;
  /** Rotation in degrees (clockwise). */
  angle: number;
  /** CSS font family guess for display. */
  fontFamily: string;
  /** Ascent ratio used to place the baseline. */
  ascent: number;
  /** Whether a line break follows this run. */
  hasEOL: boolean;
  dir: string;
  /** pdf.js internal font identifier (key into page.commonObjs). */
  fontName: string;
  /** Glyph origin of the run in PDF user space. */
  userStart: [number, number];
  /** Unit baseline direction in PDF user space. */
  userDir: [number, number];
  /** Whether the pdf.js font is bold / italic / serif / mono (best effort). */
  bold: boolean;
  italic: boolean;
  serif: boolean;
  mono: boolean;
}

const contentCache = new Map<string, Promise<TextContent>>();

function getContent(page: EditorPage): Promise<TextContent> {
  const key = displayKey(page);
  let p = contentCache.get(key);
  if (!p) {
    p = getDisplayPage(page).then((pdfPage) => pdfPage.getTextContent({ includeMarkedContent: false }));
    contentCache.set(key, p);
  }
  return p;
}

const ascentCache = new Map<string, number>();
let measureCtx: CanvasRenderingContext2D | null = null;

function ascentRatio(fontFamily: string, style: { ascent?: number; descent?: number }): number {
  const cached = ascentCache.get(fontFamily);
  if (cached) return cached;
  let ratio = 0.8;
  try {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    if (measureCtx) {
      measureCtx.font = `30px ${fontFamily}`;
      const m = measureCtx.measureText('');
      const a = m.fontBoundingBoxAscent;
      const d = Math.abs(m.fontBoundingBoxDescent);
      if (a) ratio = a / (a + d);
      else if (style.ascent) ratio = style.ascent;
      else if (style.descent) ratio = 1 + style.descent;
    }
  } catch {
    /* ignore */
  }
  ascentCache.set(fontFamily, ratio);
  return ratio;
}

/** Positioned text runs for an editor page, in visual coordinates. */
export async function getPageTextRuns(page: EditorPage): Promise<TextRun[]> {
  if (!page.source) return [];
  const [content, pdfPage] = await Promise.all([getContent(page), getDisplayPage(page)]);
  const viewport = pdfPage.getViewport({ scale: 1, rotation: page.baseRotation + page.rotation });
  const runs: TextRun[] = [];
  for (const item of content.items as TextItem[]) {
    if (!('str' in item)) continue;
    if (item.str === '' && !item.hasEOL) continue;
    const style = content.styles[item.fontName] ?? { fontFamily: 'sans-serif', ascent: 0, descent: 0, vertical: false };
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    let angle = Math.atan2(tx[1], tx[0]);
    if (style.vertical) angle += Math.PI / 2;
    const fontHeight = Math.hypot(tx[2], tx[3]);
    const family = style.fontFamily || 'sans-serif';
    const ascent = ascentRatio(family, style);
    const fontAscent = fontHeight * ascent;
    let left: number, top: number;
    if (angle === 0) {
      left = tx[4];
      top = tx[5] - fontAscent;
    } else {
      left = tx[4] + fontAscent * Math.sin(angle);
      top = tx[5] - fontAscent * Math.cos(angle);
    }
    const name = item.fontName.toLowerCase();
    const fam = family.toLowerCase();
    const t = item.transform as number[];
    const dirLen = Math.hypot(t[0], t[1]) || 1;
    runs.push({
      userStart: [t[4], t[5]],
      userDir: [t[0] / dirLen, t[1] / dirLen],
      str: item.str,
      x: left,
      y: top,
      width: style.vertical ? item.height : item.width,
      height: fontHeight,
      angle: (angle * 180) / Math.PI,
      fontFamily: family,
      ascent,
      hasEOL: item.hasEOL,
      dir: item.dir,
      fontName: item.fontName,
      bold: /bold|black|heavy|semibold/.test(name) || /bold/.test(fam),
      italic: /italic|oblique/.test(name) || /italic|oblique/.test(fam),
      serif: /serif/.test(fam) && !/sans/.test(fam),
      mono: /mono/.test(fam),
    });
  }
  return runs;
}

/**
 * Indices of the runs forming the visual line that contains run `index`:
 * same font, same baseline, horizontally adjacent.
 */
export function lineGroup(runs: TextRun[], index: number): number[] {
  const base = runs[index];
  if (!base) return [];
  const sameLine = (a: TextRun, b: TextRun) =>
    a.fontName === b.fontName &&
    Math.abs(a.angle - b.angle) < 0.5 &&
    Math.abs(a.y + a.height - (b.y + b.height)) < Math.min(a.height, b.height) * 0.35;
  const gapOk = (left: TextRun, right: TextRun) => {
    const gap = right.x - (left.x + left.width);
    return gap > -left.height * 0.5 && gap < left.height * 1.2;
  };
  const group = [index];
  for (let i = index - 1; i >= 0; i--) {
    const r = runs[i];
    if (r.hasEOL && i !== index - 1) break;
    if (!r.str.trim()) continue;
    if (sameLine(r, base) && gapOk(r, runs[group[0]])) group.unshift(i);
    else break;
  }
  for (let i = index + 1; i < runs.length; i++) {
    const r = runs[i];
    if (runs[group[group.length - 1]].hasEOL) break;
    if (!r.str.trim()) continue;
    if (sameLine(r, base) && gapOk(runs[group[group.length - 1]], r)) group.push(i);
    else break;
  }
  return group;
}

/** Text of a group of runs on one line, inserting spaces across visible gaps. */
export function lineText(runs: TextRun[], group: number[]): string {
  let text = '';
  for (let k = 0; k < group.length; k++) {
    const run = runs[group[k]];
    if (k > 0) {
      const prev = runs[group[k - 1]];
      const gap = run.x - (prev.x + prev.width);
      if (gap > prev.height * 0.12 && !text.endsWith(' ') && !run.str.startsWith(' ')) text += ' ';
    }
    text += run.str;
  }
  return text.replace(/\s+$/, '');
}

/** Plain text of a page (used for search). */
export function runsToText(runs: TextRun[]): { text: string; offsets: number[] } {
  let text = '';
  const offsets: number[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    offsets.push(text.length);
    text += run.str;
    if (run.hasEOL) text += '\n';
    else if (i + 1 < runs.length) {
      // Insert a space when the next run starts noticeably further right.
      const next = runs[i + 1];
      const gap = next.x - (run.x + run.width);
      if (gap > run.height * 0.15 || Math.abs(next.y - run.y) > run.height * 0.5) text += ' ';
    }
  }
  return { text, offsets };
}

const charOffsetCache = new WeakMap<TextRun, number[]>();

/** Cumulative x offsets (points) of each character boundary in a run, fitted to the run width. */
function charOffsets(run: TextRun): number[] {
  let offsets = charOffsetCache.get(run);
  if (offsets) return offsets;
  const n = run.str.length;
  offsets = new Array(n + 1);
  try {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    if (!measureCtx) throw new Error('no canvas');
    measureCtx.font = `${run.height}px ${run.fontFamily}`;
    const total = measureCtx.measureText(run.str).width || 1;
    const k = run.width / total;
    for (let i = 0; i <= n; i++) offsets[i] = measureCtx.measureText(run.str.slice(0, i)).width * k;
  } catch {
    for (let i = 0; i <= n; i++) offsets[i] = (run.width * i) / Math.max(1, n);
  }
  charOffsetCache.set(run, offsets);
  return offsets;
}

/** Compute highlight rects for a [start, end) character range in the page text. */
export function rectsForRange(runs: TextRun[], offsets: number[], start: number, end: number): Rect[] {
  const rects: Rect[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const runStart = offsets[i];
    const runEnd = runStart + run.str.length;
    if (runEnd <= start || runStart >= end || run.str.length === 0) continue;
    const from = Math.max(start, runStart) - runStart;
    const to = Math.min(end, runEnd) - runStart;
    const xs = charOffsets(run);
    const rect = { x: run.x + xs[from], y: run.y, width: xs[to] - xs[from], height: run.height };
    const last = rects[rects.length - 1];
    if (last && Math.abs(last.y - rect.y) < 1 && Math.abs(last.x + last.width - rect.x) < run.height) {
      last.width = rect.x + rect.width - last.x;
      last.height = Math.max(last.height, rect.height);
    } else rects.push(rect);
  }
  return rects;
}

export function clearTextCache(): void {
  contentCache.clear();
}
