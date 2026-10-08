/**
 * Builds the final PDF with pdf-lib.
 *
 * Strategy: the first (primary) source document is loaded and modified in
 * place so that its forms, links, outlines and metadata survive. Pages from
 * other sources are copied in; blank pages are created; and every editor
 * element is drawn into the page content stream using coordinates converted
 * from the editor's visual space to PDF user space. Sources pdf-lib cannot
 * parse are rasterised ("flattened") instead.
 */
import {
  PDFDocument,
  PDFArray,
  PDFHexString,
  PDFNumber,
  PDFOperatorNames,
  PDFFont,
  PDFImage,
  PDFName,
  PDFOperator,
  PDFPage,
  StandardFonts,
  LineCapStyle,
  LineJoinStyle,
  appendBezierCurve,
  beginText,
  closePath,
  degrees,
  endText,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFillingRgbColor,
  setFontAndSize,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  setTextMatrix,
  showText,
  stroke,
} from 'pdf-lib';
import type {
  CheckboxElement,
  EditorElement,
  EditorPage,
  LineElement,
  MarkupElement,
  PathElement,
  Point,
  Rect,
  ShapeElement,
  TextElement,
} from '../editor/types';
import { getAsset } from '../editor/assets';
import { pageSize, totalRotation } from '../editor/pageUtils';
import { getSource } from './sources';
import { renderPageToPng } from './renderer';
import { applyRemovals } from './textOps';
import { expectedShowOps } from './displayPage';
import { encodeTJ, ensureFontOnPage, getEmbeddedFont, segmentText } from './embeddedFonts';
import { createPageGeometry, rectCenter, rectCorners, rotatePoint, type PageGeometry } from './geometry';
import { TEXT_PADDING, baselineFor, layoutText, standardFontFor } from './fonts';
import { arrowHead, checkboxGeometry, ellipsePath, lineEndpoints, pathStrokes, smoothPathSegments } from './shapes';

export interface ExportOptions {
  /** Force rasterising every source page. */
  flatten: boolean;
  title?: string;
}

interface ExportContext {
  doc: PDFDocument;
  fonts: Map<StandardFonts, PDFFont>;
  images: Map<string, PDFImage>;
  /** Output pages that still carry their original resources, by source page. */
  pagesBySource: Map<string, PDFPage>;
}

type PlannedPage =
  | { kind: 'existing'; page: PDFPage }
  | { kind: 'blank'; width: number; height: number; rotation: number }
  | { kind: 'flattened'; editorPage: EditorPage };

export async function exportPdf(pages: EditorPage[], options: ExportOptions): Promise<Uint8Array> {
  if (!pages.length) throw new Error('Nothing to export');

  // Pick the primary source: the first rewritable source referenced.
  const primaryId = options.flatten
    ? null
    : pages.find((p) => p.source && !getSource(p.source.sourceId)?.flattenOnly)?.source?.sourceId ?? null;

  let doc: PDFDocument | null = null;
  let primaryPages: PDFPage[] = [];
  if (primaryId) {
    try {
      doc = await PDFDocument.load(getSource(primaryId)!.bytes, { updateMetadata: false, throwOnInvalidObject: false });
      primaryPages = doc.getPages();
    } catch {
      doc = null;
    }
  }
  const primaryUsable = doc !== null;
  if (!doc) doc = await PDFDocument.create();

  // Copy pages from secondary sources in one batch per source (shares resources).
  const copiedBySource = new Map<string, Map<number, PDFPage[]>>();
  const secondaryIds = new Set<string>();
  for (const p of pages) {
    if (p.source && p.source.sourceId !== (primaryUsable ? primaryId : null)) secondaryIds.add(p.source.sourceId);
  }
  const flattenSources = new Set<string>();
  for (const id of secondaryIds) {
    const source = getSource(id);
    if (!source) continue;
    if (options.flatten || source.flattenOnly) {
      flattenSources.add(id);
      continue;
    }
    try {
      const srcDoc = await PDFDocument.load(source.bytes, { updateMetadata: false, throwOnInvalidObject: false });
      const indices = pages.filter((p) => p.source?.sourceId === id).map((p) => p.source!.pageIndex);
      const copied = await doc.copyPages(srcDoc, indices);
      const byIndex = new Map<number, PDFPage[]>();
      indices.forEach((idx, k) => {
        const list = byIndex.get(idx) ?? [];
        list.push(copied[k]);
        byIndex.set(idx, list);
      });
      copiedBySource.set(id, byIndex);
    } catch {
      flattenSources.add(id);
    }
  }

  // Plan the final page list.
  const usedPrimary = new Set<number>();
  const plan: PlannedPage[] = [];
  for (const p of pages) {
    if (!p.source) {
      const [, , w, h] = p.view;
      plan.push({ kind: 'blank', width: w, height: h, rotation: p.rotation });
      continue;
    }
    const { sourceId, pageIndex } = p.source;
    if (primaryUsable && sourceId === primaryId) {
      if (!usedPrimary.has(pageIndex)) {
        usedPrimary.add(pageIndex);
        plan.push({ kind: 'existing', page: primaryPages[pageIndex] });
      } else {
        const [copy] = await doc.copyPages(doc, [pageIndex]);
        plan.push({ kind: 'existing', page: copy });
      }
      continue;
    }
    if (flattenSources.has(sourceId) || !getSource(sourceId)) {
      plan.push({ kind: 'flattened', editorPage: p });
      continue;
    }
    const list = copiedBySource.get(sourceId)?.get(pageIndex);
    const page = list?.shift();
    if (page) plan.push({ kind: 'existing', page });
    else plan.push({ kind: 'flattened', editorPage: p });
  }

  // Rebuild the page tree in the desired order.
  if (primaryUsable) {
    for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
  }

  const ctx: ExportContext = { doc, fonts: new Map(), images: new Map(), pagesBySource: new Map() };
  for (let i = 0; i < pages.length; i++) {
    const editorPage = pages[i];
    const planned = plan[i];
    let page: PDFPage;
    let geometry: PageGeometry;
    if (planned.kind === 'existing') {
      page = doc.addPage(planned.page);
      if (editorPage.source) ctx.pagesBySource.set(`${editorPage.source.sourceId}:${editorPage.source.pageIndex}`, page);
      const rotation = totalRotation(editorPage);
      page.setRotation(degrees(rotation));
      geometry = createPageGeometry(editorPage.view, rotation);
      if (editorPage.removals.length) {
        let expected: number | undefined;
        try {
          expected = await expectedShowOps(editorPage);
        } catch {
          expected = undefined;
        }
        if (!applyRemovals(page, editorPage.removals, expected)) console.warn('Could not remove original text on page', i + 1);
      }
    } else if (planned.kind === 'blank') {
      page = doc.addPage([planned.width, planned.height]);
      page.setRotation(degrees(planned.rotation));
      geometry = createPageGeometry([0, 0, planned.width, planned.height], planned.rotation);
    } else {
      const { width, height } = pageSize(editorPage);
      page = doc.addPage([width, height]);
      try {
        const png = await renderPageToPng(editorPage);
        const image = await doc.embedPng(png.bytes);
        page.drawImage(image, { x: 0, y: 0, width, height });
      } catch (err) {
        console.warn('Could not rasterise page', err);
      }
      geometry = createPageGeometry([0, 0, width, height], 0);
    }
    for (const el of editorPage.elements) {
      try {
        await drawElement(ctx, page, geometry, el);
      } catch (err) {
        console.warn('Skipping element that failed to export', el.type, err);
      }
    }
  }

  doc.setModificationDate(new Date());
  if (options.title && !doc.getTitle()) doc.setTitle(options.title);
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}

/* ----------------------------------------------------------------------------
 * Element drawing
 * ------------------------------------------------------------------------- */

async function drawElement(ctx: ExportContext, page: PDFPage, g: PageGeometry, el: EditorElement): Promise<void> {
  switch (el.type) {
    case 'cover':
      drawPolygon(page, g, rectCorners(el, el.rotation), { fill: el.color, opacity: el.opacity });
      return;
    case 'shape':
      drawShape(page, g, el);
      return;
    case 'line':
      drawLine(page, g, el);
      return;
    case 'path':
      drawPath(page, g, el);
      return;
    case 'markup':
      drawMarkup(page, g, el);
      return;
    case 'checkbox':
      drawCheckbox(page, g, el);
      return;
    case 'image':
      await drawImage(ctx, page, g, el);
      return;
    case 'text':
      drawText(ctx, page, g, el);
      return;
  }
}

interface PaintOptions {
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
  opacity?: number;
  blend?: 'Multiply';
  cap?: LineCapStyle;
  join?: LineJoinStyle;
}

function hex(color: string): { r: number; g: number; b: number } {
  let h = color.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function graphicsState(page: PDFPage, opacity: number, blend?: 'Multiply'): PDFName | null {
  if (opacity >= 1 && !blend) return null;
  const dict = blend
    ? page.doc.context.obj({ Type: 'ExtGState', CA: opacity, ca: opacity, BM: PDFName.of(blend) })
    : page.doc.context.obj({ Type: 'ExtGState', CA: opacity, ca: opacity });
  return page.node.newExtGState('GS', dict);
}

/** Emit a path from visual points (already transformed to PDF space inside). */
function paintPath(page: PDFPage, ops: PDFOperator[], o: PaintOptions): void {
  const fillColor = o.fill ? hex(o.fill) : null;
  const strokeColor = o.stroke && (o.strokeWidth ?? 1) > 0 ? hex(o.stroke) : null;
  if (!fillColor && !strokeColor) return;
  const gs = graphicsState(page, o.opacity ?? 1, o.blend);
  const out: PDFOperator[] = [pushGraphicsState()];
  if (gs) out.push(setGraphicsState(gs));
  if (fillColor) out.push(setFillingRgbColor(fillColor.r, fillColor.g, fillColor.b));
  if (strokeColor) {
    out.push(setStrokingRgbColor(strokeColor.r, strokeColor.g, strokeColor.b));
    out.push(setLineWidth(o.strokeWidth ?? 1));
    out.push(setLineCap(o.cap ?? LineCapStyle.Butt));
    out.push(setLineJoin(o.join ?? LineJoinStyle.Miter));
  }
  // Fill first, then stroke, each with its own path, to keep opacity uniform.
  if (fillColor) out.push(...ops, fill());
  if (strokeColor) out.push(...ops, stroke());
  out.push(popGraphicsState());
  page.pushOperators(...out);
}

function polygonOps(g: PageGeometry, points: Point[], close = true): PDFOperator[] {
  const ops: PDFOperator[] = [];
  points.forEach((p, i) => {
    const [x, y] = g.toPdf(p.x, p.y);
    ops.push(i === 0 ? moveTo(x, y) : lineTo(x, y));
  });
  if (close) ops.push(closePath());
  return ops;
}

function drawPolygon(page: PDFPage, g: PageGeometry, points: Point[], o: PaintOptions): void {
  paintPath(page, polygonOps(g, points), o);
}

function drawShape(page: PDFPage, g: PageGeometry, el: ShapeElement): void {
  const o: PaintOptions = {
    fill: el.fillColor,
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    opacity: el.opacity,
    join: LineJoinStyle.Miter,
  };
  if (el.shape === 'rect') {
    drawPolygon(page, g, rectCorners(el, el.rotation), o);
    return;
  }
  const segments = ellipsePath(el, el.rotation);
  const ops: PDFOperator[] = [];
  const [sx, sy] = g.toPdf(segments.start.x, segments.start.y);
  ops.push(moveTo(sx, sy));
  for (const c of segments.curves) {
    const [x1, y1] = g.toPdf(c[0].x, c[0].y);
    const [x2, y2] = g.toPdf(c[1].x, c[1].y);
    const [x3, y3] = g.toPdf(c[2].x, c[2].y);
    ops.push(appendBezierCurve(x1, y1, x2, y2, x3, y3));
  }
  ops.push(closePath());
  paintPath(page, ops, o);
}

function drawLine(page: PDFPage, g: PageGeometry, el: LineElement): void {
  const { from, to } = lineEndpoints(el);
  paintPath(page, polygonOps(g, [from, to], false), {
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    opacity: el.opacity,
    cap: LineCapStyle.Round,
  });
  if (el.arrowEnd) drawPolygon(page, g, arrowHead(from, to, el.strokeWidth), { fill: el.strokeColor, opacity: el.opacity });
  if (el.arrowStart) drawPolygon(page, g, arrowHead(to, from, el.strokeWidth), { fill: el.strokeColor, opacity: el.opacity });
}

function ellipseOps(g: PageGeometry, r: Rect): PDFOperator[] {
  const seg = ellipsePath(r, 0);
  const ops: PDFOperator[] = [];
  const [sx, sy] = g.toPdf(seg.start.x, seg.start.y);
  ops.push(moveTo(sx, sy));
  for (const c of seg.curves) {
    const [x1, y1] = g.toPdf(c[0].x, c[0].y);
    const [x2, y2] = g.toPdf(c[1].x, c[1].y);
    const [x3, y3] = g.toPdf(c[2].x, c[2].y);
    ops.push(appendBezierCurve(x1, y1, x2, y2, x3, y3));
  }
  ops.push(closePath());
  return ops;
}

function drawPath(page: PDFPage, g: PageGeometry, el: PathElement): void {
  for (const pts of pathStrokes(el)) {
    if (!pts.length) continue;
    if (pts.length === 1) {
      const r = el.strokeWidth / 2;
      paintPath(page, ellipseOps(g, { x: pts[0].x - r, y: pts[0].y - r, width: r * 2, height: r * 2 }), {
        fill: el.strokeColor,
        opacity: el.opacity,
      });
      continue;
    }
    const ops: PDFOperator[] = [];
    const [sx, sy] = g.toPdf(pts[0].x, pts[0].y);
    ops.push(moveTo(sx, sy));
    for (const s of smoothPathSegments(pts)) {
      if (s.kind === 'line') {
        const [x, y] = g.toPdf(s.to.x, s.to.y);
        ops.push(lineTo(x, y));
      } else {
        const [c1x, c1y] = g.toPdf(s.c1.x, s.c1.y);
        const [c2x, c2y] = g.toPdf(s.c2.x, s.c2.y);
        const [x, y] = g.toPdf(s.to.x, s.to.y);
        ops.push(appendBezierCurve(c1x, c1y, c2x, c2y, x, y));
      }
    }
    paintPath(page, ops, {
      stroke: el.strokeColor,
      strokeWidth: el.strokeWidth,
      opacity: el.opacity,
      cap: LineCapStyle.Round,
      join: LineJoinStyle.Round,
    });
  }
}

function drawMarkup(page: PDFPage, g: PageGeometry, el: MarkupElement): void {
  const center = rectCenter(el);
  for (const r of el.rects) {
    if (el.kind === 'highlight') {
      drawPolygon(page, g, rectCorners(r, 0).map((p) => rotatePoint(p, center, el.rotation)), {
        fill: el.color,
        opacity: el.opacity,
        blend: 'Multiply',
      });
      continue;
    }
    const thickness = Math.max(0.6, r.height * 0.06);
    const y = el.kind === 'underline' ? r.y + r.height - thickness : r.y + r.height * 0.58;
    const bar: Rect = { x: r.x, y, width: r.width, height: thickness };
    drawPolygon(page, g, rectCorners(bar, 0).map((p) => rotatePoint(p, center, el.rotation)), {
      fill: el.color,
      opacity: el.opacity,
    });
  }
}

function drawCheckbox(page: PDFPage, g: PageGeometry, el: CheckboxElement): void {
  const geo = checkboxGeometry(el);
  if (geo.box) {
    drawPolygon(page, g, geo.box, { stroke: el.color, strokeWidth: geo.boxStroke, opacity: el.opacity, join: LineJoinStyle.Miter });
  }
  if (geo.circle) paintPath(page, ellipseOps(g, geo.circle), { stroke: el.color, strokeWidth: geo.boxStroke, opacity: el.opacity });
  if (geo.dot) paintPath(page, ellipseOps(g, geo.dot), { fill: el.color, opacity: el.opacity });
  for (const stroke of geo.strokes) {
    paintPath(page, polygonOps(g, stroke, false), {
      stroke: el.color,
      strokeWidth: geo.markStroke,
      opacity: el.opacity,
      cap: LineCapStyle.Round,
      join: LineJoinStyle.Round,
    });
  }
}

/** `TJ` operator from a textual array such as `[<0041> -278 <0042>]`. */
function showTJ(ctx: ExportContext, array: string): PDFOperator {
  const arr = PDFArray.withContext(ctx.doc.context);
  for (const item of array.slice(1, -1).trim().split(/\s+/).filter(Boolean)) {
    arr.push(item.startsWith('<') ? PDFHexString.of(item.slice(1, -1)) : PDFNumber.of(parseFloat(item)));
  }
  return PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [arr]);
}

/** Angle (degrees, counter-clockwise in PDF space) of the visual +x axis of a rotated element. */
function pdfAngle(g: PageGeometry, rotation: number): number {
  const rad = (rotation * Math.PI) / 180;
  const [dx, dy] = g.dirToPdf(Math.cos(rad), Math.sin(rad));
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

async function drawImage(ctx: ExportContext, page: PDFPage, g: PageGeometry, el: EditorElement & { type: 'image' }): Promise<void> {
  const asset = getAsset(el.assetId);
  if (!asset) return;
  let image = ctx.images.get(asset.id);
  if (!image) {
    image = asset.mime === 'image/png' ? await ctx.doc.embedPng(asset.bytes) : await ctx.doc.embedJpg(asset.bytes);
    ctx.images.set(asset.id, image);
  }
  const bottomLeft = rectCorners(el, el.rotation)[3];
  const [x, y] = g.toPdf(bottomLeft.x, bottomLeft.y);
  page.drawImage(image, {
    x,
    y,
    width: el.width,
    height: el.height,
    rotate: degrees(pdfAngle(g, el.rotation)),
    opacity: el.opacity,
  });
}

async function getFont(ctx: ExportContext, std: StandardFonts): Promise<PDFFont> {
  let font = ctx.fonts.get(std);
  if (!font) {
    font = await ctx.doc.embedFont(std);
    ctx.fonts.set(std, font);
  }
  return font;
}

async function drawText(ctx: ExportContext, page: PDFPage, g: PageGeometry, el: TextElement): Promise<void> {
  const layout = layoutText(el);
  const std = standardFontFor(el.fontFamily, el.bold, el.italic);
  const font = await getFont(ctx, std);
  const center = rectCenter(el);
  const angle = pdfAngle(g, el.rotation);
  const color = hex(el.color);
  const hScale = el.hScale > 0 ? el.hScale : 1;
  const fontKey = page.node.newFontDictionary(font.name, font.ref);
  const gs = graphicsState(page, el.opacity);
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Document font, when the element uses one and the page can reference it.
  const embedded = getEmbeddedFont(el.embeddedFont);
  const embeddedKey = embedded
    ? ensureFontOnPage(ctx.doc, page, ctx.pagesBySource.get(`${embedded.sourceId}:${embedded.pageIndex}`), embedded)
    : null;

  if (el.background) {
    drawPolygon(page, g, rectCorners(el, el.rotation), { fill: el.background, opacity: el.opacity });
  }

  for (let i = 0; i < layout.lines.length; i++) {
    const line = layout.lines[i];
    if (!line) continue;
    const lineWidth = layout.lineWidths[i];
    let lx = el.x + TEXT_PADDING;
    if (el.align === 'center') lx = el.x + (el.width - lineWidth) / 2;
    else if (el.align === 'right') lx = el.x + el.width - TEXT_PADDING - lineWidth;
    const ly = el.y + baselineFor(el, i);
    const start = rotatePoint({ x: lx, y: ly }, center, el.rotation);
    const [x, y] = g.toPdf(start.x, start.y);
    const ops: PDFOperator[] = [pushGraphicsState()];
    if (gs) ops.push(setGraphicsState(gs));
    ops.push(beginText(), setFillingRgbColor(color.r, color.g, color.b), setCharacterSqueeze(hScale * 100), setTextMatrix(cos, sin, -sin, cos, x, y));
    if (embedded && embeddedKey) {
      // Document font where it has the glyphs, standard font for the rest.
      for (const seg of segmentText(line, embedded)) {
        if (seg.embedded) ops.push(setFontAndSize(embeddedKey, el.fontSize), showTJ(ctx, encodeTJ(seg.text, embedded)));
        else ops.push(setFontAndSize(fontKey, el.fontSize), showText(font.encodeText(seg.text)));
      }
    } else {
      ops.push(setFontAndSize(fontKey, el.fontSize), showText(font.encodeText(line)));
    }
    ops.push(endText(), popGraphicsState());
    page.pushOperators(...ops);
    if (el.underline && lineWidth > 0) {
      const thickness = Math.max(0.5, el.fontSize * 0.06);
      const bar: Rect = { x: lx, y: ly + el.fontSize * 0.12, width: lineWidth, height: thickness };
      drawPolygon(page, g, rectCorners(bar, 0).map((p) => rotatePoint(p, center, el.rotation)), {
        fill: el.color,
        opacity: el.opacity,
      });
    }
  }
}
