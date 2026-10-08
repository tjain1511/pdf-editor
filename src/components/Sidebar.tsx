import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  deletePage,
  duplicatePage,
  extractPage,
  insertBlankPage,
  movePage,
  rotatePage,
  setCurrentPage,
} from '../editor/actions';
import { getState, useEditor } from '../editor/store';
import type { EditorPage } from '../editor/types';
import { pageSize, totalRotation } from '../editor/pageUtils';
import { displayKey, getDisplayPage } from '../pdf/displayPage';
import { renderToCanvas } from '../pdf/renderer';
import { viewerController } from '../editor/interaction';
import { useVisible } from '../hooks/useVisible';
import { Icon } from './Icons';
import { Menu, MenuItem, ToolButton } from './controls';

const THUMB_WIDTH = 132;
/** Pointer travel before a press turns into a drag. */
const DRAG_THRESHOLD = 5;
/** Distance from the list edge within which dragging auto-scrolls. */
const SCROLL_ZONE = 48;
const SCROLL_MAX_SPEED = 14;

interface DragState {
  /** Index of the page being dragged. */
  from: number;
  /** Insertion index among the original pages (see movePage). */
  to: number;
  /** Translation of the dragged card relative to its slot. */
  dx: number;
  dy: number;
  /** Height of the dragged slot plus the list gap: how far neighbours slide. */
  shift: number;
}

interface SlotMetrics {
  /** Top and height in list content coordinates (independent of scrolling). */
  top: number;
  height: number;
}

/** Move a page one step up or down, keeping it current. */
function nudgePage(index: number, delta: -1 | 1): void {
  const n = getState().pages.length;
  const target = index + delta;
  if (target < 0 || target >= n) return;
  movePage(index, delta < 0 ? target : target + 1);
}

export function Sidebar({ onInsertPdf }: { onInsertPdf: (index: number) => void }) {
  const pages = useEditor((s) => s.pages);
  const current = useEditor((s) => s.currentPage);
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const session = useRef<{
    index: number;
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    active: boolean;
    slots: SlotMetrics[];
    gap: number;
    raf: number;
    target: HTMLElement;
  } | null>(null);

  // Keep the current page thumbnail in view (not while dragging: the list scrolls under the pointer).
  useEffect(() => {
    if (dragRef.current) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-thumb-index="${current}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const update = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  /** Recompute the drop position and card offset from the last pointer position. */
  const recompute = useCallback(() => {
    const s = session.current;
    const list = listRef.current;
    if (!s || !list || !s.active) return;
    const listRect = list.getBoundingClientRect();
    // The card is locked to the vertical axis and never leaves the visible part of the list.
    const y = Math.min(listRect.bottom, Math.max(listRect.top, s.lastY));
    const pointerY = y - listRect.top + list.scrollTop;
    const from = s.index;
    const own = s.slots[from];
    // Count the other slots whose centre is above the pointer: that is the drop position among them.
    let p = 0;
    for (let i = 0; i < s.slots.length; i++) {
      if (i === from) continue;
      const m = s.slots[i];
      if (m.top + m.height / 2 < pointerY) p++;
    }
    const to = p <= from ? p : p + 1;
    update({
      from,
      to,
      dx: 0,
      dy: y - s.startY,
      shift: own.height + s.gap,
    });
  }, [update]);

  /** Scroll the list when the pointer is near its top or bottom edge. */
  const autoScroll = useCallback(() => {
    const s = session.current;
    const list = listRef.current;
    if (!s || !list || !s.active) return;
    const r = list.getBoundingClientRect();
    let v = 0;
    if (s.lastY < r.top + SCROLL_ZONE) v = -SCROLL_MAX_SPEED * Math.min(1, (r.top + SCROLL_ZONE - s.lastY) / SCROLL_ZONE);
    else if (s.lastY > r.bottom - SCROLL_ZONE) v = SCROLL_MAX_SPEED * Math.min(1, (s.lastY - (r.bottom - SCROLL_ZONE)) / SCROLL_ZONE);
    if (v !== 0) {
      const before = list.scrollTop;
      list.scrollTop += v;
      if (list.scrollTop !== before) {
        // The card is positioned relative to its slot, which just moved with the content.
        s.startY -= list.scrollTop - before;
        recompute();
      }
    }
    s.raf = requestAnimationFrame(autoScroll);
  }, [recompute]);

  const finish = useCallback(
    (commit: boolean) => {
      const s = session.current;
      if (!s) return;
      cancelAnimationFrame(s.raf);
      if (s.target.hasPointerCapture(s.pointerId)) s.target.releasePointerCapture(s.pointerId);
      const d = dragRef.current;
      session.current = null;
      update(null);
      document.body.classList.remove('is-reordering');
      if (commit && d && d.to !== d.from && d.to !== d.from + 1) movePage(d.from, d.to);
    },
    [update],
  );

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    const target = e.target as HTMLElement;
    // Buttons and menus inside the card keep their own behaviour.
    if (target.closest('.thumb-actions, .popover')) return;
    session.current = {
      index,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      active: false,
      slots: [],
      gap: 0,
      raf: 0,
      target: e.currentTarget,
    };
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = session.current;
      const list = listRef.current;
      if (!s || !list || e.pointerId !== s.pointerId) return;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      if (!s.active) {
        if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < DRAG_THRESHOLD) return;
        // Lift the card: measure every slot once, in content coordinates.
        const listRect = list.getBoundingClientRect();
        const slotEls = Array.from(list.querySelectorAll<HTMLElement>('.thumb-slot'));
        s.slots = slotEls.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top - listRect.top + list.scrollTop, height: r.height };
        });
        s.gap = parseFloat(getComputedStyle(list).rowGap || getComputedStyle(list).gap) || 0;
        s.active = true;
        s.target.setPointerCapture(e.pointerId);
        document.body.classList.add('is-reordering');
        setCurrentPage(s.index);
        s.raf = requestAnimationFrame(autoScroll);
      }
      recompute();
    },
    [autoScroll, recompute],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = session.current;
      if (!s || e.pointerId !== s.pointerId) return;
      if (!s.active) {
        session.current = null;
        return;
      }
      finish(true);
    },
    [finish],
  );

  const onPointerCancel = useCallback(() => finish(false), [finish]);

  // Escape cancels an in-progress drag; a click that ends a drag must not select the page.
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish(false);
      }
    };
    const swallowClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', swallowClick, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Let the click that ends the drag through the capture handler before removing it.
      setTimeout(() => document.removeEventListener('click', swallowClick, true), 0);
    };
  }, [drag, finish]);

  const slotStyle = (index: number): { transform?: string } | undefined => {
    if (!drag) return undefined;
    if (index === drag.from) return { transform: `translate(${drag.dx}px, ${drag.dy}px)` };
    // Neighbours slide to open a gap where the card will land.
    if (index > drag.from && index < drag.to) return { transform: `translateY(${-drag.shift}px)` };
    if (index < drag.from && index >= drag.to) return { transform: `translateY(${drag.shift}px)` };
    return undefined;
  };

  return (
    <aside className="sidebar" aria-label="Pages">
      <div className="sidebar-head">
        <span>{pages.length} page{pages.length === 1 ? '' : 's'}</span>
        <Menu label="Add pages" trigger={() => <ToolButton icon="plus" label="Add pages" />}>
          {(close) => (
            <>
              <MenuItem icon="file" label="Blank page at end" onClick={() => { insertBlankPage(pages.length); close(); }} />
              <MenuItem icon="file" label="Blank page after current" onClick={() => { insertBlankPage(current + 1); close(); }} />
              <MenuItem icon="upload" label="Insert pages from PDF…" onClick={() => { onInsertPdf(current + 1); close(); }} />
            </>
          )}
        </Menu>
      </div>
      <div className={`thumb-list${drag ? ' is-dragging' : ''}`} ref={listRef} role="list">
        {pages.map((page, index) => (
          <div
            key={page.id}
            className={`thumb-slot${drag?.from === index ? ' is-lifted' : ''}`}
            style={slotStyle(index)}
            role="listitem"
            onPointerDown={(e) => onPointerDown(e, index)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          >
            <Thumbnail page={page} index={index} count={pages.length} active={index === current} onInsertPdf={onInsertPdf} />
          </div>
        ))}
      </div>
      <div className="sidebar-hint" aria-hidden="true">
        {drag ? 'Release to move · Esc to cancel' : 'Drag pages to reorder'}
      </div>
    </aside>
  );
}

const Thumbnail = memo(function Thumbnail({
  page,
  index,
  count,
  active,
  onInsertPdf,
}: {
  page: EditorPage;
  index: number;
  count: number;
  active: boolean;
  onInsertPdf: (index: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visible = useVisible(ref, '.thumb-list', '200% 0px');
  const { width, height } = pageSize(page);
  const scale = THUMB_WIDTH / width;
  const rotation = totalRotation(page);
  const sourceKey = displayKey(page);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible || !page.source) return;
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    getDisplayPage(page)
      .then((pdfPage) => {
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale, rotation });
        const t = renderToCanvas(pdfPage, canvas, viewport, Math.min(2, window.devicePixelRatio || 1));
        task = t;
        return t.promise;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      task?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, sourceKey, rotation, scale]);

  const activate = () => {
    setCurrentPage(index);
    viewerController.scrollToPage(index);
  };

  const focusThumb = (i: number) => {
    ref.current?.closest('.thumb-list')?.querySelector<HTMLElement>(`[data-thumb-index="${i}"] .thumb-page`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    // Keep the global shortcut from also nudging a selected element.
    e.stopPropagation();
    const delta = e.key === 'ArrowUp' ? -1 : 1;
    if (e.altKey || e.metaKey || e.ctrlKey) {
      // Modifier + arrow moves the page; focus follows it because the component keeps its key.
      nudgePage(index, delta);
      return;
    }
    const next = index + delta;
    if (next < 0 || next >= count) return;
    setCurrentPage(next);
    viewerController.scrollToPage(next);
    focusThumb(next);
  };

  return (
    <div ref={ref} className={`thumb${active ? ' is-active' : ''}`} data-thumb-index={index}>
      <button
        type="button"
        className="thumb-page"
        style={{ width: THUMB_WIDTH, height: Math.round(height * scale) }}
        onClick={activate}
        onKeyDown={onKeyDown}
        aria-label={`Page ${index + 1} of ${count}. Arrow keys select pages, Alt+Arrow moves this page.`}
        aria-current={active ? 'page' : undefined}
      >
        {page.source ? <canvas ref={canvasRef} /> : <span className="thumb-blank">Blank</span>}
        {page.elements.length > 0 && <span className="thumb-badge" title={`${page.elements.length} edits`}>{page.elements.length}</span>}
      </button>
      <div className="thumb-foot">
        <span className="thumb-num">{index + 1}</span>
        {active ? (
          <span className="thumb-actions">
            <ToolButton icon="rotate-left" label="Rotate left" onClick={() => rotatePage(index, -90)} />
            <ToolButton icon="rotate-right" label="Rotate right" onClick={() => rotatePage(index, 90)} />
            <Menu label={`Page ${index + 1} actions`} trigger={() => <ToolButton icon="more" label="Page actions" />}>
              {(close) => (
                <>
                  <MenuItem icon="chevron-up" label="Move up" shortcut="Alt+↑" disabled={index === 0} onClick={() => { nudgePage(index, -1); close(); }} />
                  <MenuItem icon="chevron-down" label="Move down" shortcut="Alt+↓" disabled={index === count - 1} onClick={() => { nudgePage(index, 1); close(); }} />
                  <div className="menu-sep" />
                  <MenuItem icon="duplicate" label="Duplicate page" onClick={() => { duplicatePage(index); close(); }} />
                  <MenuItem icon="plus" label="Insert blank page after" onClick={() => { insertBlankPage(index + 1); close(); }} />
                  <MenuItem icon="upload" label="Insert PDF after…" onClick={() => { onInsertPdf(index + 1); close(); }} />
                  <MenuItem icon="extract" label="Extract page as PDF" onClick={() => { void extractPage(index); close(); }} />
                  <div className="menu-sep" />
                  <MenuItem icon="trash" label="Delete page" danger onClick={() => { deletePage(index); close(); }} />
                </>
              )}
            </Menu>
          </span>
        ) : (
          <span className="thumb-grip" title="Drag to reorder">
            <Icon name="drag" size={14} />
          </span>
        )}
      </div>
    </div>
  );
});
