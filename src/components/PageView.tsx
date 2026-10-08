import { memo, useEffect, useRef, useState } from 'react';
import type { EditorPage } from '../editor/types';
import { pageSize, totalRotation } from '../editor/pageUtils';
import { displayKey, getDisplayPage } from '../pdf/displayPage';
import { renderToCanvas } from '../pdf/renderer';
import { clearSelection, stopEditing } from '../editor/actions';
import { useEditor } from '../editor/store';
import { useVisible } from '../hooks/useVisible';
import { TextLayer } from './TextLayer';
import { ElementLayer } from './ElementLayer';
import { SelectionOverlay } from './SelectionOverlay';
import { ToolSurface } from './ToolSurface';
import { SearchHighlights } from './SearchHighlights';

export interface PageLayerProps {
  page: EditorPage;
  pageIndex: number;
  scale: number;
}

export const PageView = memo(function PageView({ page, pageIndex, scale }: PageLayerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visible = useVisible(wrapRef, '.viewer');
  const [rendered, setRendered] = useState(false);
  const tool = useEditor((s) => s.tool);
  const { width, height } = pageSize(page);
  const rotation = totalRotation(page);
  const cssW = Math.round(width * scale);
  const cssH = Math.round(height * scale);
  const sourceKey = page.source ? displayKey(page) : null;

  // Render the page bitmap lazily; re-render (debounced) when zoom changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !sourceKey || !page.source) return;
    if (!visible) {
      // Free the bitmap of off-screen pages to keep memory bounded.
      if (canvasRef.current) {
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
        canvasRef.current.remove();
        canvasRef.current = null;
        setRendered(false);
      }
      return;
    }
    // Stretch the existing bitmap immediately so zooming feels instant.
    if (canvasRef.current) {
      canvasRef.current.style.width = `${cssW}px`;
      canvasRef.current.style.height = `${cssH}px`;
    }
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    const delay = canvasRef.current ? 150 : 0;
    const timer = window.setTimeout(() => {
      getDisplayPage(page)
        .then((pdfPage) => {
          if (cancelled) return;
          const viewport = pdfPage.getViewport({ scale, rotation });
          const canvas = document.createElement('canvas');
          const t = renderToCanvas(pdfPage, canvas, viewport, window.devicePixelRatio || 1);
          task = t;
          return t.promise.then(() => {
            if (cancelled) {
              canvas.width = 0;
              canvas.height = 0;
              return;
            }
            const old = canvasRef.current;
            host.appendChild(canvas);
            if (old) {
              old.width = 0;
              old.height = 0;
              old.remove();
            }
            canvasRef.current = canvas;
            setRendered(true);
          });
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === 'RenderingCancelledException') return;
          console.warn('Page render failed', err);
        });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      task?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, sourceKey, rotation, scale, cssW, cssH]);

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.el, .sel-overlay, .tool-surface, .text-run, textarea')) return;
    stopEditing();
    clearSelection();
  };

  return (
    <div className="page-wrap" data-page-index={pageIndex} style={{ width: cssW, height: cssH }}>
      <div
        ref={wrapRef}
        className={`page tool-${tool}${page.source ? '' : ' is-blank'}`}
        style={{ width: cssW, height: cssH }}
        onPointerDown={onBackgroundPointerDown}
      >
        <div className="page-canvas" ref={hostRef} />
        {page.source && visible && !rendered && <div className="page-loading" aria-hidden="true" />}
        <TextLayer page={page} pageIndex={pageIndex} scale={scale} visible={visible} />
        <ElementLayer page={page} pageIndex={pageIndex} scale={scale} />
        <SearchHighlights pageIndex={pageIndex} scale={scale} />
        <ToolSurface page={page} pageIndex={pageIndex} scale={scale} />
        <SelectionOverlay page={page} pageIndex={pageIndex} scale={scale} />
      </div>
    </div>
  );
});
