import { Fragment, memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { EditorPage } from '../editor/types';
import { useEditor } from '../editor/store';
import { getPageTextRuns, type TextRun } from '../pdf/textContent';
import { replaceText, specForLine } from '../editor/textReplace';

const measured = new WeakMap<TextRun, number>();
let ctx: CanvasRenderingContext2D | null = null;

function scaleXFor(run: TextRun): number {
  let w = measured.get(run);
  if (w === undefined) {
    ctx ??= document.createElement('canvas').getContext('2d');
    if (!ctx) return 1;
    ctx.font = `${run.height}px ${run.fontFamily}`;
    w = ctx.measureText(run.str).width;
    measured.set(run, w);
  }
  return w > 0 ? run.width / w : 1;
}

export const TextLayer = memo(function TextLayer({
  page,
  pageIndex,
  scale,
  visible,
}: {
  page: EditorPage;
  pageIndex: number;
  scale: number;
  visible: boolean;
}) {
  const tool = useEditor((s) => s.tool);
  const [runs, setRuns] = useState<TextRun[] | null>(null);
  const sourceId = page.source?.sourceId;
  const sourceIndex = page.source?.pageIndex;
  const rotation = page.baseRotation + page.rotation;
  const removalKey = page.removals.map((r) => r.id).join(',');

  useEffect(() => {
    if (!visible || !sourceId) return;
    let cancelled = false;
    getPageTextRuns(page)
      .then((r) => {
        if (!cancelled) setRuns(r);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, sourceId, sourceIndex, rotation, removalKey]);

  const styles = useMemo(() => {
    if (!runs) return [];
    return runs.map((run): CSSProperties => {
      const sx = scaleXFor(run);
      const transform = `${run.angle ? `rotate(${run.angle}deg) ` : ''}${Math.abs(sx - 1) > 0.001 ? `scaleX(${sx})` : ''}`;
      return {
        left: run.x * scale,
        top: run.y * scale,
        fontSize: run.height * scale,
        fontFamily: run.fontFamily,
        transform: transform || undefined,
      };
    });
  }, [runs, scale]);

  const interactive = tool === 'select' || tool === 'highlight' || tool === 'edit-text';
  const onTop = tool === 'highlight' || tool === 'edit-text';
  const className = `text-layer${interactive ? ' is-active' : ''}${onTop ? ' is-top' : ''}${tool === 'edit-text' ? ' is-edit' : ''}`;

  if (!runs || !visible) return <div className={className} />;
  return (
    <div
      className={className}
      data-page-index={pageIndex}
      onPointerDown={(e) => {
        if (tool === 'edit-text' || e.button !== 0) return;
        const layer = e.currentTarget;
        layer.classList.add('is-selecting');
        const end = () => {
          layer.classList.remove('is-selecting');
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', end);
        };
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
      }}
    >
      {runs.map((run, i) => (
        <Fragment key={i}>
          {run.str ? (
            <span
              className="text-run"
              data-run={i}
              dir={run.dir === 'rtl' ? 'rtl' : undefined}
              style={styles[i]}
              onClick={tool === 'edit-text' ? () => void replaceText(pageIndex, specForLine(runs, i)) : undefined}
              onDoubleClick={
                tool === 'select'
                  ? (e) => {
                      e.preventDefault();
                      document.getSelection()?.removeAllRanges();
                      void replaceText(pageIndex, specForLine(runs, i));
                    }
                  : undefined
              }
            >
              {run.str}
            </span>
          ) : null}
          {run.hasEOL ? <br /> : null}
        </Fragment>
      ))}
      <div className="text-end" />
    </div>
  );
});
