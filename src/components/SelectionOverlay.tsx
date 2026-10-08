import { useMemo, useRef, type CSSProperties } from 'react';
import type { EditorElement, EditorPage, LineElement, Point } from '../editor/types';
import { getState, useEditor } from '../editor/store';
import { commitFrom, updateElement } from '../editor/actions';
import { dragGesture } from '../editor/interaction';
import { boundsOf, rectCenter } from '../pdf/geometry';
import { lineEndpoints } from '../pdf/shapes';

type Handle = { hx: -1 | 0 | 1; hy: -1 | 0 | 1 };
const ALL_HANDLES: Handle[] = [
  { hx: -1, hy: -1 }, { hx: 0, hy: -1 }, { hx: 1, hy: -1 },
  { hx: -1, hy: 0 }, { hx: 1, hy: 0 },
  { hx: -1, hy: 1 }, { hx: 0, hy: 1 }, { hx: 1, hy: 1 },
];
const CORNERS = ALL_HANDLES.filter((h) => h.hx && h.hy);
const SIDES_X = ALL_HANDLES.filter((h) => h.hy === 0);
const MIN_SIZE = 4;

export function SelectionOverlay({ page, scale }: { page: EditorPage; pageIndex: number; scale: number }) {
  const selectedIds = useEditor((s) => s.selectedIds);
  const editingId = useEditor((s) => s.editingId);
  const tool = useEditor((s) => s.tool);
  const ref = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => {
    if (!selectedIds.length) return [];
    const set = new Set(selectedIds);
    return page.elements.filter((e) => set.has(e.id));
  }, [page.elements, selectedIds]);

  if (!selected.length || tool !== 'select') return null;
  const single = selected.length === 1 ? selected[0] : null;

  return (
    <div className="sel-overlay" ref={ref}>
      {selected.map((el) => (
        <div
          key={el.id}
          className={`sel-box${editingId === el.id ? ' is-editing' : ''}`}
          style={boxStyle(el, scale)}
        >
          {single && editingId !== el.id && <Handles el={el} scale={scale} overlay={ref} />}
        </div>
      ))}
    </div>
  );
}

function boxStyle(el: EditorElement, scale: number): CSSProperties {
  return {
    left: el.x * scale,
    top: el.y * scale,
    width: el.width * scale,
    height: el.height * scale,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
  };
}

function handlesFor(el: EditorElement): { resize: Handle[]; rotate: boolean; endpoints: boolean; aspect: boolean } {
  switch (el.type) {
    case 'text':
      return { resize: SIDES_X, rotate: true, endpoints: false, aspect: false };
    case 'line':
      return { resize: [], rotate: false, endpoints: true, aspect: false };
    case 'markup':
      return { resize: el.rects.length === 1 ? ALL_HANDLES : [], rotate: false, endpoints: false, aspect: false };
    case 'checkbox':
      return { resize: CORNERS, rotate: true, endpoints: false, aspect: true };
    case 'image':
      return { resize: ALL_HANDLES, rotate: true, endpoints: false, aspect: true };
    default:
      return { resize: ALL_HANDLES, rotate: true, endpoints: false, aspect: false };
  }
}

function Handles({ el, scale, overlay }: { el: EditorElement; scale: number; overlay: React.RefObject<HTMLDivElement | null> }) {
  const spec = handlesFor(el);

  const startResize = (e: React.PointerEvent, h: Handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const before = getState().pages;
    const start = el;
    const startCenter = rectCenter(start);
    const theta = (start.rotation * Math.PI) / 180;
    dragGesture(e, {
      threshold: 0,
      onMove: (dxPx, dyPx, ev) => {
        const dx = dxPx / scale;
        const dy = dyPx / scale;
        // Pointer delta in the element's local (unrotated) frame.
        const lx = dx * Math.cos(-theta) - dy * Math.sin(-theta);
        const ly = dx * Math.sin(-theta) + dy * Math.cos(-theta);
        let nw = start.width + h.hx * lx;
        let nh = start.height + h.hy * ly;
        const keepAspect = spec.aspect ? !ev.altKey : ev.shiftKey;
        if (keepAspect && h.hx && h.hy) {
          const ratio = start.width / start.height;
          if (Math.abs(nw / start.width - 1) > Math.abs(nh / start.height - 1)) nh = nw / ratio;
          else nw = nh * ratio;
        } else if (keepAspect && spec.aspect) {
          const ratio = start.width / start.height;
          if (h.hx) nh = nw / ratio;
          else nw = nh * ratio;
        }
        nw = Math.max(MIN_SIZE, nw);
        nh = Math.max(MIN_SIZE, nh);
        const sx = (h.hx * (nw - start.width)) / 2;
        const sy = (h.hy * (nh - start.height)) / 2;
        const cx = startCenter.x + sx * Math.cos(theta) - sy * Math.sin(theta);
        const cy = startCenter.y + sx * Math.sin(theta) + sy * Math.cos(theta);
        const patch: Partial<EditorElement> = { x: cx - nw / 2, y: cy - nh / 2, width: nw, height: nh };
        if (start.type === 'markup') {
          (patch as { rects: { x: number; y: number; width: number; height: number }[] }).rects = [
            { x: patch.x!, y: patch.y!, width: nw, height: nh },
          ];
        }
        if (start.type === 'text') {
          // Height follows content; manual resizing switches off auto width.
          patch.y = start.y;
          patch.x = h.hx < 0 ? start.x + start.width - nw : start.x;
          delete patch.height;
          (patch as { autoWidth?: boolean }).autoWidth = false;
        }
        updateElement(start.id, patch, { transient: true });
      },
      onEnd: (moved) => moved && commitFrom(before),
    });
  };

  const startRotate = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const before = getState().pages;
    const rect = overlay.current?.getBoundingClientRect();
    if (!rect) return;
    const center = rectCenter(el);
    const cx = rect.left + center.x * scale;
    const cy = rect.top + center.y * scale;
    dragGesture(e, {
      threshold: 0,
      onMove: (_dx, _dy, ev) => {
        let angle = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
        if (ev.shiftKey) angle = Math.round(angle / 15) * 15;
        angle = ((Math.round(angle * 10) / 10) % 360 + 360) % 360;
        updateElement(el.id, { rotation: angle }, { transient: true });
      },
      onEnd: (moved) => moved && commitFrom(before),
    });
  };

  const startEndpoint = (e: React.PointerEvent, which: 'from' | 'to') => {
    if (e.button !== 0 || el.type !== 'line') return;
    e.stopPropagation();
    e.preventDefault();
    const before = getState().pages;
    const { from, to } = lineEndpoints(el);
    dragGesture(e, {
      threshold: 0,
      onMove: (dxPx, dyPx, ev) => {
        const d = { x: dxPx / scale, y: dyPx / scale };
        let a = which === 'from' ? { x: from.x + d.x, y: from.y + d.y } : from;
        let b = which === 'to' ? { x: to.x + d.x, y: to.y + d.y } : to;
        if (ev.shiftKey) {
          const fixed = which === 'from' ? b : a;
          const moving = which === 'from' ? a : b;
          const ang = Math.atan2(moving.y - fixed.y, moving.x - fixed.x);
          const snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(moving.x - fixed.x, moving.y - fixed.y);
          const np = { x: fixed.x + Math.cos(snapped) * len, y: fixed.y + Math.sin(snapped) * len };
          if (which === 'from') a = np;
          else b = np;
        }
        updateElement(el.id, lineFromPoints(a, b), { transient: true });
      },
      onEnd: (moved) => moved && commitFrom(before),
    });
  };

  const w = el.width * scale;
  const h = el.height * scale;
  return (
    <>
      {spec.resize.map((hd) => (
        <div
          key={`${hd.hx}${hd.hy}`}
          className={`handle h-${hd.hx}-${hd.hy}`}
          style={{ left: ((hd.hx + 1) / 2) * w, top: ((hd.hy + 1) / 2) * h, cursor: cursorFor(hd, el.rotation) }}
          onPointerDown={(e) => startResize(e, hd)}
        />
      ))}
      {spec.endpoints && el.type === 'line' && (
        <>
          <div className="handle h-end" style={{ left: el.start.x * w, top: el.start.y * h }} onPointerDown={(e) => startEndpoint(e, 'from')} />
          <div className="handle h-end" style={{ left: el.end.x * w, top: el.end.y * h }} onPointerDown={(e) => startEndpoint(e, 'to')} />
        </>
      )}
      {spec.rotate && (
        <>
          <div className="rotate-stem" style={{ left: w / 2 }} />
          <div className="handle h-rotate" style={{ left: w / 2 }} onPointerDown={startRotate} title="Drag to rotate (Shift snaps to 15°)" />
        </>
      )}
    </>
  );
}

function lineFromPoints(a: Point, b: Point): Partial<LineElement> {
  const bounds = boundsOf([a, b]);
  const w = Math.max(bounds.width, 0.01);
  const h = Math.max(bounds.height, 0.01);
  return {
    x: bounds.x,
    y: bounds.y,
    width: w,
    height: h,
    rotation: 0,
    start: { x: (a.x - bounds.x) / w, y: (a.y - bounds.y) / h },
    end: { x: (b.x - bounds.x) / w, y: (b.y - bounds.y) / h },
  };
}

const CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
function cursorFor(h: Handle, rotation: number): string {
  // Base direction index: 0=N/S, 1=NE/SW, 2=E/W, 3=NW/SE, then rotate by 45° steps.
  let idx: number;
  if (h.hx === 0) idx = 0;
  else if (h.hy === 0) idx = 2;
  else idx = h.hx === h.hy ? 3 : 1;
  const steps = Math.round((((rotation % 360) + 360) % 360) / 45);
  return CURSORS[(idx + steps) % 4];
}
