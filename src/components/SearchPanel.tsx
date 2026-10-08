import { useEffect, useRef, useState } from 'react';
import { closeSearch, runSearch, setCurrentPage, stepSearch } from '../editor/actions';
import { useEditor } from '../editor/store';
import { viewerController } from '../editor/interaction';
import { ToolButton } from './controls';
import { Icon } from './Icons';

export function SearchPanel() {
  const search = useEditor((s) => s.search);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef(0);
  const [value, setValue] = useState(search.query);

  useEffect(() => {
    if (search.open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else setValue('');
  }, [search.open]);

  // Scroll to the active match.
  useEffect(() => {
    const m = search.matches[search.current];
    if (!m) return;
    setCurrentPage(m.pageIndex);
    const rect = m.rects[0] ?? { x: 0, y: 0, width: 0, height: 0 };
    viewerController.scrollToRect(m.pageIndex, rect);
  }, [search.current, search.matches]);

  if (!search.open) return null;
  const count = search.matches.length;
  return (
    <div className="search-panel" role="search">
      <Icon name="search" size={16} />
      <input
        ref={inputRef}
        type="search"
        placeholder="Search in document"
        value={value}
        aria-label="Search text"
        onChange={(e) => {
          const q = e.target.value;
          setValue(q);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => void runSearch(q), 220);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            stepSearch(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') closeSearch();
        }}
      />
      <span className="search-count">
        {search.searching ? 'Searching…' : count ? `${search.current + 1} of ${count}` : search.query.trim() ? 'No results' : ''}
      </span>
      <ToolButton icon="chevron-up" label="Previous match" onClick={() => stepSearch(-1)} disabled={!count} />
      <ToolButton icon="chevron-down" label="Next match" onClick={() => stepSearch(1)} disabled={!count} />
      <ToolButton icon="close" label="Close search" onClick={closeSearch} />
    </div>
  );
}
