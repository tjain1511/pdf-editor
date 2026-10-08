/**
 * Locating and removing text-showing operators in a page's content stream.
 *
 * pdf.js' operator list is interpreted to find where every page-level
 * text-showing operator draws (in PDF user space), how far it advances and
 * what fill colour it uses. The k-th text-showing operator of the operator
 * list corresponds to the k-th `Tj`/`TJ`/`'`/`"` in the raw content stream,
 * which lets us blank exactly those operators with pdf-lib while keeping the
 * text position advance so the rest of the line is unaffected.
 */
import { PDFArray, PDFName, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream, type PDFPage } from 'pdf-lib';
import { pdfjs, type PDFPageProxy } from './pdfjs';
import { apply, multiply, type Matrix } from './geometry';
import type { TextRemoval } from '../editor/types';

export interface ShowOp {
  /** Ordinal among page-level text-showing operators. */
  ordinal: number;
  /** Glyph origin at the start of the operator, user space. */
  start: [number, number];
  /** Glyph origin after the operator, user space. */
  end: [number, number];
  /** Horizontal advance in text space (already includes horizontal scaling). */
  advance: number;
  fontSize: number;
  hScale: number;
  /** Fill colour as #rrggbb (text render mode 0/2/4/6). */
  color: string;
  /** Text rendering mode (3 and 7 are invisible). */
  renderMode: number;
  /** pdf.js font identifier (loadedName) in effect. */
  fontName: string;
}

export interface GlyphInfo {
  /** Character code as written in the content stream. */
  code: number;
  /** Code point(s) pdf.js uses to render the glyph with the loaded @font-face. */
  fontChar: string;
  /** Advance per 1pt of font size, in text space units. */
  advance: number;
}

/** Glyphs seen for one font, keyed by the Unicode text they represent. */
export type FontGlyphs = Map<string, GlyphInfo>;

export interface PageTextAnalysis {
  ops: ShowOp[];
  /** Glyph tables per pdf.js font name, from the page-level text. */
  fonts: Map<string, FontGlyphs>;
  /** pdf.js font names in the order of page-level `Tf` operators. */
  fontOrder: string[];
}

export type { TextRemoval } from '../editor/types';

const OPS = pdfjs.OPS as unknown as Record<string, number>;
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

interface TextState {
  tm: Matrix;
  tlm: Matrix;
  fontSize: number;
  fontMatrix0: number;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  rise: number;
  renderMode: number;
}

const analysisCache = new WeakMap<PDFPageProxy, Promise<PageTextAnalysis>>();

/** Analyse the page-level text-showing operators of a (source) page. */
export function analyzeShowOps(pdfPage: PDFPageProxy): Promise<PageTextAnalysis> {
  let p = analysisCache.get(pdfPage);
  if (!p) {
    p = doAnalyze(pdfPage);
    analysisCache.set(pdfPage, p);
  }
  return p;
}

async function doAnalyze(pdfPage: PDFPageProxy): Promise<PageTextAnalysis> {
  const list = await pdfPage.getOperatorList();
  const objs = pdfPage.commonObjs as { has(n: string): boolean; get(n: string): { fontMatrix?: number[]; vertical?: boolean } | null };
  const result: ShowOp[] = [];
  const fonts = new Map<string, FontGlyphs>();
  const fontOrder: string[] = [];
  let currentFont = '';
  let ctm: Matrix = IDENTITY;
  const ctmStack: Matrix[] = [];
  let fill = '#000000';
  const fillStack: string[] = [];
  const ts: TextState = {
    tm: IDENTITY,
    tlm: IDENTITY,
    fontSize: 0,
    fontMatrix0: 0.001,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
    renderMode: 0,
  };
  let formDepth = 0;
  let ordinal = 0;
  let vertical = false;

  const nextLine = (tx: number, ty: number) => {
    ts.tlm = multiply(ts.tlm, [1, 0, 0, 1, tx, ty]);
    ts.tm = ts.tlm;
  };

  const { fnArray, argsArray } = list;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;
    switch (fn) {
      case OPS.paintFormXObjectBegin:
        formDepth++;
        ctmStack.push(ctm);
        fillStack.push(fill);
        if (args && Array.isArray(args[0]) && args[0].length === 6) ctm = multiply(ctm, args[0] as Matrix);
        break;
      case OPS.paintFormXObjectEnd:
        formDepth = Math.max(0, formDepth - 1);
        ctm = ctmStack.pop() ?? IDENTITY;
        fill = fillStack.pop() ?? fill;
        break;
      case OPS.save:
        ctmStack.push(ctm);
        fillStack.push(fill);
        break;
      case OPS.restore:
        ctm = ctmStack.pop() ?? IDENTITY;
        fill = fillStack.pop() ?? fill;
        break;
      case OPS.transform: {
        const m = toMatrix(args);
        if (m) ctm = multiply(ctm, m);
        break;
      }
      case OPS.beginText:
        ts.tm = IDENTITY;
        ts.tlm = IDENTITY;
        break;
      case OPS.setCharSpacing:
        ts.charSpacing = num(args?.[0]);
        break;
      case OPS.setWordSpacing:
        ts.wordSpacing = num(args?.[0]);
        break;
      case OPS.setHScale:
        ts.hScale = num(args?.[0], 100) / 100;
        break;
      case OPS.setLeading:
        ts.leading = num(args?.[0]);
        break;
      case OPS.setTextRise:
        ts.rise = num(args?.[0]);
        break;
      case OPS.setTextRenderingMode:
        ts.renderMode = num(args?.[0]);
        break;
      case OPS.setFont: {
        const name = String(args?.[0] ?? '');
        currentFont = name;
        if (formDepth === 0) fontOrder.push(name);
        ts.fontSize = num(args?.[1]);
        let fm = 0.001;
        vertical = false;
        try {
          if (objs.has(name)) {
            const font = objs.get(name);
            if (font?.fontMatrix && typeof font.fontMatrix[0] === 'number') fm = font.fontMatrix[0];
            vertical = !!font?.vertical;
          }
        } catch {
          /* ignore */
        }
        ts.fontMatrix0 = fm;
        break;
      }
      case OPS.moveText:
        nextLine(num(args?.[0]), num(args?.[1]));
        break;
      case OPS.setLeadingMoveText:
        ts.leading = -num(args?.[1]);
        nextLine(num(args?.[0]), num(args?.[1]));
        break;
      case OPS.setTextMatrix: {
        const m = toMatrix(args);
        if (m) {
          ts.tm = m;
          ts.tlm = m;
        }
        break;
      }
      case OPS.nextLine:
        nextLine(0, -ts.leading);
        break;
      case OPS.setFillRGBColor:
      case OPS.setFillGray:
      case OPS.setFillCMYKColor:
      case OPS.setFillColor:
        if (args && typeof args[0] === 'string' && /^#[0-9a-f]{6}$/i.test(args[0])) fill = args[0].toLowerCase();
        else if (args && args.length >= 3) fill = rgb(num(args[0]), num(args[1]), num(args[2]));
        else if (args && args.length === 1 && typeof args[0] === 'number') {
          const g = Math.round(num(args[0]) * 255);
          fill = rgb(g, g, g);
        }
        break;
      case OPS.showText: {
        const glyphs = (args?.[0] ?? []) as (
          | number
          | { width?: number; isSpace?: boolean; unicode?: string; fontChar?: string; originalCharCode?: number; isInFont?: boolean }
        )[];
        let table = formDepth === 0 ? fonts.get(currentFont) : undefined;
        if (formDepth === 0 && !table) {
          table = new Map();
          fonts.set(currentFont, table);
        }
        // Advance in unscaled text space.
        let adv = 0;
        for (const g of glyphs) {
          if (typeof g === 'number') {
            adv -= (g / 1000) * ts.fontSize * ts.hScale;
          } else {
            const w = (g.width ?? 0) * ts.fontMatrix0;
            adv += (w * ts.fontSize + ts.charSpacing + (g.isSpace ? ts.wordSpacing : 0)) * ts.hScale;
            if (table && typeof g.unicode === 'string' && g.unicode && typeof g.originalCharCode === 'number' && !table.has(g.unicode)) {
              table.set(g.unicode, { code: g.originalCharCode, fontChar: g.fontChar ?? g.unicode, advance: w });
            }
          }
        }
        const trm = multiply(ctm, ts.tm);
        const start = apply(trm, 0, ts.rise);
        const end = apply(trm, vertical ? 0 : adv, vertical ? -adv : ts.rise);
        if (formDepth === 0) {
          result.push({
            ordinal: ordinal++,
            start,
            end,
            advance: adv,
            fontSize: ts.fontSize,
            hScale: ts.hScale,
            color: fill,
            renderMode: ts.renderMode,
            fontName: currentFont,
          });
        }
        // Advance the text matrix.
        ts.tm = multiply(ts.tm, vertical ? [1, 0, 0, 1, 0, -adv] : [1, 0, 0, 1, adv, 0]);
        break;
      }
      default:
        break;
    }
  }
  return { ops: result, fonts, fontOrder };
}

/** pdf.js passes matrices either as six numbers or as one (typed) array of six. */
function toMatrix(args: unknown[] | null): Matrix | null {
  if (!args) return null;
  const src = args.length === 1 && args[0] && typeof args[0] === 'object' ? (args[0] as ArrayLike<number>) : (args as ArrayLike<number>);
  if (src.length !== 6) return null;
  const m = [src[0], src[1], src[2], src[3], src[4], src[5]].map((v) => num(v));
  return m as Matrix;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function rgb(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/* ----------------------------------------------------------------------------
 * Matching
 * ------------------------------------------------------------------------- */

export interface TextSpan {
  /** Start of the span in user space. */
  start: [number, number];
  /** Unit direction of the baseline in user space. */
  dir: [number, number];
  /** Length along the baseline. */
  length: number;
  /** Font height, used for tolerances. */
  height: number;
}

/**
 * Find operators drawing inside the given spans. Returns null when an operator
 * only partially overlaps a span (so blanking it would remove too much).
 */
export function matchShowOps(ops: ShowOp[], spans: TextSpan[], requireFullyInside: boolean): ShowOp[] | null {
  const matched: ShowOp[] = [];
  for (const op of ops) {
    if (op.renderMode === 3 || op.renderMode === 7) continue;
    let inside = false;
    let partial = false;
    for (const span of spans) {
      const tol = Math.max(0.5, span.height * 0.45);
      const rel: [number, number] = [op.start[0] - span.start[0], op.start[1] - span.start[1]];
      const t = rel[0] * span.dir[0] + rel[1] * span.dir[1];
      const perp = Math.abs(rel[0] * span.dir[1] - rel[1] * span.dir[0]);
      if (perp > tol) continue;
      const relEnd: [number, number] = [op.end[0] - span.start[0], op.end[1] - span.start[1]];
      const tEnd = relEnd[0] * span.dir[0] + relEnd[1] * span.dir[1];
      const a = Math.min(t, tEnd);
      const b = Math.max(t, tEnd);
      const overlap = Math.min(b, span.length) - Math.max(a, 0);
      const isPoint = b - a < tol * 0.1;
      if (isPoint) {
        if (t >= -tol && t <= span.length + tol) inside = true;
        continue;
      }
      if (overlap <= tol * 0.5) continue; // no meaningful overlap with this span
      if (a >= -tol && b <= span.length + tol) inside = true;
      else partial = true;
    }
    if (inside) matched.push(op);
    else if (partial && requireFullyInside) return null;
    else if (partial) matched.push(op);
  }
  return matched;
}

/** Build the removal record for matched operators. */
export function removalFor(id: string, ops: ShowOp[]): TextRemoval {
  return {
    id,
    ops: ops.map((op) => ({
      ordinal: op.ordinal,
      // TJ adjustment (thousandths of text space, before font size and scaling).
      adjust: op.fontSize && op.hScale ? -(op.advance * 1000) / (op.fontSize * op.hScale) : 0,
    })),
  };
}

/* ----------------------------------------------------------------------------
 * Content stream rewriting
 * ------------------------------------------------------------------------- */

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

interface RawOp {
  op: string;
  /** Byte offset of the first operand. */
  start: number;
  /** Byte offset just past the operator. */
  end: number;
  operands: string[];
}

/** Scan a content stream and return every text-showing operator in order. */
function scanShowOps(bytes: Uint8Array): RawOp[] {
  return scanOps(bytes).filter((o) => o.op !== 'Tf');
}

/** Resource names of page-level `Tf` operators, in order. */
export function scanFontResourceNames(bytes: Uint8Array): string[] {
  return scanOps(bytes)
    .filter((o) => o.op === 'Tf')
    .map((o) => (o.operands[o.operands.length - 2] ?? '').replace(/^\//, ''));
}

/** Scan a content stream for text-showing and font-selection operators. */
function scanOps(bytes: Uint8Array): RawOp[] {
  const out: RawOp[] = [];
  const n = bytes.length;
  let i = 0;
  let operands: { text: string; start: number }[] = [];
  const isRegular = (c: number) => !WHITESPACE.has(c) && !DELIMS.has(c);
  const text = (a: number, b: number) => {
    let s = '';
    for (let k = a; k < b; k++) s += String.fromCharCode(bytes[k]);
    return s;
  };
  while (i < n) {
    const c = bytes[i];
    if (WHITESPACE.has(c)) {
      i++;
      continue;
    }
    const tokenStart = i;
    if (c === 0x25) {
      // comment
      while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      continue;
    }
    if (c === 0x28) {
      // literal string
      let depth = 0;
      do {
        const ch = bytes[i];
        if (ch === 0x5c) i += 2;
        else {
          if (ch === 0x28) depth++;
          else if (ch === 0x29) depth--;
          i++;
        }
      } while (i < n && depth > 0);
      operands.push({ text: text(tokenStart, i), start: tokenStart });
      continue;
    }
    if (c === 0x3c) {
      if (bytes[i + 1] === 0x3c) {
        // dictionary: skip balanced << >>
        let depth = 0;
        while (i < n) {
          if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) {
            depth++;
            i += 2;
          } else if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) {
            depth--;
            i += 2;
            if (depth === 0) break;
          } else if (bytes[i] === 0x28) {
            let d = 0;
            do {
              if (bytes[i] === 0x5c) i += 2;
              else {
                if (bytes[i] === 0x28) d++;
                else if (bytes[i] === 0x29) d--;
                i++;
              }
            } while (i < n && d > 0);
          } else i++;
        }
        operands.push({ text: text(tokenStart, i), start: tokenStart });
        continue;
      }
      // hex string
      i++;
      while (i < n && bytes[i] !== 0x3e) i++;
      i++;
      operands.push({ text: text(tokenStart, i), start: tokenStart });
      continue;
    }
    if (c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) {
      i++;
      operands.push({ text: text(tokenStart, i), start: tokenStart });
      continue;
    }
    if (c === 0x2f) {
      i++;
      while (i < n && isRegular(bytes[i])) i++;
      operands.push({ text: text(tokenStart, i), start: tokenStart });
      continue;
    }
    if (c === 0x3e || c === 0x29) {
      i++;
      continue;
    }
    // number or operator
    while (i < n && isRegular(bytes[i])) i++;
    const tok = text(tokenStart, i);
    if (/^[+-.\d]/.test(tok)) {
      operands.push({ text: tok, start: tokenStart });
      continue;
    }
    // operator
    if (tok === 'BI') {
      // Inline image: skip to EI delimiter.
      let j = i;
      while (j < n) {
        if (
          bytes[j] === 0x45 &&
          bytes[j + 1] === 0x49 &&
          (j === 0 || WHITESPACE.has(bytes[j - 1])) &&
          (j + 2 >= n || WHITESPACE.has(bytes[j + 2]) || DELIMS.has(bytes[j + 2]))
        ) {
          j += 2;
          break;
        }
        j++;
      }
      i = j;
      operands = [];
      continue;
    }
    if (tok === 'Tf') {
      out.push({ op: tok, start: operands.length ? operands[0].start : tokenStart, end: i, operands: operands.map((o) => o.text) });
    }
    if (tok === 'Tj' || tok === 'TJ' || tok === "'" || tok === '"') {
      // Arrays: operands hold the flattened tokens; rebuild a textual form.
      let start = operands.length ? operands[0].start : tokenStart;
      // For arrays, operands include '[' ... ']' tokens; find the last '[' for TJ.
      if (tok === 'TJ') {
        const open = operands.map((o) => o.text).lastIndexOf('[');
        if (open >= 0) start = operands[open].start;
      } else if (tok === "'") {
        start = operands.length ? operands[operands.length - 1].start : tokenStart;
      } else if (tok === '"') {
        start = operands.length >= 3 ? operands[operands.length - 3].start : operands.length ? operands[0].start : tokenStart;
      } else if (tok === 'Tj') {
        start = operands.length ? operands[operands.length - 1].start : tokenStart;
      }
      out.push({ op: tok, start, end: i, operands: operands.map((o) => o.text) });
    }
    operands = [];
  }
  return out;
}

function fmt(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

/** Blank the given text-showing operators while preserving their advances. */
export function rewriteContent(bytes: Uint8Array, removals: TextRemoval[]): Uint8Array {
  const ops = scanShowOps(bytes);
  const byOrdinal = new Map<number, number>();
  for (const r of removals) for (const o of r.ops) byOrdinal.set(o.ordinal, o.adjust);
  const edits: { start: number; end: number; text: string }[] = [];
  for (let k = 0; k < ops.length; k++) {
    if (!byOrdinal.has(k)) continue;
    const adjust = byOrdinal.get(k)!;
    const op = ops[k];
    let replacement = `[${fmt(adjust)}] TJ`;
    if (op.op === "'") replacement = `T* [${fmt(adjust)}] TJ`;
    else if (op.op === '"') {
      const aw = op.operands[op.operands.length - 3] ?? '0';
      const ac = op.operands[op.operands.length - 2] ?? '0';
      replacement = `${aw} Tw ${ac} Tc T* [${fmt(adjust)}] TJ`;
    }
    edits.push({ start: op.start, end: op.end, text: replacement });
  }
  if (!edits.length) return bytes;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  let pos = 0;
  for (const e of edits) {
    parts.push(bytes.subarray(pos, e.start));
    parts.push(encoder.encode(` ${e.text} `));
    pos = e.end;
  }
  parts.push(bytes.subarray(pos));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Number of page-level text-showing operators in the raw content (for validation). */
export function countShowOps(bytes: Uint8Array): number {
  return scanShowOps(bytes).length;
}

/** Decode and concatenate the page's content streams. */
export function readPageContent(page: PDFPage): Uint8Array {
  const contents = page.node.Contents();
  if (!contents) return new Uint8Array();
  const streams: PDFStream[] = [];
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const s = contents.lookup(i);
      if (s instanceof PDFStream) streams.push(s);
    }
  } else streams.push(contents);
  const chunks: Uint8Array[] = [];
  for (const s of streams) {
    if (!(s instanceof PDFRawStream)) throw new Error('Unsupported content stream');
    chunks.push(decodePDFRawStream(s).decode());
    chunks.push(new Uint8Array([0x0a]));
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * Apply text removals to a pdf-lib page. Must run before anything is drawn
 * on the page (pdf-lib wraps the content once drawing starts). Returns false
 * when the content could not be rewritten safely.
 */
export function applyRemovals(page: PDFPage, removals: TextRemoval[], expectedShowOps?: number): boolean {
  if (!removals.length) return true;
  let content: Uint8Array;
  try {
    content = readPageContent(page);
  } catch {
    return false;
  }
  if (expectedShowOps !== undefined && countShowOps(content) !== expectedShowOps) return false;
  const rewritten = rewriteContent(content, removals);
  const ref: PDFRef = page.doc.context.register(page.doc.context.flateStream(rewritten));
  page.node.set(PDFName.of('Contents'), ref);
  return true;
}
