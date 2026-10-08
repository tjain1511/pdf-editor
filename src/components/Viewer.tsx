import { useEffect, useLayoutEffect, useRef } from 'react';
import { clearSelection, effectiveZoom, setContainerSize, setCurrentPage, setZoom, stopEditing, MAX_ZOOM, MIN_ZOOM } from '../editor/actions';
import { getState, useEditor } from '../editor/store';
import { viewerController } from '../editor/interaction';
import { PageView } from './PageView';

const PAGE_GAP = 24;

export function Viewer() {
  const pages = useEditor((s) => s.pages);
  const scale = useEditor((s) => effectiveZoom(s.zoomMode, s.zoom, s.pages, s.containerSize));
  const zoomMode = useEditor((s) => s.zoomMode);
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingAnchor = useRef<{ x: number; y: number; oldScale: number } | null>(null);
  const prevScale = useRef(scale);

  // Track container size for fit-to-width / fit-to-page.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerSize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    setContainerSize(el.clientWidth, el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Keep the point under the cursor fixed when zooming.
  useLayoutEffect(() => {
    const el = ref.current;
    const anchor = pendingAnchor.current;
    if (el && anchor && prevScale.current !== scale) {
      const ratio = scale / anchor.oldScale;
      el.scrollTop = (el.scrollTop + anchor.y) * ratio - anchor.y;
      el.scrollLeft = (el.scrollLeft + anchor.x) * ratio - anchor.x;
    } else if (el && prevScale.current !== scale && zoomMode === 'custom') {
      // Explicit zoom without a pointer position: keep the viewport centre fixed.
      const ratio = scale / prevScale.current;
      el.scrollTop = (el.scrollTop + el.clientHeight / 2) * ratio - el.clientHeight / 2;
    }
    pendingAnchor.current = null;
    prevScale.current = scale;
  }, [scale, zoomMode]);

  // Ctrl/⌘ + wheel zoom and two-finger pinch.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const currentScale = () => {
      const s = getState();
      return effectiveZoom(s.zoomMode, s.zoom, s.pages, s.containerSize);
    };
    const zoomAt = (clientX: number, clientY: number, factor: number) => {
      const rect = el.getBoundingClientRect();
      const old = currentScale();
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, old * factor));
      if (Math.abs(next - old) < 0.0001) return;
      pendingAnchor.current = { x: clientX - rect.left, y: clientY - rect.top, oldScale: old };
      setZoom(next);
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022));
      zoomAt(e.clientX, e.clientY, factor);
    };
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchStart: { dist: number; scale: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: currentScale() };
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinchStart && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const target = pinchStart.scale * (dist / pinchStart.dist);
        const old = currentScale();
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, target / old);
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, []);

  // Determine the current page from the scroll position.
  useEffect(() => {
    const el = ref.current;
    const content = contentRef.current;
    if (!el || !content) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const mid = el.scrollTop + el.clientHeight / 2;
      const children = content.children;
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < children.length; i++) {
        const c = children[i] as HTMLElement;
        const center = c.offsetTop + c.offsetHeight / 2;
        const dist = Math.abs(center - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        } else if (center > mid) break;
      }
      setCurrentPage(best);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    viewerController.scrollToPage = (index) => {
      const el = ref.current;
      const child = contentRef.current?.children[index] as HTMLElement | undefined;
      if (!el || !child) return;
      el.scrollTo({ top: child.offsetTop - PAGE_GAP / 2, behavior: 'auto' });
    };
    viewerController.scrollToRect = (index, rect) => {
      const el = ref.current;
      const child = contentRef.current?.children[index] as HTMLElement | undefined;
      if (!el || !child) return;
      const s = getState();
      const z = effectiveZoom(s.zoomMode, s.zoom, s.pages, s.containerSize);
      const top = child.offsetTop + rect.y * z;
      const left = child.offsetLeft + rect.x * z;
      if (top < el.scrollTop + 40 || top + rect.height * z > el.scrollTop + el.clientHeight - 40) {
        el.scrollTo({ top: top - el.clientHeight / 2, behavior: 'smooth' });
      }
      if (left < el.scrollLeft || left > el.scrollLeft + el.clientWidth) el.scrollLeft = left - el.clientWidth / 2;
    };
    viewerController.zoomAtCenter = (direction) => {
      const s = getState();
      const old = effectiveZoom(s.zoomMode, s.zoom, s.pages, s.containerSize);
      pendingAnchor.current = null;
      setZoom(direction > 0 ? old * 1.25 : old / 1.25);
    };
  }, []);

  return (
    <div
      className="viewer"
      ref={ref}
      onPointerDown={(e) => {
        // Clicks on the grey background clear the selection.
        if (e.target === ref.current || e.target === contentRef.current) {
          stopEditing();
          clearSelection();
        }
      }}
    >
      <div className="viewer-content" ref={contentRef} style={{ gap: PAGE_GAP, padding: PAGE_GAP }}>
        {pages.map((page, index) => (
          <PageView key={page.id} page={page} pageIndex={index} scale={scale} />
        ))}
      </div>
    </div>
  );
}
