/**
 * Geometry shared between the on-screen SVG renderer and the PDF export so
 * both produce identical results.
 */
import type { CheckboxElement, LineElement, PathElement, Point, Rect } from '../editor/types';
import { rectCenter, rotatePoint } from './geometry';

const KAPPA = 0.5522847498;

export interface EllipseSegments {
  start: Point;
  curves: [Point, Point, Point][];
}

/** Ellipse inscribed in `r`, rotated about the rect centre. */
export function ellipsePath(r: Rect, rotation: number): EllipseSegments {
  const c = rectCenter(r);
  const rx = r.width / 2;
  const ry = r.height / 2;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  const t = (p: Point) => rotatePoint(p, c, rotation);
  return {
    start: t({ x: c.x + rx, y: c.y }),
    curves: [
      [t({ x: c.x + rx, y: c.y + oy }), t({ x: c.x + ox, y: c.y + ry }), t({ x: c.x, y: c.y + ry })],
      [t({ x: c.x - ox, y: c.y + ry }), t({ x: c.x - rx, y: c.y + oy }), t({ x: c.x - rx, y: c.y })],
      [t({ x: c.x - rx, y: c.y - oy }), t({ x: c.x - ox, y: c.y - ry }), t({ x: c.x, y: c.y - ry })],
      [t({ x: c.x + ox, y: c.y - ry }), t({ x: c.x + rx, y: c.y - oy }), t({ x: c.x + rx, y: c.y })],
    ],
  };
}

export function ellipseSvgPath(r: Rect, rotation: number): string {
  const e = ellipsePath(r, rotation);
  let d = `M ${f(e.start.x)} ${f(e.start.y)}`;
  for (const [c1, c2, p] of e.curves) d += ` C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p.x)} ${f(p.y)}`;
  return `${d} Z`;
}

const f = (n: number) => Math.round(n * 100) / 100;

/** Absolute endpoints of a line element (with element rotation applied). */
export function lineEndpoints(el: LineElement): { from: Point; to: Point } {
  const c = rectCenter(el);
  return {
    from: rotatePoint({ x: el.x + el.start.x * el.width, y: el.y + el.start.y * el.height }, c, el.rotation),
    to: rotatePoint({ x: el.x + el.end.x * el.width, y: el.y + el.end.y * el.height }, c, el.rotation),
  };
}

/** Filled triangle for an arrow head at `to`, pointing away from `from`. */
export function arrowHead(from: Point, to: Point, strokeWidth: number): Point[] {
  const len = Math.max(9, strokeWidth * 4.5);
  const width = len * 0.6;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const bx = to.x - ux * len;
  const by = to.y - uy * len;
  return [
    { x: to.x + ux * strokeWidth * 0.5, y: to.y + uy * strokeWidth * 0.5 },
    { x: bx - uy * width * 0.5, y: by + ux * width * 0.5 },
    { x: bx + uy * width * 0.5, y: by - ux * width * 0.5 },
  ];
}

/** Absolute points of every stroke of a path element. */
export function pathStrokes(el: PathElement): Point[][] {
  const c = rectCenter(el);
  return el.strokes.map((stroke) => {
    const pts: Point[] = [];
    for (let i = 0; i + 1 < stroke.length; i += 2) {
      pts.push(rotatePoint({ x: el.x + stroke[i] * el.width, y: el.y + stroke[i + 1] * el.height }, c, el.rotation));
    }
    return pts;
  });
}

export type PathSegment = { kind: 'line'; to: Point } | { kind: 'cubic'; c1: Point; c2: Point; to: Point };

/**
 * Smooth a polyline with quadratic curves through midpoints, expressed as
 * cubic segments (PDF has no quadratic operator).
 */
export function smoothPathSegments(pts: Point[]): PathSegment[] {
  const segs: PathSegment[] = [];
  if (pts.length < 3) {
    for (let i = 1; i < pts.length; i++) segs.push({ kind: 'line', to: pts[i] });
    return segs;
  }
  let prev = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const ctrl = pts[i];
    const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    segs.push({
      kind: 'cubic',
      c1: { x: prev.x + (2 / 3) * (ctrl.x - prev.x), y: prev.y + (2 / 3) * (ctrl.y - prev.y) },
      c2: { x: mid.x + (2 / 3) * (ctrl.x - mid.x), y: mid.y + (2 / 3) * (ctrl.y - mid.y) },
      to: mid,
    });
    prev = mid;
  }
  segs.push({ kind: 'line', to: pts[pts.length - 1] });
  return segs;
}

export function pathSvg(pts: Point[]): string {
  if (!pts.length) return '';
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
  for (const s of smoothPathSegments(pts)) {
    d += s.kind === 'line' ? ` L ${f(s.to.x)} ${f(s.to.y)}` : ` C ${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.to.x)} ${f(s.to.y)}`;
  }
  return d;
}

export interface CheckboxGeometry {
  box: Point[] | null;
  circle: Rect | null;
  dot: Rect | null;
  strokes: Point[][];
  boxStroke: number;
  markStroke: number;
}

export function checkboxGeometry(el: CheckboxElement): CheckboxGeometry {
  const c = rectCenter(el);
  const s = Math.min(el.width, el.height);
  const t = (nx: number, ny: number) => rotatePoint({ x: el.x + nx * el.width, y: el.y + ny * el.height }, c, el.rotation);
  const boxStroke = Math.max(0.8, s * 0.08);
  const markStroke = Math.max(1, s * 0.13);
  const geo: CheckboxGeometry = { box: null, circle: null, dot: null, strokes: [], boxStroke, markStroke };
  if (el.style === 'radio') {
    geo.circle = { x: el.x, y: el.y, width: el.width, height: el.height };
    if (el.checked) {
      geo.dot = { x: el.x + el.width * 0.27, y: el.y + el.height * 0.27, width: el.width * 0.46, height: el.height * 0.46 };
    }
    return geo;
  }
  geo.box = [t(0, 0), t(1, 0), t(1, 1), t(0, 1)];
  if (el.checked) {
    if (el.style === 'check') geo.strokes.push([t(0.22, 0.53), t(0.42, 0.74), t(0.8, 0.28)]);
    else geo.strokes.push([t(0.25, 0.25), t(0.75, 0.75)], [t(0.75, 0.25), t(0.25, 0.75)]);
  }
  return geo;
}
