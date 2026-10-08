import { useEffect, useState } from 'react';
import type { MarkupKind, Rect } from '../editor/types';
import { getState } from '../editor/store';
import { addElement, effectiveZoom, setTool } from '../editor/actions';
import { createCover, createMarkup } from '../editor/factory';
import { replaceText } from '../editor/textReplace';
import { getPageTextRuns } from '../pdf/textContent';
import { Icon } from './Icons';
import { ToolButton } from './controls';

interface SelectionInfo {
  pageIndex: number;
  rects: Rect[];
  text: string;
  anchor: { x: number; y: number };
  firstRunIndex: number;
}

/** Floating actions shown when text on a page has been selected with the mouse. */
export function SelectionPopover() {
  const [info, setInfo] = useState<SelectionInfo | null>(null);

  useEffect(() => {
    let timer = 0;
    const compute = () => {
      timer = 0;
      setInfo(readSelection());
    };
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(compute, 120);
    };
    document.addEventListener('selectionchange', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      document.removeEventListener('selectionchange', schedule);
      window.removeEventListener('resize', schedule);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  if (!info) return null;
  const tool = getState().tool;
  if (tool !== 'select' && tool !== 'highlight') return null;

  const done = () => {
    document.getSelection()?.removeAllRanges();
    setInfo(null);
  };
  // Act on the live selection: the cached one may lag behind the last change.
  const current = () => readSelection() ?? info;
  const markup = (kind: MarkupKind) => {
    const info = current();
    const s = getState().toolSettings;
    const color = kind === 'highlight' ? s.highlightColor : kind === 'underline' ? s.textColor : '#d7263d';
    addElement(info.pageIndex, createMarkup(info.rects, kind, color));
    setTool('select');
    done();
  };
  const cover = () => {
    const info = current();
    const s = getState().toolSettings;
    for (const r of info.rects) addElement(info.pageIndex, createCover({ x: r.x - 0.5, y: r.y - 0.5, width: r.width + 1, height: r.height + 1 }, s.coverColor));
    setTool('select');
    done();
  };
  const replace = async () => {
    const info = current();
    const page = getState().pages[info.pageIndex];
    let fontSize = info.rects[0].height * 0.85;
    let baseline = info.rects[0].y + info.rects[0].height * 0.8;
    let selectedRuns: Awaited<ReturnType<typeof getPageTextRuns>> = [];
    try {
      const runs = await getPageTextRuns(page);
      const run = runs[info.firstRunIndex];
      if (run) {
        fontSize = run.height;
        baseline = run.y + run.ascent * run.height;
      }
      // Runs intersecting the selection, clipped to the selected extent for glyph matching.
      selectedRuns = runs
        .filter((r) => info.rects.some((sel) => r.y < sel.y + sel.height && r.y + r.height > sel.y && r.x < sel.x + sel.width && r.x + r.width > sel.x))
        .map((r) => {
          const sel = info.rects.find((s) => r.y < s.y + s.height && r.y + r.height > s.y)!;
          const x0 = Math.max(r.x, sel.x);
          const x1 = Math.min(r.x + r.width, sel.x + sel.width);
          const dx = x0 - r.x;
          return { ...r, x: x0, width: Math.max(0, x1 - x0), userStart: [r.userStart[0] + r.userDir[0] * dx, r.userStart[1] + r.userDir[1] * dx] as [number, number] };
        });
    } catch {
      /* fall back to estimates */
    }
    void replaceText(info.pageIndex, {
      rects: info.rects,
      text: info.text.replace(/\s*\n\s*/g, '\n').trim(),
      fontSize,
      baseline,
      runs: selectedRuns,
      originalWidth: info.rects[0].width,
      partial: true,
    });
    done();
  };
  const copy = async () => {
    const info = current();
    try {
      await navigator.clipboard.writeText(info.text);
    } catch {
      /* clipboard unavailable */
    }
    done();
  };

  const style = {
    left: Math.max(8, Math.min(window.innerWidth - 300, info.anchor.x - 150)),
    top: Math.max(8, info.anchor.y - 48),
  };
  return (
    <div className="sel-popover" style={style} role="toolbar" aria-label="Text actions" onPointerDown={(e) => e.preventDefault()}>
      <ToolButton icon="highlighter" label="Highlight" onClick={() => markup('highlight')} />
      <ToolButton icon="underline" label="Underline" onClick={() => markup('underline')} />
      <ToolButton icon="strikethrough" label="Strikethrough" onClick={() => markup('strikethrough')} />
      <span className="tdivider" />
      <button type="button" className="pop-btn" onClick={replace} title="Cover the original text and place editable text on top">
        <Icon name="edit-text" size={16} /> Replace text
      </button>
      <ToolButton icon="cover" label="Cover text" onClick={cover} />
      <ToolButton icon="copy" label="Copy text" onClick={copy} />
    </div>
  );
}

/** Current text selection inside a page's text layer, or null. */
function readSelection(): SelectionInfo | null {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const startEl = nodeEl(range.startContainer);
  const endEl = nodeEl(range.endContainer);
  const layer = startEl?.closest<HTMLElement>('.text-layer') ?? endEl?.closest<HTMLElement>('.text-layer');
  if (!startEl || !layer) return null;
  const pageIndex = parseInt(layer.dataset.pageIndex ?? '', 10);
  if (!Number.isFinite(pageIndex)) return null;
  const s = getState();
  const scale = effectiveZoom(s.zoomMode, s.zoom, s.pages, s.containerSize);
  const layerRect = layer.getBoundingClientRect();
  // Only rects inside this page's text layer count (the selection may spill into other layers).
  const client = Array.from(range.getClientRects()).filter(
    (r) =>
      r.width > 0.5 &&
      r.height > 0.5 &&
      r.left >= layerRect.left - 1 &&
      r.right <= layerRect.right + 1 &&
      r.top >= layerRect.top - 1 &&
      r.bottom <= layerRect.bottom + 1,
  );
  if (!client.length) return null;
  const rects = mergeLines(
    client.map((r) => ({
      x: (r.left - layerRect.left) / scale,
      y: (r.top - layerRect.top) / scale,
      width: r.width / scale,
      height: r.height / scale,
    })),
  );
  const span = startEl.closest<HTMLElement>('.text-run');
  const firstRunIndex = span ? parseInt(span.dataset.run ?? '-1', 10) : -1;
  const top = Math.min(...client.map((r) => r.top));
  const left = Math.min(...client.map((r) => r.left));
  const right = Math.max(...client.map((r) => r.right));
  return { pageIndex, rects, text: sel.toString(), anchor: { x: (left + right) / 2, y: top }, firstRunIndex };
}

function nodeEl(node: Node): HTMLElement | null {
  return node instanceof HTMLElement ? node : node.parentElement;
}

/** Merge rects that sit on the same line into one. */
function mergeLines(rects: Rect[]): Rect[] {
  const sorted = rects.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < Math.min(last.height, r.height) * 0.5) {
      const x1 = Math.min(last.x, r.x);
      const x2 = Math.max(last.x + last.width, r.x + r.width);
      const y1 = Math.min(last.y, r.y);
      const y2 = Math.max(last.y + last.height, r.y + r.height);
      out[out.length - 1] = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    } else out.push({ ...r });
  }
  return out;
}
