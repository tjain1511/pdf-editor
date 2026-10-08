/**
 * Detects the visual style of existing page text so that replacements keep
 * the original look: font family class, weight and slant from the embedded
 * font's descriptor, and text / background colours by sampling the rendered
 * page around the text.
 */
import type { EditorPage, FontFamily, Rect } from '../editor/types';
import { pageSize, totalRotation } from '../editor/pageUtils';
import { getDisplayPage } from './displayPage';
import type { TextRun } from './textContent';

export interface DetectedFont {
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
  /** Original font name, for display. */
  name: string;
}

export interface DetectedColors {
  text: string;
  background: string;
}

interface PdfjsFontInfo {
  name?: string;
  bold?: boolean;
  italic?: boolean;
  black?: boolean;
  isSerifFont?: boolean;
  isMonospace?: boolean;
  fallbackName?: string;
  systemFontInfo?: { baseFontName?: string; css?: string } | null;
  cssFontInfo?: { fontFamily?: string } | null;
}

const fontCache = new Map<string, DetectedFont>();

export async function detectFont(page: EditorPage, run: TextRun): Promise<DetectedFont> {
  const fallback: DetectedFont = {
    fontFamily: run.mono ? 'Courier' : run.serif ? 'Times' : 'Helvetica',
    bold: run.bold,
    italic: run.italic,
    name: run.fontFamily,
  };
  if (!page.source) return fallback;
  const key = `${page.source.sourceId}:${page.source.pageIndex}:${page.removals.length}:${run.fontName}`;
  const cached = fontCache.get(key);
  if (cached) return cached;
  try {
    const pdfPage = await getDisplayPage(page);
    const objs = pdfPage.commonObjs as { has(name: string): boolean; get(name: string): unknown };
    if (!objs.has(run.fontName)) {
      // Fonts are registered while the operator list is built.
      await pdfPage.getOperatorList();
    }
    if (!objs.has(run.fontName)) return fallback;
    const info = objs.get(run.fontName) as PdfjsFontInfo;
    const name = info.name || info.systemFontInfo?.baseFontName || info.cssFontInfo?.fontFamily || run.fontFamily;
    const lower = name.toLowerCase();
    const mono = !!info.isMonospace || /mono|courier|consolas|menlo|monaco|typewriter/.test(lower);
    const serif =
      !mono &&
      (!!info.isSerifFont ||
        /times|georgia|garamond|cambria|book|roman|minion|palatino|baskerville|caslon|century|didot|bodoni|constantia|charter|merriweather|lora|serif/.test(lower)) &&
      !/sans/.test(lower);
    const bold = !!info.bold || !!info.black || /bold|black|heavy|semibold|demibold|extrabold|ultrabold/.test(lower);
    const italic = !!info.italic || /italic|oblique/.test(lower);
    const detected: DetectedFont = { fontFamily: mono ? 'Courier' : serif ? 'Times' : 'Helvetica', bold, italic, name };
    fontCache.set(key, detected);
    return detected;
  } catch {
    return fallback;
  }
}

/**
 * Sample the rendered page around `rect` (visual points) to estimate the
 * text colour and the solid background colour behind it.
 */
export async function detectColors(page: EditorPage, rect: Rect): Promise<DetectedColors | null> {
  if (!page.source) return null;
  try {
    const pdfPage = await getDisplayPage(page);
    const size = pageSize(page);
    const pad = Math.max(1, rect.height * 0.3);
    const x0 = Math.max(0, rect.x - pad);
    const y0 = Math.max(0, rect.y - pad);
    const x1 = Math.min(size.width, rect.x + rect.width + pad);
    const y1 = Math.min(size.height, rect.y + rect.height + pad);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return null;
    const k = Math.max(1, Math.min(4, 900 / w, 260 / h));
    const viewport = pdfPage.getViewport({ scale: k, rotation: totalRotation(page), offsetX: -x0 * k, offsetY: -y0 * k });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(w * k));
    canvas.height = Math.max(1, Math.ceil(h * k));
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: ctx, viewport, canvas } as Parameters<typeof pdfPage.render>[0]).promise;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;

    // Background: most common colour along the border of the sampled region.
    const border = new Map<number, number>();
    const ring = Math.max(1, Math.round(pad * k * 0.6));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x >= ring && x < width - ring && y >= ring && y < height - ring) continue;
        bump(border, data, (y * width + x) * 4);
      }
    }
    const bg = meanOfBin(data, width, height, modeKey(border), () => true);

    // Text: most common colour among pixels clearly different from the background.
    let maxDist = 0;
    for (let i = 0; i < data.length; i += 4) maxDist = Math.max(maxDist, dist(data, i, bg));
    if (maxDist < 48) {
      return { text: luminance(bg) > 0.5 ? '#000000' : '#ffffff', background: toHex(bg) };
    }
    const threshold = Math.max(48, maxDist * 0.6);
    const far = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) if (dist(data, i, bg) >= threshold) bump(far, data, i);
    const text = meanOfBin(data, width, height, modeKey(far), (i) => dist(data, i, bg) >= threshold);
    return { text: toHex(text), background: toHex(bg) };
  } catch {
    return null;
  }
}

type RGB = [number, number, number];

function quantKey(data: Uint8ClampedArray, i: number): number {
  return ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
}

function bump(map: Map<number, number>, data: Uint8ClampedArray, i: number): void {
  const key = quantKey(data, i);
  map.set(key, (map.get(key) ?? 0) + 1);
}

function modeKey(map: Map<number, number>): number {
  let best = -1;
  let bestCount = -1;
  for (const [key, count] of map) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/** Average colour of the pixels that fall into the quantisation bin `key`. */
function meanOfBin(data: Uint8ClampedArray, width: number, height: number, key: number, accept: (i: number) => boolean): RGB {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < width * height * 4; i += 4) {
    if (quantKey(data, i) === key && accept(i)) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [255, 255, 255];
}

function dist(data: Uint8ClampedArray, i: number, c: RGB): number {
  return Math.hypot(data[i] - c[0], data[i + 1] - c[1], data[i + 2] - c[2]);
}

function luminance([r, g, b]: RGB): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function toHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
