/**
 * Font handling for editor text. Only the 14 standard PDF fonts are used so
 * that no font files need to be shipped or embedded. Text is measured with
 * pdf-lib's font metrics so that on-screen line breaks match the export.
 */
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import type { FontFamily, TextElement } from '../editor/types';
import { getEmbeddedFont, measureEmbedded, segmentText } from './embeddedFonts';

export const FONT_FAMILIES: FontFamily[] = ['Helvetica', 'Times', 'Courier'];

export const CSS_FONT_STACK: Record<FontFamily, string> = {
  Helvetica: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  Times: '"Times New Roman", Times, "Liberation Serif", serif',
  Courier: '"Courier New", Courier, "Liberation Mono", monospace',
};

/**
 * Baseline offset from the vertical centre of a line box, as a fraction of the
 * font size. Derived from the hhea metrics of the common fallback fonts so the
 * exported baseline matches what the browser draws.
 */
const BASELINE_SHIFT: Record<FontFamily, number> = {
  Helvetica: 0.3465,
  Times: 0.3375,
  Courier: 0.2665,
};

export const TEXT_PADDING = 2;

const STANDARD: Record<FontFamily, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  // regular, bold, italic, bold italic
  Helvetica: [
    StandardFonts.Helvetica,
    StandardFonts.HelveticaBold,
    StandardFonts.HelveticaOblique,
    StandardFonts.HelveticaBoldOblique,
  ],
  Times: [
    StandardFonts.TimesRoman,
    StandardFonts.TimesRomanBold,
    StandardFonts.TimesRomanItalic,
    StandardFonts.TimesRomanBoldItalic,
  ],
  Courier: [
    StandardFonts.Courier,
    StandardFonts.CourierBold,
    StandardFonts.CourierOblique,
    StandardFonts.CourierBoldOblique,
  ],
};

export function standardFontFor(family: FontFamily, bold: boolean, italic: boolean): StandardFonts {
  return STANDARD[family][(bold ? 1 : 0) + (italic ? 2 : 0)];
}

const measureFonts = new Map<StandardFonts, PDFFont>();
const charSets = new Map<StandardFonts, Set<number>>();
let ready: Promise<void> | null = null;

/** Load the measurement fonts. Cheap: standard fonts carry only metrics. */
export function initFonts(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const doc = await PDFDocument.create();
      for (const family of FONT_FAMILIES) {
        for (const std of STANDARD[family]) {
          const font = await doc.embedFont(std);
          measureFonts.set(std, font);
          charSets.set(std, new Set(font.getCharacterSet()));
        }
      }
    })();
  }
  return ready;
}

function fontFor(el: Pick<TextElement, 'fontFamily' | 'bold' | 'italic'>): PDFFont {
  const font = measureFonts.get(standardFontFor(el.fontFamily, el.bold, el.italic));
  if (!font) throw new Error('Fonts not initialised');
  return font;
}

/**
 * Replace characters the standard font cannot encode. Returns the cleaned text
 * and whether anything had to be replaced.
 */
export function sanitizeText(text: string, std: StandardFonts): { text: string; changed: boolean } {
  const set = charSets.get(std);
  if (!set) return { text, changed: false };
  let changed = false;
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\n' || ch === '\t' || set.has(cp)) {
      out += ch === '\t' ? '    ' : ch;
    } else {
      changed = true;
      // Normalise common typographic characters that have WinAnsi equivalents.
      const alt = FALLBACKS[ch];
      if (alt !== undefined) out += alt;
      else if (/\s/.test(ch)) out += ' ';
      else {
        const decomposed = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
        out += decomposed && set.has(decomposed.codePointAt(0)!) ? decomposed : '?';
      }
    }
  }
  return { text: out, changed };
}

const FALLBACKS: Record<string, string> = {
  ' ': '\n',
  ' ': ' ',
  '‑': '-',
  '−': '-',
  '′': "'",
  '″': '"',
};

function sanitizeMixed(text: string, info: NonNullable<ReturnType<typeof getEmbeddedFont>>, std: StandardFonts): { text: string; changed: boolean } {
  let out = '';
  let changed = false;
  for (const seg of segmentText(text, info)) {
    if (seg.embedded) out += seg.text;
    else {
      const r = sanitizeText(seg.text, std);
      out += r.text;
      changed = changed || r.changed;
    }
  }
  return { text: out, changed };
}

export interface TextLayout {
  lines: string[];
  lineHeight: number;
  /** Total box height including padding. */
  height: number;
  /** Width of each line in points. */
  lineWidths: number[];
  /** True when characters had to be substituted. */
  substituted: boolean;
  text: string;
}

export function measureText(text: string, el: Pick<TextElement, 'fontFamily' | 'bold' | 'italic' | 'fontSize'> & { embeddedFont?: string | null }): number {
  const info = getEmbeddedFont(el.embeddedFont);
  if (!info) return fontFor(el).widthOfTextAtSize(text, el.fontSize);
  // Characters missing from the document font are measured with the fallback font.
  let w = 0;
  for (const seg of segmentText(text, info)) {
    w += seg.embedded ? measureEmbedded(seg.text, info, el.fontSize) : fontFor(el).widthOfTextAtSize(sanitizeText(seg.text, standardFontFor(el.fontFamily, el.bold, el.italic)).text, el.fontSize);
  }
  return w;
}

/** Baseline y (relative to the top of the box) for line `i`. */
export function baselineFor(el: Pick<TextElement, 'fontFamily' | 'fontSize' | 'lineHeight'>, i: number): number {
  const lh = el.fontSize * el.lineHeight;
  return TEXT_PADDING + lh * (i + 0.5) + BASELINE_SHIFT[el.fontFamily] * el.fontSize;
}

/** Wrap text into lines that fit the element width using PDF font metrics. */
export function layoutText(el: TextElement): TextLayout {
  const std = standardFontFor(el.fontFamily, el.bold, el.italic);
  const embedded = getEmbeddedFont(el.embeddedFont);
  // With a document font, only characters it lacks go through the standard-font sanitiser.
  const { text, changed } = embedded ? sanitizeMixed(el.text, embedded, std) : sanitizeText(el.text, std);
  const font = measureFonts.get(std);
  const hScale = el.hScale > 0 ? el.hScale : 1;
  const maxWidth = el.autoWidth ? Infinity : Math.max(1, el.width - TEXT_PADDING * 2);
  const lines: string[] = [];
  // Widths are reported in page units, i.e. after horizontal scaling.
  const width = (s: string) =>
    (embedded ? measureText(s, el) : font ? font.widthOfTextAtSize(s, el.fontSize) : s.length * el.fontSize * 0.5) * hScale;

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (width(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // Word itself may be too long: break by characters.
      if (width(word) <= maxWidth) {
        line = word;
      } else {
        let chunk = '';
        for (const ch of word) {
          if (width(chunk + ch) <= maxWidth || chunk === '') chunk += ch;
          else {
            lines.push(chunk);
            chunk = ch;
          }
        }
        line = chunk;
      }
    }
    lines.push(line);
  }

  const lineHeight = el.fontSize * el.lineHeight;
  return {
    lines,
    lineHeight,
    height: Math.max(1, lines.length) * lineHeight + TEXT_PADDING * 2,
    lineWidths: lines.map(width),
    substituted: changed,
    text,
  };
}
