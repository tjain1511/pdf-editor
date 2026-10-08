import { useEffect } from 'react';
import {
  clearSelection,
  closeSearch,
  copySelected,
  cutSelected,
  deleteSelected,
  duplicateSelected,
  effectiveZoom,
  exportDocument,
  nudgeSelected,
  openSearch,
  paste,
  redo,
  select,
  setTool,
  setZoomMode,
  startEditing,
  stopEditing,
  toggleSidebar,
  undo,
  updateElements,
  zoomBy,
} from '../editor/actions';
import { getState } from '../editor/store';
import { isEditableTarget } from '../editor/interaction';
import type { Tool } from '../editor/types';
import { findElement } from '../editor/pageUtils';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  t: 'text',
  e: 'edit-text',
  p: 'draw',
  h: 'highlight',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  a: 'arrow',
  k: 'checkbox',
  x: 'cover',
};

export function useKeyboardShortcuts(handlers: { onOpen: () => void; onInsertImage: () => void; onSignature: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const editable = isEditableTarget(e.target);

      // Shortcuts that work even while typing.
      if (mod && key === 'o') {
        e.preventDefault();
        handlers.onOpen();
        return;
      }
      if (mod && key === 's') {
        e.preventDefault();
        if (s.status === 'ready') void exportDocument();
        return;
      }
      if (mod && key === 'f' && s.status === 'ready') {
        e.preventDefault();
        openSearch();
        return;
      }
      if (editable) {
        // Text formatting while editing a text box.
        if (mod && s.editingId && ['b', 'i', 'u'].includes(key)) {
          e.preventDefault();
          const found = findElement(s.pages, s.editingId);
          if (found?.element.type === 'text') {
            const el = found.element;
            updateElements([el.id], key === 'b' ? { bold: !el.bold } : key === 'i' ? { italic: !el.italic } : { underline: !el.underline });
          }
        }
        return;
      }
      if (s.status !== 'ready') return;

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && (key === '=' || key === '+')) {
        e.preventDefault();
        zoomBy(1, effectiveZoom(s.zoomMode, s.zoom, s.pages, s.containerSize));
        return;
      }
      if (mod && key === '-') {
        e.preventDefault();
        zoomBy(-1, effectiveZoom(s.zoomMode, s.zoom, s.pages, s.containerSize));
        return;
      }
      if (mod && key === '0') {
        e.preventDefault();
        setZoomMode('fit-width');
        return;
      }
      if (mod && key === '9') {
        e.preventDefault();
        setZoomMode('fit-page');
        return;
      }
      if (mod && key === '\\') {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        const page = s.pages[s.currentPage];
        if (page) {
          const ids = page.elements.map((el) => el.id);
          if (ids.length) {
            setTool('select');
            select(ids);
          }
        }
        return;
      }
      if (mod && key === 'c') {
        if (copySelected()) e.preventDefault();
        return;
      }
      if (mod && key === 'x') {
        if (s.selectedIds.length) {
          e.preventDefault();
          cutSelected();
        }
        return;
      }
      if (mod && key === 'v') {
        // Element paste; image paste is handled by the document paste event.
        if (s.clipboard.length) {
          e.preventDefault();
          paste();
        }
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod && ['b', 'i', 'u'].includes(key) && s.selectedIds.length) {
        e.preventDefault();
        updateElements(s.selectedIds, (el) =>
          el.type === 'text'
            ? { ...el, ...(key === 'b' ? { bold: !el.bold } : key === 'i' ? { italic: !el.italic } : { underline: !el.underline }) }
            : el,
        );
        return;
      }
      if (mod) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedIds.length) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }
      if (e.key === 'Escape') {
        if (s.search.open) closeSearch();
        else if (s.editingId) stopEditing();
        else if (s.selectedIds.length) clearSelection();
        else setTool('select');
        return;
      }
      if (e.key === 'Enter' && s.selectedIds.length === 1) {
        const found = findElement(s.pages, s.selectedIds[0]);
        if (found?.element.type === 'text') {
          e.preventDefault();
          startEditing(found.element.id);
        }
        return;
      }
      if (e.key.startsWith('Arrow') && s.selectedIds.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudgeSelected(dx, dy);
        return;
      }
      if (e.altKey) return;
      if (key === 'i') {
        handlers.onInsertImage();
        return;
      }
      if (key === 's') {
        handlers.onSignature();
        return;
      }
      const tool = TOOL_KEYS[key];
      if (tool) {
        e.preventDefault();
        setTool(tool);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers]);
}
