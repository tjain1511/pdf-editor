import { memo, useMemo } from 'react';
import { useEditor } from '../editor/store';

export const SearchHighlights = memo(function SearchHighlights({ pageIndex, scale }: { pageIndex: number; scale: number }) {
  const matches = useEditor((s) => s.search.matches);
  const current = useEditor((s) => s.search.current);
  const open = useEditor((s) => s.search.open);
  const items = useMemo(() => {
    const out: { rects: { x: number; y: number; width: number; height: number }[]; active: boolean }[] = [];
    matches.forEach((m, i) => {
      if (m.pageIndex === pageIndex) out.push({ rects: m.rects, active: i === current });
    });
    return out;
  }, [matches, current, pageIndex]);
  if (!open || !items.length) return null;
  return (
    <div className="search-layer" aria-hidden="true">
      {items.map((m, i) =>
        m.rects.map((r, k) => (
          <div
            key={`${i}-${k}`}
            className={`search-hit${m.active ? ' is-current' : ''}`}
            style={{ left: r.x * scale, top: r.y * scale, width: r.width * scale, height: r.height * scale }}
          />
        )),
      )}
    </div>
  );
});
