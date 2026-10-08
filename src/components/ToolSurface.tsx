import { useState } from 'react';
import type { EditorPage, Point, Rect, Tool } from '../editor/types';
import { getState, useEditor } from '../editor/store';
import { addElement, clearSelection, setTool, stopEditing } from '../editor/actions';
import { createCheckbox, createCover, createLine, createMarkup, createPath, createShape, createText } from '../editor/factory';
import { dragGesture } from '../editor/interaction';
import { ellipseSvgPath, pathSvg } from '../pdf/shapes';
import { pageSize } from '../editor/pageUtils';

const CREATION_TOOLS = new Set<Tool>(['text', 'draw', 'highlight', 'rect', 'ellipse', 'line', 'arrow', 'cover', 'checkbox']);

type Preview =
  | { kind: 'rect'; rect: Rect; tool: Tool }
  | { kind: 'line'; from: Point; to: Point }
  | { kind: 'path'; points: Point[] };

export function ToolSurface({ page, pageIndex, scale }: { page: EditorPage; pageIndex: number; scale: number }) {
  const tool = useEditor((s) => s.tool);
  const settings = useEditor((s) => s.toolSettings);
  const [preview, setPreview] = useState<Preview | null>(null);
  if (!CREATION_TOOLS.has(tool)) return null;

  const toPage = (e: { clientX: number; clientY: number }, el: HTMLElement): Point => {
    const r = el.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Keep focus where it is: the default mousedown action would blur the text
    // editor that some tools open immediately.
    e.preventDefault();
    const surface = e.currentTarget;
    const p0 = toPage(e, surface);
    stopEditing();
    clearSelection();
    const { width: pw, height: ph } = pageSize(page);

    if (tool === 'text') {
      const lh = settings.fontSize * 1.2;
      const width = Math.min(220, pw - p0.x);
      addElement(pageIndex, createText({ x: p0.x, y: p0.y - lh / 2, width: Math.max(width, 60), height: 0 }, settings), { edit: true });
      setTool('select');
      return;
    }
    if (tool === 'checkbox') {
      addElement(pageIndex, createCheckbox(p0, settings));
      setTool('select');
      return;
    }
    if (tool === 'draw') {
      const points: Point[] = [p0];
      setPreview({ kind: 'path', points });
      dragGesture(e, {
        threshold: 0,
        onMove: (_dx, _dy, ev) => {
          const p = toPage(ev, surface);
          const last = points[points.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) >= 0.75) {
            points.push(p);
            setPreview({ kind: 'path', points: points.slice() });
          }
        },
        onEnd: () => {
          setPreview(null);
          addElement(pageIndex, createPath([points], settings), { select: false });
        },
      });
      return;
    }
    if (tool === 'line' || tool === 'arrow') {
      let to = p0;
      dragGesture(e, {
        onMove: (_dx, _dy, ev) => {
          to = toPage(ev, surface);
          if (ev.shiftKey) to = snapAngle(p0, to);
          setPreview({ kind: 'line', from: p0, to });
        },
        onEnd: (moved) => {
          setPreview(null);
          if (moved) addElement(pageIndex, createLine(p0, to, tool === 'arrow', getState().toolSettings));
        },
      });
      return;
    }
    // Rectangle-based tools.
    let rect: Rect | null = null;
    dragGesture(e, {
      onMove: (_dx, _dy, ev) => {
        let p = toPage(ev, surface);
        p = { x: clamp(p.x, 0, pw), y: clamp(p.y, 0, ph) };
        if (ev.shiftKey) {
          const size = Math.max(Math.abs(p.x - p0.x), Math.abs(p.y - p0.y));
          p = { x: p0.x + Math.sign(p.x - p0.x || 1) * size, y: p0.y + Math.sign(p.y - p0.y || 1) * size };
        }
        rect = normalize(p0, p);
        setPreview({ kind: 'rect', rect, tool });
      },
      onEnd: (moved) => {
        setPreview(null);
        const s = getState().toolSettings;
        if (!moved) {
          if (tool === 'rect' || tool === 'ellipse') {
            addElement(pageIndex, createShape({ x: p0.x - 60, y: p0.y - 40, width: 120, height: 80 }, tool, s));
          }
          return;
        }
        if (!rect || rect.width < 2 || rect.height < 2) return;
        if (tool === 'rect' || tool === 'ellipse') addElement(pageIndex, createShape(rect, tool, s));
        else if (tool === 'cover') addElement(pageIndex, createCover(rect, s.coverColor));
        else if (tool === 'highlight') addElement(pageIndex, createMarkup([rect], 'highlight', s.highlightColor));
      },
    });
  };

  return (
    <div className={`tool-surface tool-${tool}`} onPointerDown={onPointerDown}>
      {preview && (
        <svg className="tool-preview" aria-hidden="true">
          {preview.kind === 'rect' && renderRectPreview(preview, scale, settings)}
          {preview.kind === 'line' && (
            <line
              x1={preview.from.x * scale}
              y1={preview.from.y * scale}
              x2={preview.to.x * scale}
              y2={preview.to.y * scale}
              stroke={settings.strokeColor}
              strokeWidth={settings.strokeWidth * scale}
              strokeLinecap="round"
            />
          )}
          {preview.kind === 'path' && (
            <path
              d={pathSvg(preview.points.map((p) => ({ x: p.x * scale, y: p.y * scale })))}
              fill="none"
              stroke={settings.strokeColor}
              strokeWidth={settings.strokeWidth * scale}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      )}
    </div>
  );
}

function renderRectPreview(p: Extract<Preview, { kind: 'rect' }>, scale: number, s: ReturnType<typeof getState>['toolSettings']) {
  const r = { x: p.rect.x * scale, y: p.rect.y * scale, width: p.rect.width * scale, height: p.rect.height * scale };
  switch (p.tool) {
    case 'ellipse':
      return <path d={ellipseSvgPath(r, 0)} fill={s.fillColor ?? 'none'} stroke={s.strokeColor} strokeWidth={s.strokeWidth * scale} />;
    case 'cover':
      return <rect {...r} fill={s.coverColor} stroke="#888" strokeDasharray="4 3" />;
    case 'highlight':
      return <rect {...r} fill={s.highlightColor} opacity={0.5} />;
    default:
      return <rect {...r} fill={s.fillColor ?? 'none'} stroke={s.strokeColor} strokeWidth={s.strokeWidth * scale} />;
  }
}

function normalize(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

function snapAngle(from: Point, to: Point): Point {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  return { x: from.x + Math.cos(snapped) * len, y: from.y + Math.sin(snapped) * len };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
