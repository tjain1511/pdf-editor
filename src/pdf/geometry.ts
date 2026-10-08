/**
 * Coordinate transforms between the visual (rotated, y-down, origin top-left)
 * page space used by the editor and PDF user space. Mirrors pdf.js'
 * PageViewport maths so that editor coordinates match what pdf.js rendered.
 */
import type { Point, Rect } from '../editor/types';

export type Matrix = [number, number, number, number, number, number];

export interface PageGeometry {
  /** Visual page width in points. */
  width: number;
  /** Visual page height in points. */
  height: number;
  /** Visual -> PDF user space. */
  toPdf(x: number, y: number): [number, number];
  /** PDF user space -> visual. */
  toVisual(x: number, y: number): [number, number];
  /** Transform a direction vector (no translation) from visual to PDF space. */
  dirToPdf(dx: number, dy: number): [number, number];
}

export function normalizeRotation(rotation: number): number {
  const r = rotation % 360;
  return r < 0 ? r + 360 : r;
}

export function createPageGeometry(view: readonly number[], rotation: number): PageGeometry {
  const [x0, y0, x1, y1] = view;
  const centerX = (x1 + x0) / 2;
  const centerY = (y1 + y0) / 2;
  let a: number, b: number, c: number, d: number;
  switch (normalizeRotation(rotation)) {
    case 180:
      a = -1; b = 0; c = 0; d = 1;
      break;
    case 90:
      a = 0; b = 1; c = 1; d = 0;
      break;
    case 270:
      a = 0; b = -1; c = -1; d = 0;
      break;
    default:
      a = 1; b = 0; c = 0; d = -1;
  }
  let offX: number, offY: number, width: number, height: number;
  if (a === 0) {
    offX = Math.abs(centerY - y0);
    offY = Math.abs(centerX - x0);
    width = Math.abs(y1 - y0);
    height = Math.abs(x1 - x0);
  } else {
    offX = Math.abs(centerX - x0);
    offY = Math.abs(centerY - y0);
    width = Math.abs(x1 - x0);
    height = Math.abs(y1 - y0);
  }
  const m: Matrix = [a, b, c, d, offX - a * centerX - c * centerY, offY - b * centerX - d * centerY];
  const inv = invert(m);
  return {
    width,
    height,
    toPdf: (x, y) => apply(inv, x, y),
    toVisual: (x, y) => apply(m, x, y),
    dirToPdf: (dx, dy) => [inv[0] * dx + inv[2] * dy, inv[1] * dx + inv[3] * dy],
  };
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** Rotate a point around a centre by `deg` degrees (clockwise in y-down space). */
export function rotatePoint(p: Point, center: Point, deg: number): Point {
  if (!deg) return { x: p.x, y: p.y };
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Four corners of a rect after rotation, in order TL, TR, BR, BL. */
export function rectCorners(r: Rect, rotation: number): Point[] {
  const c = rectCenter(r);
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ].map((p) => rotatePoint(p, c, rotation));
}

export function boundsOf(points: Point[]): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function unionRects(rects: Rect[]): Rect {
  return boundsOf(rects.flatMap((r) => [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y + r.height }]));
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
