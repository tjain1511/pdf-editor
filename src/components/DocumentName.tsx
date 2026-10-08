import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { renameDocument } from '../editor/actions';
import { notify, useEditor } from '../editor/store';
import { Icon } from './Icons';

/** Document name in the toolbar. Click (or press Enter) to rename it in place. */
export function DocumentName() {
  const fileName = useEditor((s) => s.fileName);
  const ready = useEditor((s) => s.status === 'ready');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const sizerRef = useRef<HTMLSpanElement>(null);

  const stem = fileName.replace(/\.pdf$/i, '');
  const hasExt = /\.pdf$/i.test(fileName);

  // Leave edit mode if the document changes underneath us.
  useEffect(() => setEditing(false), [fileName, ready]);

  // Focus and select the name once when editing starts.
  useLayoutEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  // Size the input to its content on every change so the toolbar does not jump.
  useLayoutEffect(() => {
    const input = inputRef.current;
    const sizer = sizerRef.current;
    if (!editing || !input || !sizer) return;
    input.style.width = `${Math.min(300, Math.max(120, sizer.offsetWidth + 20))}px`;
  }, [editing, draft]);

  const start = () => {
    if (!ready) return;
    setDraft(stem);
    setEditing(true);
  };

  const commit = () => {
    if (!editing) return;
    setEditing(false);
    if (draft.trim() === stem.trim()) return;
    if (!renameDocument(draft)) notify('Enter a name for the document.', 'error');
  };

  const cancel = () => setEditing(false);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Keep editor shortcuts from firing while typing a name.
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  if (!ready) return <span className="brand-name">PDF Editor</span>;

  return (
    <span className="docname">
      {editing ? (
        <>
          <input
            ref={inputRef}
            className="docname-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            aria-label="Document name"
            spellCheck={false}
            autoComplete="off"
          />
          <span ref={sizerRef} className="docname-btn" aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none' }}>
            <span className="docname-text">{draft || 'document'}</span>
          </span>
        </>
      ) : (
        <button type="button" className="docname-btn" onClick={start} title="Rename document" aria-label={`Document name: ${fileName}. Click to rename.`}>
          <span className="docname-text">{stem || fileName}</span>
          {hasExt && <span className="docname-ext">.pdf</span>}
          <Icon name="edit-text" size={14} />
        </button>
      )}
    </span>
  );
}
