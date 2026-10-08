/**
 * Colour theme. Light is the default; the choice is remembered in
 * localStorage and applied through `data-theme` on <html> so the CSS tokens
 * switch without a flash (index.html applies the stored value before paint).
 */
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'pdf-editor-theme';
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

let current: Theme = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : read();

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme): void {
  current = theme;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable: the choice simply lasts for this page load */
  }
  for (const l of listeners) l();
}

export function toggleTheme(): void {
  setTheme(current === 'dark' ? 'light' : 'dark');
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getTheme,
    () => 'light',
  );
}

// Make sure the attribute matches the stored choice even if index.html did not set it.
if (typeof document !== 'undefined') document.documentElement.dataset.theme = current;
