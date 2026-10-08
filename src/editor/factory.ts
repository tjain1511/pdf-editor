import { newId } from './assets';
import type {
  CheckboxElement,
  CoverElement,
  EditorElement,
  ImageElement,
  LineElement,
  MarkupElement,
  MarkupKind,
  PathElement,
  Point,
  Rect,
  ShapeElement,
  TextElement,
  ToolSettings,
} from './types';
import { layoutText } from '../pdf/fonts';
import { boundsOf } from '../pdf/geometry';

const base = (r: Rect) => ({ id: newId(), x: r.x, y: r.y, width: r.width, height: r.height, rotation: 0, opacity: 1 });

export function createText(r: Rect, s: ToolSettings, overrides: Partial<TextElement> = {}): TextElement {
  const el: TextElement = {
    ...base(r),
    type: 'text',
    text: '',
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    color: s.textColor,
    lineHeight: 1.2,
    background: null,
    hScale: 1,
    autoWidth: false,
    embeddedFont: null,
    ...overrides,
  };
  el.height = layoutText(el).height;
  return el;
}

export function createImage(r: Rect, assetId: string): ImageElement {
  return { ...base(r), type: 'image', assetId };
}

/** Build a path element from absolute page points (one or more strokes). */
export function createPath(strokes: Point[][], s: ToolSettings, kind: PathElement['kind'] = 'ink'): PathElement {
  const b = boundsOf(strokes.flat());
  // Give degenerate strokes (dots, straight lines) a usable bounding box.
  const pad = Math.max(s.strokeWidth, 2);
  const rect = { x: b.x - pad, y: b.y - pad, width: Math.max(b.width, 0.01) + pad * 2, height: Math.max(b.height, 0.01) + pad * 2 };
  const norm = strokes.map((stroke) => {
    const out: number[] = [];
    for (const p of stroke) out.push((p.x - rect.x) / rect.width, (p.y - rect.y) / rect.height);
    return out;
  });
  return { ...base(rect), type: 'path', strokes: norm, strokeColor: s.strokeColor, strokeWidth: s.strokeWidth, kind };
}

export function createShape(r: Rect, shape: ShapeElement['shape'], s: ToolSettings): ShapeElement {
  return { ...base(r), type: 'shape', shape, strokeColor: s.strokeColor, strokeWidth: s.strokeWidth, fillColor: s.fillColor };
}

export function createLine(from: Point, to: Point, arrow: boolean, s: ToolSettings): LineElement {
  const b = boundsOf([from, to]);
  const w = Math.max(b.width, 0.01);
  const h = Math.max(b.height, 0.01);
  return {
    ...base({ x: b.x, y: b.y, width: w, height: h }),
    type: 'line',
    start: { x: (from.x - b.x) / w, y: (from.y - b.y) / h },
    end: { x: (to.x - b.x) / w, y: (to.y - b.y) / h },
    strokeColor: s.strokeColor,
    strokeWidth: s.strokeWidth,
    arrowEnd: arrow,
    arrowStart: false,
  };
}

export function createMarkup(rects: Rect[], kind: MarkupKind, color: string): MarkupElement {
  const b = boundsOf(rects.flatMap((r) => [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y + r.height }]));
  return { ...base(b), type: 'markup', kind, color, rects, opacity: kind === 'highlight' ? 1 : 1 };
}

export function createCover(r: Rect, color: string): CoverElement {
  return { ...base(r), type: 'cover', color };
}

export function createCheckbox(p: Point, s: ToolSettings, style: CheckboxElement['style'] = 'check'): CheckboxElement {
  const size = 14;
  return { ...base({ x: p.x - size / 2, y: p.y - size / 2, width: size, height: size }), type: 'checkbox', checked: true, style, color: s.textColor };
}

export function cloneElement(el: EditorElement, dx = 0, dy = 0): EditorElement {
  const copy = { ...el, id: newId(), x: el.x + dx, y: el.y + dy } as EditorElement;
  if (copy.type === 'markup') copy.rects = copy.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
  if (copy.type === 'path') copy.strokes = copy.strokes.map((st) => st.slice());
  return copy;
}
