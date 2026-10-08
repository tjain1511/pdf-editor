/**
 * All state transitions of the editor. Components call these instead of
 * touching the store directly.
 */
import { PDFDocument } from 'pdf-lib';
import { loadPdfDocument, PasswordRequiredError, type PDFDocumentProxy } from '../pdf/pdfjs';
import { clearSources, getSource, pruneSources, registerSource } from '../pdf/sources';
import { clearTextCache, getPageTextRuns, rectsForRange, runsToText } from '../pdf/textContent';
import { exportPdf } from '../pdf/export';
import { initFonts } from '../pdf/fonts';
import { createPageGeometry, rectCenter, rotatePoint } from '../pdf/geometry';
import { importImage, newId, pruneAssets, releaseAllAssets } from './assets';
import { cloneElement, createImage } from './factory';
import {
  clampToPage,
  findElement,
  mapPage,
  normalizeElement,
  pageIndexOfElement,
  pageSize,
  referencedAssetIds,
  referencedSourceIds,
} from './pageUtils';
import { commitFrom, commitPages, getState, initialState, notify, setPagesTransient, setState, subscribe } from './store';
import type { EditorElement, EditorPage, SearchMatch, TextRemoval, Tool, ToolSettings, ZoomMode } from './types';

export { undo, redo } from './store';

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 5;

/* ----------------------------------------------------------------------------
 * Document lifecycle
 * ------------------------------------------------------------------------- */

async function readFile(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export interface OpenResult {
  needsPassword?: boolean;
  incorrectPassword?: boolean;
}

/** Open a PDF file, replacing the current document. */
export async function openFile(file: File, password?: string): Promise<OpenResult> {
  if (file.size > 500 * 1024 * 1024) {
    notify('That file is larger than 500 MB and cannot be opened in the browser.', 'error');
    return {};
  }
  setState({ status: 'loading', loadProgress: 0, error: null, fileName: file.name, renamed: false });
  try {
    const [bytes] = await Promise.all([readFile(file), initFonts()]);
    const { pdf, destroy } = await loadPdfDocument(bytes, {
      password,
      onProgress: (fraction) => setState({ loadProgress: fraction }),
    });
    await closeDocument(false);
    const sourceId = newId();
    const flattenOnly = await checkRewritable(bytes);
    registerSource({ id: sourceId, name: file.name, bytes, pdf, destroy, flattenOnly });
    const pages = await buildPages(pdf, sourceId);
    setState({
      ...initialState,
      containerSize: getState().containerSize,
      sidebarOpen: getState().sidebarOpen,
      toolSettings: getState().toolSettings,
      status: 'ready',
      fileName: file.name,
      renamed: false,
      pages,
      flattenOnExport: flattenOnly,
    });
    if (flattenOnly) {
      notify('This PDF is encrypted or uses unsupported structures. Exported pages will be flattened to images.', 'info');
    }
    return {};
  } catch (err) {
    if (err instanceof PasswordRequiredError) {
      setState({ status: getState().pages.length ? 'ready' : 'empty', loadProgress: 0 });
      return { needsPassword: true, incorrectPassword: err.incorrect };
    }
    const message = err instanceof Error ? err.message : 'Failed to open the PDF.';
    setState({ status: getState().pages.length ? 'ready' : 'error', error: message, loadProgress: 0 });
    notify(message, 'error');
    return {};
  }
}

/** Determine whether pdf-lib can rewrite this file; otherwise export flattens. */
async function checkRewritable(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    if (doc.isEncrypted) return true;
    doc.getPageCount();
    return false;
  } catch {
    return true;
  }
}

async function buildPages(pdf: PDFDocumentProxy, sourceId: string): Promise<EditorPage[]> {
  const pages: EditorPage[] = [];
  const count = pdf.numPages;
  // Page metadata is cheap; fetch in chunks to keep large documents responsive.
  for (let i = 0; i < count; i += 32) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(32, count - i) }, (_, k) => pdf.getPage(i + k + 1)),
    );
    for (let k = 0; k < batch.length; k++) {
      const page = batch[k];
      pages.push({
        id: newId(),
        source: { sourceId, pageIndex: i + k },
        baseRotation: page.rotate,
        rotation: 0,
        view: [page.view[0], page.view[1], page.view[2], page.view[3]],
        elements: [],
        removals: [],
      });
    }
  }
  return pages;
}

export async function closeDocument(resetUi = true): Promise<void> {
  await clearSources();
  clearTextCache();
  releaseAllAssets();
  if (resetUi) {
    setState({ ...initialState, containerSize: getState().containerSize, toolSettings: getState().toolSettings, sidebarOpen: getState().sidebarOpen });
  }
}

/* ----------------------------------------------------------------------------
 * Tools and view
 * ------------------------------------------------------------------------- */

export function setTool(tool: Tool): void {
  setState((s) => ({
    tool,
    selectedIds: tool === 'select' ? s.selectedIds : [],
    editingId: tool === 'select' ? s.editingId : null,
  }));
}

export function setToolSetting<K extends keyof ToolSettings>(key: K, value: ToolSettings[K]): void {
  setState((s) => ({ toolSettings: { ...s.toolSettings, [key]: value } }));
}

export function setZoomMode(mode: ZoomMode): void {
  setState({ zoomMode: mode });
}

export function setZoom(zoom: number): void {
  setState({ zoomMode: 'custom', zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) });
}

export function zoomBy(direction: 1 | -1, current: number): void {
  const next =
    direction > 0
      ? ZOOM_STEPS.find((z) => z > current + 0.001) ?? Math.min(MAX_ZOOM, current * 1.25)
      : [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? Math.max(MIN_ZOOM, current / 1.25);
  setZoom(next);
}

export function setContainerSize(width: number, height: number): void {
  const cur = getState().containerSize;
  if (cur.width !== width || cur.height !== height) setState({ containerSize: { width, height } });
}

export function toggleSidebar(): void {
  setState((s) => ({ sidebarOpen: !s.sidebarOpen }));
}

export function setCurrentPage(index: number): void {
  if (getState().currentPage !== index) setState({ currentPage: index });
}

/** Effective zoom for the current mode given the container size. */
export function effectiveZoom(
  mode: ZoomMode,
  zoom: number,
  pages: EditorPage[],
  container: { width: number; height: number },
): number {
  if (mode === 'custom' || !pages.length || container.width === 0) return zoom;
  let maxW = 0;
  let maxH = 0;
  for (const p of pages) {
    const { width, height } = pageSize(p);
    if (width > maxW) maxW = width;
    if (height > maxH) maxH = height;
  }
  const padding = 48;
  const byWidth = (container.width - padding) / maxW;
  if (mode === 'fit-width') return clampZoom(byWidth);
  return clampZoom(Math.min(byWidth, (container.height - padding) / maxH));
}

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/* ----------------------------------------------------------------------------
 * Selection
 * ------------------------------------------------------------------------- */

export function select(ids: string[]): void {
  setState({ selectedIds: ids, editingId: null });
}

export function toggleSelect(id: string): void {
  setState((s) => {
    if (s.selectedIds.includes(id)) return { selectedIds: s.selectedIds.filter((x) => x !== id) };
    // Selection is limited to a single page.
    const page = pageIndexOfElement(s.pages, id);
    const same = s.selectedIds.filter((x) => pageIndexOfElement(s.pages, x) === page);
    return { selectedIds: [...same, id] };
  });
}

export function clearSelection(): void {
  const s = getState();
  if (s.selectedIds.length || s.editingId) setState({ selectedIds: [], editingId: null });
}

export function startEditing(id: string): void {
  setState({ editingId: id, selectedIds: [id] });
}

export function stopEditing(): void {
  const s = getState();
  if (!s.editingId) return;
  const found = findElement(s.pages, s.editingId);
  // Remove empty text boxes when editing ends.
  if (found && found.element.type === 'text' && found.element.text.trim() === '') {
    const id = found.element.id;
    const last = s.undoStack[s.undoStack.length - 1];
    if (last && !last.some((p) => p.elements.some((e) => e.id === id))) {
      // The box was just created: drop the creation step instead of adding a deletion step.
      setState({ pages: last, undoStack: s.undoStack.slice(0, -1), selectedIds: [], editingId: null });
      return;
    }
    deleteElements([id]);
  }
  setState({ editingId: null });
}

/* ----------------------------------------------------------------------------
 * Elements
 * ------------------------------------------------------------------------- */

export function addElement(pageIndex: number, element: EditorElement, options: { select?: boolean; edit?: boolean } = {}): void {
  const s = getState();
  if (pageIndex < 0 || pageIndex >= s.pages.length) return;
  const el = normalizeElement(element);
  commitPages(mapPage(s.pages, pageIndex, (p) => ({ ...p, elements: [...p.elements, el] })));
  if (options.select !== false) setState({ selectedIds: [el.id], editingId: options.edit ? el.id : null });
}

/** Add several elements to a page as a single undo step, optionally removing original text. */
export function addElements(
  pageIndex: number,
  elements: EditorElement[],
  options: { select?: string[]; edit?: string; removal?: TextRemoval | null } = {},
): void {
  const s = getState();
  if (pageIndex < 0 || pageIndex >= s.pages.length || !elements.length) return;
  const els = elements.map(normalizeElement);
  commitPages(
    mapPage(s.pages, pageIndex, (p) => ({
      ...p,
      elements: [...p.elements, ...els],
      removals: options.removal ? [...p.removals, options.removal] : p.removals,
    })),
  );
  setState({ selectedIds: options.select ?? els.map((e) => e.id), editingId: options.edit ?? null });
}

export type ElementPatch = Partial<EditorElement> | ((el: EditorElement) => EditorElement);

/**
 * Update elements by id. With `transient: true` the change is applied without
 * recording history (call `commitFrom(before)` when the gesture ends).
 */
export function updateElements(ids: string[], patch: ElementPatch, options: { transient?: boolean } = {}): void {
  const s = getState();
  const idSet = new Set(ids);
  let changed = false;
  const pages = s.pages.map((page) => {
    if (!page.elements.some((e) => idSet.has(e.id))) return page;
    changed = true;
    return {
      ...page,
      elements: page.elements.map((e) => {
        if (!idSet.has(e.id)) return e;
        const next = typeof patch === 'function' ? patch(e) : ({ ...e, ...patch } as EditorElement);
        return normalizeElement(next);
      }),
    };
  });
  if (!changed) return;
  if (options.transient) setPagesTransient(pages);
  else commitPages(pages);
}

export function updateElement(id: string, patch: ElementPatch, options?: { transient?: boolean }): void {
  updateElements([id], patch, options);
}

export { commitFrom };

export function deleteElements(ids: string[]): void {
  const s = getState();
  const idSet = new Set(ids);
  let changed = false;
  const pages = s.pages.map((page) => {
    if (!page.elements.some((e) => idSet.has(e.id))) return page;
    changed = true;
    return { ...page, elements: page.elements.filter((e) => !idSet.has(e.id)) };
  });
  if (!changed) return;
  commitPages(pages);
  setState({ selectedIds: s.selectedIds.filter((id) => !idSet.has(id)), editingId: idSet.has(s.editingId ?? '') ? null : s.editingId });
}

export function deleteSelected(): void {
  const s = getState();
  if (s.editingId) return;
  if (s.selectedIds.length) deleteElements(s.selectedIds);
}

function selectedElements(): { pageIndex: number; elements: EditorElement[] } | null {
  const s = getState();
  if (!s.selectedIds.length) return null;
  const pageIndex = pageIndexOfElement(s.pages, s.selectedIds[0]);
  if (pageIndex < 0) return null;
  const set = new Set(s.selectedIds);
  return { pageIndex, elements: s.pages[pageIndex].elements.filter((e) => set.has(e.id)) };
}

export function copySelected(): boolean {
  const sel = selectedElements();
  if (!sel) return false;
  setState({ clipboard: sel.elements.map((e) => cloneElement(e)) });
  return true;
}

export function cutSelected(): void {
  if (copySelected()) deleteSelected();
}

export function paste(): void {
  const s = getState();
  if (!s.clipboard.length || !s.pages.length) return;
  const pageIndex = Math.min(s.currentPage, s.pages.length - 1);
  const size = pageSize(s.pages[pageIndex]);
  const pasted = s.clipboard.map((e) => clampToPage(cloneElement(e, 12, 12), size));
  commitPages(mapPage(s.pages, pageIndex, (p) => ({ ...p, elements: [...p.elements, ...pasted] })));
  // Offset the clipboard so repeated pastes cascade.
  setState({ selectedIds: pasted.map((e) => e.id), editingId: null, clipboard: pasted.map((e) => cloneElement(e)) });
}

export function duplicateSelected(): void {
  const sel = selectedElements();
  if (!sel) return;
  const copies = sel.elements.map((e) => cloneElement(e, 12, 12));
  commitPages(mapPage(getState().pages, sel.pageIndex, (p) => ({ ...p, elements: [...p.elements, ...copies] })));
  setState({ selectedIds: copies.map((e) => e.id), editingId: null });
}

export function reorderSelected(direction: 'front' | 'back' | 'forward' | 'backward'): void {
  const sel = selectedElements();
  if (!sel) return;
  const set = new Set(sel.elements.map((e) => e.id));
  commitPages(
    mapPage(getState().pages, sel.pageIndex, (p) => {
      const others = p.elements.filter((e) => !set.has(e.id));
      const picked = p.elements.filter((e) => set.has(e.id));
      if (direction === 'front') return { ...p, elements: [...others, ...picked] };
      if (direction === 'back') return { ...p, elements: [...picked, ...others] };
      const list = p.elements.slice();
      if (direction === 'forward') {
        for (let i = list.length - 2; i >= 0; i--) {
          if (set.has(list[i].id) && !set.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
        }
      } else {
        for (let i = 1; i < list.length; i++) {
          if (set.has(list[i].id) && !set.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
        }
      }
      return { ...p, elements: list };
    }),
  );
}

export function nudgeSelected(dx: number, dy: number): void {
  const s = getState();
  if (!s.selectedIds.length || s.editingId) return;
  const pageIndex = pageIndexOfElement(s.pages, s.selectedIds[0]);
  const size = pageIndex >= 0 ? pageSize(s.pages[pageIndex]) : null;
  updateElements(s.selectedIds, (e) => (size ? clampToPage(moveElement(e, dx, dy), size) : moveElement(e, dx, dy)));
}

export function moveElement(e: EditorElement, dx: number, dy: number): EditorElement {
  const moved = { ...e, x: e.x + dx, y: e.y + dy } as EditorElement;
  if (moved.type === 'markup') moved.rects = moved.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
  return moved;
}

/** Insert an image file onto a page, scaled to fit comfortably. */
export async function insertImageFile(file: File, pageIndex?: number, at?: { x: number; y: number }): Promise<void> {
  const s = getState();
  if (!s.pages.length) return;
  const index = pageIndex ?? Math.min(s.currentPage, s.pages.length - 1);
  try {
    const asset = await importImage(file);
    const { width: pw, height: ph } = pageSize(s.pages[index]);
    const maxW = pw * 0.6;
    const maxH = ph * 0.6;
    const scale = Math.min(1, maxW / asset.width, maxH / asset.height, 300 / asset.width);
    const w = asset.width * scale;
    const h = asset.height * scale;
    const x = at ? at.x - w / 2 : (pw - w) / 2;
    const y = at ? at.y - h / 2 : (ph - h) / 2;
    addElement(index, clampToPage(createImage({ x, y, width: w, height: h }, asset.id), { width: pw, height: ph }));
    setTool('select');
  } catch (err) {
    notify(err instanceof Error ? err.message : 'Could not import the image.', 'error');
  }
}

/* ----------------------------------------------------------------------------
 * Pages
 * ------------------------------------------------------------------------- */

export function rotatePage(index: number, delta: 90 | -90): void {
  const s = getState();
  const page = s.pages[index];
  if (!page) return;
  const before = pageSize(page);
  const rotation = ((page.rotation + delta) % 360 + 360) % 360;
  // Rotate existing elements along with the page content.
  const c = { x: before.width / 2, y: before.height / 2 };
  const after = { x: before.height / 2, y: before.width / 2 };
  const elements = page.elements.map((e) => {
    const center = rotatePoint(rectCenter(e), c, delta);
    const moved: EditorElement = {
      ...e,
      rotation: e.rotation + delta,
      x: center.x - c.x + after.x - e.width / 2,
      y: center.y - c.y + after.y - e.height / 2,
    };
    if (moved.type === 'markup') {
      moved.rects = moved.rects.map((r) => {
        const rc = rotatePoint(rectCenter(r), c, delta);
        return { x: rc.x - c.x + after.x - r.height / 2, y: rc.y - c.y + after.y - r.width / 2, width: r.height, height: r.width };
      });
    }
    return moved;
  });
  commitPages(mapPage(s.pages, index, (p) => ({ ...p, rotation, elements })));
}

export function deletePage(index: number): void {
  const s = getState();
  if (s.pages.length <= 1) {
    notify('A document needs at least one page.', 'error');
    return;
  }
  const pages = s.pages.filter((_, i) => i !== index);
  commitPages(pages);
  setState({ currentPage: Math.min(s.currentPage, pages.length - 1), selectedIds: [], editingId: null });
}

export function movePage(from: number, to: number): void {
  const s = getState();
  if (from === to || from < 0 || from >= s.pages.length || to < 0 || to > s.pages.length) return;
  const pages = s.pages.slice();
  const [page] = pages.splice(from, 1);
  pages.splice(to > from ? to - 1 : to, 0, page);
  commitPages(pages);
  setState({ currentPage: pages.indexOf(page) });
}

export function duplicatePage(index: number): void {
  const s = getState();
  const page = s.pages[index];
  if (!page) return;
  const copy: EditorPage = { ...page, id: newId(), elements: page.elements.map((e) => cloneElement(e)) };
  const pages = s.pages.slice();
  pages.splice(index + 1, 0, copy);
  commitPages(pages);
  setState({ currentPage: index + 1 });
}

export function insertBlankPage(index: number): void {
  const s = getState();
  const ref = s.pages[Math.max(0, Math.min(index - 1, s.pages.length - 1))];
  const size = ref ? pageSize(ref) : { width: 612, height: 792 };
  const page: EditorPage = {
    id: newId(),
    source: null,
    baseRotation: 0,
    rotation: 0,
    view: [0, 0, size.width, size.height],
    elements: [],
    removals: [],
  };
  const pages = s.pages.slice();
  pages.splice(index, 0, page);
  commitPages(pages);
  setState({ currentPage: index, selectedIds: [], editingId: null });
}

/** Insert all pages of another PDF at `index`. */
export async function insertPdfFile(file: File, index: number, password?: string): Promise<OpenResult> {
  const s = getState();
  try {
    const bytes = await readFile(file);
    const { pdf, destroy } = await loadPdfDocument(bytes, { password });
    const sourceId = newId();
    const flattenOnly = await checkRewritable(bytes);
    registerSource({ id: sourceId, name: file.name, bytes, pdf, destroy, flattenOnly });
    const newPages = await buildPages(pdf, sourceId);
    const pages = s.pages.slice();
    pages.splice(index, 0, ...newPages);
    commitPages(pages);
    setState({ currentPage: index, flattenOnExport: getState().flattenOnExport || flattenOnly });
    notify(`Inserted ${newPages.length} page${newPages.length === 1 ? '' : 's'} from ${file.name}.`);
    return {};
  } catch (err) {
    if (err instanceof PasswordRequiredError) return { needsPassword: true, incorrectPassword: err.incorrect };
    notify(err instanceof Error ? err.message : 'Could not insert the PDF.', 'error');
    return {};
  }
}

/** Drop sources and assets no longer referenced anywhere (including history). */
let gcTimer = 0;
subscribe(() => {
  if (gcTimer) return;
  gcTimer = window.setTimeout(() => {
    gcTimer = 0;
    if (getState().status === 'ready') garbageCollect();
  }, 10_000);
});

export function garbageCollect(): void {
  const s = getState();
  const snapshots = [s.pages, ...s.undoStack, ...s.redoStack];
  const sourceIds = new Set<string>();
  for (const snap of snapshots) for (const id of referencedSourceIds(snap)) sourceIds.add(id);
  pruneSources(sourceIds);
  pruneAssets(referencedAssetIds(snapshots));
}

/* ----------------------------------------------------------------------------
 * Export
 * ------------------------------------------------------------------------- */

function downloadBytes(bytes: Uint8Array, name: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function outputName(base: string, suffix: string): string {
  const stem = base.replace(/\.pdf$/i, '') || 'document';
  return `${stem}${suffix}.pdf`;
}

/** Characters that are not allowed in file names on common platforms. */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/** Clean up a user-typed document name; returns null when nothing usable is left. */
export function sanitizeDocumentName(raw: string): string | null {
  let stem = raw.replace(ILLEGAL_NAME_CHARS, ' ').replace(/\s+/g, ' ').trim();
  stem = stem.replace(/\.pdf$/i, '').replace(/[. ]+$/, '').trim();
  if (!stem) return null;
  return `${stem.slice(0, 200)}.pdf`;
}

/** Rename the document. The new name is used for the exported file and its PDF title. */
export function renameDocument(raw: string): boolean {
  const s = getState();
  if (s.status !== 'ready') return false;
  const name = sanitizeDocumentName(raw);
  if (!name) return false;
  if (name === s.fileName) return true;
  setState({ fileName: name, renamed: true });
  return true;
}

export async function exportDocument(pageIndices?: number[], suffix?: string): Promise<void> {
  const s = getState();
  if (!s.pages.length || s.exporting) return;
  // A document the user has renamed is exported under exactly that name.
  if (suffix === undefined) suffix = s.renamed ? '' : '-edited';
  stopEditing();
  setState({ exporting: true });
  try {
    const pages = pageIndices ? pageIndices.map((i) => s.pages[i]).filter(Boolean) : s.pages;
    const bytes = await exportPdf(pages, { flatten: s.flattenOnExport, title: s.fileName.replace(/\.pdf$/i, '') });
    downloadBytes(bytes, outputName(s.fileName, suffix));
    notify('PDF exported.');
  } catch (err) {
    console.error(err);
    notify(err instanceof Error ? `Export failed: ${err.message}` : 'Export failed.', 'error');
  } finally {
    setState({ exporting: false });
  }
}

export function extractPage(index: number): Promise<void> {
  return exportDocument([index], `-page-${index + 1}`);
}

/* ----------------------------------------------------------------------------
 * Search
 * ------------------------------------------------------------------------- */

let searchToken = 0;

export function openSearch(): void {
  setState((s) => ({ search: { ...s.search, open: true } }));
}

export function closeSearch(): void {
  searchToken++;
  setState((s) => ({ search: { ...s.search, open: false, matches: [], current: -1, searching: false } }));
}

export async function runSearch(query: string): Promise<void> {
  const token = ++searchToken;
  const s = getState();
  setState({ search: { ...s.search, query, matches: [], current: -1, searching: query.trim().length > 0 } });
  const needle = query.trim().toLowerCase();
  if (!needle) return;
  const matches: SearchMatch[] = [];
  for (let i = 0; i < s.pages.length; i++) {
    const page = s.pages[i];
    if (!page.source) continue;
    let runs;
    try {
      runs = await getPageTextRuns(page);
    } catch {
      continue;
    }
    if (token !== searchToken) return;
    const { text, offsets } = runsToText(runs);
    const hay = text.toLowerCase();
    let from = 0;
    let found: number;
    while ((found = hay.indexOf(needle, from)) !== -1 && matches.length < 2000) {
      const rects = rectsForRange(runs, offsets, found, found + needle.length);
      const excerptStart = Math.max(0, found - 30);
      const excerpt = text.slice(excerptStart, found + needle.length + 30).replace(/\s+/g, ' ');
      matches.push({ pageIndex: i, rects, excerpt });
      from = found + needle.length;
    }
    if (i % 8 === 7) setState((st) => ({ search: { ...st.search, matches: matches.slice() } }));
  }
  if (token !== searchToken) return;
  setState((st) => ({ search: { ...st.search, matches, current: matches.length ? 0 : -1, searching: false } }));
}

export function stepSearch(direction: 1 | -1): void {
  setState((s) => {
    const n = s.search.matches.length;
    if (!n) return {};
    const current = (s.search.current + direction + n) % n;
    return { search: { ...s.search, current } };
  });
}

/* ----------------------------------------------------------------------------
 * Misc helpers used by components
 * ------------------------------------------------------------------------- */

export function getSourceName(sourceId: string): string {
  return getSource(sourceId)?.name ?? '';
}

export { createPageGeometry };
