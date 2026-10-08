/**
 * Minimal external store with selector-based subscriptions. Undo/redo works on
 * immutable snapshots of `pages`; because element arrays are shared structurally,
 * snapshots cost almost nothing.
 */
import { useSyncExternalStore } from 'react';
import type { EditorState, EditorPage } from './types';

const MAX_HISTORY = 100;

export const initialState: EditorState = {
  status: 'empty',
  loadProgress: 0,
  error: null,
  fileName: '',
  renamed: false,
  pages: [],
  selectedIds: [],
  editingId: null,
  currentPage: 0,
  tool: 'select',
  toolSettings: {
    strokeColor: '#d7263d',
    strokeWidth: 2,
    fillColor: null,
    highlightColor: '#ffe100',
    textColor: '#111111',
    fontFamily: 'Helvetica',
    fontSize: 14,
    coverColor: '#ffffff',
  },
  zoomMode: 'fit-width',
  zoom: 1,
  containerSize: { width: 0, height: 0 },
  sidebarOpen: true,
  search: { open: false, query: '', matches: [], current: -1, searching: false },
  undoStack: [],
  redoStack: [],
  clipboard: [],
  exporting: false,
  notice: null,
  flattenOnExport: false,
};

let state: EditorState = initialState;
const listeners = new Set<() => void>();

export function getState(): EditorState {
  return state;
}

export function setState(update: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)): void {
  const patch = typeof update === 'function' ? update(state) : update;
  let changed = false;
  for (const key in patch) {
    if ((patch as Record<string, unknown>)[key] !== (state as unknown as Record<string, unknown>)[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

/** Replace pages and record the previous version in the undo history. */
export function commitPages(pages: EditorPage[]): void {
  if (pages === state.pages) return;
  setState((s) => ({
    pages,
    undoStack: pushHistory(s.undoStack, s.pages),
    redoStack: [],
  }));
}

/** Replace pages without touching history (used during drags). */
export function setPagesTransient(pages: EditorPage[]): void {
  setState({ pages });
}

/** Record `before` as an undo step if pages changed since then. */
export function commitFrom(before: EditorPage[]): void {
  if (before === state.pages) return;
  setState((s) => ({ undoStack: pushHistory(s.undoStack, before), redoStack: [] }));
}

function pushHistory(stack: EditorPage[][], snapshot: EditorPage[]): EditorPage[][] {
  const next = stack.length >= MAX_HISTORY ? stack.slice(stack.length - MAX_HISTORY + 1) : stack.slice();
  next.push(snapshot);
  return next;
}

export function undo(): void {
  const s = state;
  if (!s.undoStack.length) return;
  const previous = s.undoStack[s.undoStack.length - 1];
  setState({
    pages: previous,
    undoStack: s.undoStack.slice(0, -1),
    redoStack: [...s.redoStack, s.pages],
    selectedIds: s.selectedIds.filter((id) => previous.some((p) => p.elements.some((e) => e.id === id))),
    editingId: null,
  });
}

export function redo(): void {
  const s = state;
  if (!s.redoStack.length) return;
  const next = s.redoStack[s.redoStack.length - 1];
  setState({
    pages: next,
    redoStack: s.redoStack.slice(0, -1),
    undoStack: [...s.undoStack, s.pages],
    selectedIds: s.selectedIds.filter((id) => next.some((p) => p.elements.some((e) => e.id === id))),
    editingId: null,
  });
}

export function resetState(): void {
  state = initialState;
  for (const l of listeners) l();
}

let noticeId = 0;
export function notify(message: string, kind: 'info' | 'error' = 'info'): void {
  const id = ++noticeId;
  setState({ notice: { id, message, kind } });
  window.setTimeout(() => {
    if (state.notice?.id === id) setState({ notice: null });
  }, kind === 'error' ? 7000 : 3500);
}

if (import.meta.env.DEV) {
  // Debug handle for development only; stripped from production builds.
  (window as unknown as { __editor: { getState: typeof getState } }).__editor = { getState };
}
