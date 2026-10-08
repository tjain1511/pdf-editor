/**
 * Reuse of a document's own fonts for replacement text.
 *
 * A registered font links a pdf.js font (whose glyph codes, advances and
 * @font-face family we learned from the operator list) to the font resource
 * of the page it came from. Replacement text is then drawn through that very
 * font dictionary, so the embedded font program is used unchanged. Only the
 * characters present in the (possibly subset) font can be drawn with it;
 * others fall back to a standard font.
 */
import { PDFDict, PDFName, PDFRef, type PDFDocument, type PDFPage } from 'pdf-lib';
import type { EditorPage } from '../editor/types';
import { getLibDocument } from './displayPage';
import { readPageContent, scanFontResourceNames, type FontGlyphs, type PageTextAnalysis } from './textOps';

export interface EmbeddedFontInfo {
  key: string;
  sourceId: string;
  /** Page the font resource was found on. */
  pageIndex: number;
  /** pdf.js font identifier; also the CSS @font-face family pdf.js registered. */
  loadedName: string;
  /** Resource name of the font on its page (without the slash). */
  resourceName: string;
  baseFont: string;
  bytesPerCode: 1 | 2;
  glyphs: FontGlyphs;
  /** Advance of a space (per 1pt) when the font has no space glyph. */
  spaceAdvance: number;
}

const registry = new Map<string, EmbeddedFontInfo>();

export function getEmbeddedFont(key: string | null | undefined): EmbeddedFontInfo | undefined {
  return key ? registry.get(key) : undefined;
}

export function clearEmbeddedFonts(): void {
  registry.clear();
}

/**
 * Register the font `loadedName` of the given page for reuse. Returns the
 * registry key, or null when the font cannot be reused safely.
 */
export async function registerEmbeddedFont(page: EditorPage, loadedName: string, analysis: PageTextAnalysis): Promise<string | null> {
  if (!page.source) return null;
  const key = `${page.source.sourceId}:${loadedName}`;
  const existing = registry.get(key);
  if (existing) return key;
  const glyphs = analysis.fonts.get(loadedName);
  if (!glyphs || glyphs.size === 0) return null;
  try {
    const lib = await getLibDocument(page.source.sourceId);
    const libPage = lib.getPage(page.source.pageIndex);
    const names = scanFontResourceNames(readPageContent(libPage));
    if (names.length !== analysis.fontOrder.length) return null;
    const idx = analysis.fontOrder.indexOf(loadedName);
    if (idx < 0) return null;
    // A font may be registered under several resource names (pdf.js merges identical
    // fonts); any of them selects the same font program.
    const resourceName = names[idx];
    const dict = fontDictOnPage(libPage, resourceName);
    if (!dict) return null;
    const subtype = dict.lookup(PDFName.of('Subtype'));
    const subtypeName = subtype instanceof PDFName ? subtype.decodeText() : '';
    if (subtypeName === 'Type3') return null;
    let bytesPerCode: 1 | 2 = 1;
    if (subtypeName === 'Type0') {
      const enc = dict.lookup(PDFName.of('Encoding'));
      const encName = enc instanceof PDFName ? enc.decodeText() : '';
      if (encName !== 'Identity-H' && encName !== 'Identity-V') return null;
      bytesPerCode = 2;
    }
    const base = dict.lookup(PDFName.of('BaseFont'));
    const baseFont = base instanceof PDFName ? base.decodeText() : loadedName;
    const space = glyphs.get(' ');
    const info: EmbeddedFontInfo = {
      key,
      sourceId: page.source.sourceId,
      pageIndex: page.source.pageIndex,
      loadedName,
      resourceName,
      baseFont,
      bytesPerCode,
      glyphs,
      spaceAdvance: space ? space.advance : 0.278,
    };
    registry.set(key, info);
    return key;
  } catch {
    return null;
  }
}

/** Merge glyph tables learned from another page of the same document. */
export function extendEmbeddedFont(key: string, analysis: PageTextAnalysis): void {
  const info = registry.get(key);
  if (!info) return;
  const more = analysis.fonts.get(info.loadedName);
  if (!more) return;
  for (const [k, v] of more) if (!info.glyphs.has(k)) info.glyphs.set(k, v);
}

function fontDictOnPage(page: PDFPage, resourceName: string): PDFDict | undefined {
  const resources = page.node.Resources();
  const fonts = resources?.lookup(PDFName.of('Font'));
  if (!(fonts instanceof PDFDict)) return undefined;
  const dict = fonts.lookup(PDFName.of(resourceName));
  return dict instanceof PDFDict ? dict : undefined;
}

/** Reference (or direct dict) of the font resource on an output page, if present. */
export function fontRefOnPage(page: PDFPage, resourceName: string): PDFRef | PDFDict | undefined {
  const resources = page.node.Resources();
  const fonts = resources?.lookup(PDFName.of('Font'));
  if (!(fonts instanceof PDFDict)) return undefined;
  const value = fonts.get(PDFName.of(resourceName));
  if (value instanceof PDFRef) return value;
  if (value instanceof PDFDict) return value;
  return undefined;
}

/** Make sure `page` can reference the font; returns the resource key to use in its content. */
export function ensureFontOnPage(doc: PDFDocument, page: PDFPage, origin: PDFPage | undefined, info: EmbeddedFontInfo): PDFName | null {
  const own = fontRefOnPage(page, info.resourceName);
  if (own) return PDFName.of(info.resourceName);
  if (!origin) return null;
  const ref = fontRefOnPage(origin, info.resourceName);
  if (!ref) return null;
  const fontRef = ref instanceof PDFRef ? ref : doc.context.register(ref);
  return page.node.newFontDictionary(info.baseFont.replace(/[^A-Za-z0-9]/g, '') || 'F', fontRef);
}

/* ----------------------------------------------------------------------------
 * Text segmentation, measurement and encoding
 * ------------------------------------------------------------------------- */

export interface TextSegment {
  text: string;
  /** True when drawn with the embedded font; false for fallback characters. */
  embedded: boolean;
}

/** Longest glyph key (ligatures) to try when matching text. */
const MAX_LIGATURE = 3;

/** Split a line into runs of characters the embedded font can draw and those it cannot. */
export function segmentText(text: string, info: EmbeddedFontInfo): TextSegment[] {
  const out: TextSegment[] = [];
  let i = 0;
  const push = (t: string, embedded: boolean) => {
    const last = out[out.length - 1];
    if (last && last.embedded === embedded) last.text += t;
    else out.push({ text: t, embedded });
  };
  while (i < text.length) {
    const m = matchGlyph(text, i, info);
    if (m) {
      push(m.text, true);
      i += m.text.length;
    } else if (text[i] === ' ') {
      push(' ', true);
      i++;
    } else {
      const cp = text.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      push(ch, false);
      i += ch.length;
    }
  }
  return out;
}

function matchGlyph(text: string, i: number, info: EmbeddedFontInfo): { text: string; glyph: { code: number; fontChar: string; advance: number } } | null {
  for (let len = Math.min(MAX_LIGATURE, text.length - i); len >= 1; len--) {
    const candidate = text.slice(i, i + len);
    const g = info.glyphs.get(candidate);
    if (g) return { text: candidate, glyph: g };
  }
  return null;
}

/** Width of text drawn entirely with the embedded font (missing characters count as spaces). */
export function measureEmbedded(text: string, info: EmbeddedFontInfo, fontSize: number): number {
  let w = 0;
  let i = 0;
  while (i < text.length) {
    const m = matchGlyph(text, i, info);
    if (m) {
      w += m.glyph.advance;
      i += m.text.length;
    } else {
      w += info.spaceAdvance;
      i += String.fromCodePoint(text.codePointAt(i)!).length;
    }
  }
  return w * fontSize;
}

export type RenderToken = { kind: 'glyphs'; text: string } | { kind: 'gap'; advance: number };

/**
 * Tokens for on-screen rendering with the pdf.js @font-face: runs of glyph
 * code points, and fixed-width gaps for spaces and glyphs pdf.js mapped to
 * control characters (which browsers would render as tabs or nothing).
 */
export function renderTokens(text: string, info: EmbeddedFontInfo): RenderToken[] {
  const out: RenderToken[] = [];
  const glyphs = (t: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === 'glyphs') last.text += t;
    else out.push({ kind: 'glyphs', text: t });
  };
  let i = 0;
  while (i < text.length) {
    const m = matchGlyph(text, i, info);
    if (m) {
      const cp = m.glyph.fontChar.codePointAt(0) ?? 0;
      if (m.text.trim() === '' || cp < 0x20 || (cp >= 0x7f && cp <= 0xa0)) out.push({ kind: 'gap', advance: m.glyph.advance });
      else glyphs(m.glyph.fontChar);
      i += m.text.length;
    } else {
      const ch = String.fromCodePoint(text.codePointAt(i)!);
      out.push({ kind: 'gap', advance: info.spaceAdvance });
      i += ch.length;
    }
  }
  return out;
}

/** The string to render on screen with the pdf.js @font-face for this text. */
export function fontCharString(text: string, info: EmbeddedFontInfo): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const m = matchGlyph(text, i, info);
    if (m) {
      out += m.glyph.fontChar;
      i += m.text.length;
    } else {
      const ch = String.fromCodePoint(text.codePointAt(i)!);
      out += ch;
      i += ch.length;
    }
  }
  return out;
}

/**
 * Encode text as a TJ array: hex strings of character codes with numeric
 * adjustments standing in for spaces the font cannot draw.
 */
export function encodeTJ(text: string, info: EmbeddedFontInfo): string {
  const parts: string[] = [];
  let hex = '';
  const flush = () => {
    if (hex) parts.push(`<${hex}>`);
    hex = '';
  };
  let i = 0;
  while (i < text.length) {
    const m = matchGlyph(text, i, info);
    if (m) {
      hex += m.glyph.code.toString(16).padStart(info.bytesPerCode * 2, '0');
      i += m.text.length;
      continue;
    }
    // Space (or unknown character) without a glyph: advance with an adjustment.
    flush();
    parts.push(String(Math.round(-info.spaceAdvance * 1000)));
    i += String.fromCodePoint(text.codePointAt(i)!).length;
  }
  flush();
  return `[${parts.join(' ')}]`;
}
