import { useCallback, useEffect, useMemo, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { ContextBar } from './components/ContextBar';
import { Sidebar } from './components/Sidebar';
import { Viewer } from './components/Viewer';
import { EmptyState } from './components/EmptyState';
import { SearchPanel } from './components/SearchPanel';
import { SelectionPopover } from './components/SelectionPopover';
import { SignatureDialog } from './components/SignatureDialog';
import { ChoiceDialog, PasswordDialog } from './components/Dialogs';
import { LoadingOverlay, Notice } from './components/Notice';
import { Icon } from './components/Icons';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useEditor, getState, notify } from './editor/store';
import { effectiveZoom, insertImageFile, insertPdfFile, openFile, paste } from './editor/actions';
import { isImageFile, isPdfFile, pickFiles } from './editor/interaction';
import { importImage } from './editor/assets';
import { createImage } from './editor/factory';
import { addElement } from './editor/actions';
import { pageSize } from './editor/pageUtils';

interface PendingPassword {
  file: File;
  mode: 'open' | 'insert';
  insertAt?: number;
  incorrect: boolean;
}

interface PendingDrop {
  file: File;
}

export default function App() {
  const status = useEditor((s) => s.status);
  const sidebarOpen = useEditor((s) => s.sidebarOpen);
  const hasEdits = useEditor((s) => s.undoStack.length > 0);
  const [dragging, setDragging] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [password, setPassword] = useState<PendingPassword | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);

  const ready = status === 'ready';

  const open = useCallback(async (file: File, pw?: string) => {
    const result = await openFile(file, pw);
    if (result.needsPassword) setPassword({ file, mode: 'open', incorrect: !!result.incorrectPassword });
  }, []);

  const insertPdf = useCallback(async (file: File, at: number, pw?: string) => {
    const result = await insertPdfFile(file, at, pw);
    if (result.needsPassword) setPassword({ file, mode: 'insert', insertAt: at, incorrect: !!result.incorrectPassword });
  }, []);

  const onOpen = useCallback(async () => {
    const [file] = await pickFiles('application/pdf,.pdf');
    if (!file) return;
    if (getState().status === 'ready') setPendingDrop({ file });
    else void open(file);
  }, [open]);

  const onInsertImage = useCallback(async () => {
    if (getState().status !== 'ready') return;
    const files = await pickFiles('image/*', true);
    for (const f of files) await insertImageFile(f);
  }, []);

  const onInsertPdf = useCallback(
    async (index: number) => {
      const [file] = await pickFiles('application/pdf,.pdf');
      if (file) void insertPdf(file, index);
    },
    [insertPdf],
  );

  const onSignature = useCallback(() => {
    if (getState().status === 'ready') setSignatureOpen(true);
  }, []);

  const shortcutHandlers = useMemo(() => ({ onOpen, onInsertImage, onSignature }), [onOpen, onInsertImage, onSignature]);
  useKeyboardShortcuts(shortcutHandlers);

  // Drag-and-drop of PDFs (open/insert) and images (place on page).
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const pdf = files.find(isPdfFile);
      const images = files.filter(isImageFile);
      const s = getState();
      if (pdf) {
        if (s.status === 'ready') setPendingDrop({ file: pdf });
        else void open(pdf);
        return;
      }
      if (images.length && s.status === 'ready') {
        const pageEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-page-index]');
        let pageIndex: number | undefined;
        let at: { x: number; y: number } | undefined;
        if (pageEl) {
          pageIndex = parseInt(pageEl.dataset.pageIndex ?? '', 10);
          const rect = pageEl.getBoundingClientRect();
          const scale = effectiveZoom(s.zoomMode, s.zoom, s.pages, s.containerSize);
          at = { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
        }
        for (const img of images) await insertImageFile(img, pageIndex, at);
        return;
      }
      if (files.length) notify('Drop a PDF to open it, or an image to place it on the page.', 'error');
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [open]);

  // Paste images from the system clipboard.
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const s = getState();
      if (s.status !== 'ready' || s.editingId) return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter(isImageFile);
      if (files.length) {
        e.preventDefault();
        const pageIndex = Math.min(s.currentPage, s.pages.length - 1);
        for (const f of files) {
          const asset = await importImage(f);
          const { width: pw, height: ph } = pageSize(s.pages[pageIndex]);
          const k = Math.min(1, (pw * 0.5) / asset.width, (ph * 0.5) / asset.height);
          addElement(pageIndex, createImage({ x: (pw - asset.width * k) / 2, y: (ph - asset.height * k) / 2, width: asset.width * k, height: asset.height * k }, asset.id));
        }
      } else if (s.clipboard.length) {
        e.preventDefault();
        paste();
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!hasEdits) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [hasEdits]);

  return (
    <div className={`app${ready ? ' has-doc' : ''}${sidebarOpen ? ' sidebar-open' : ''}`}>
      <Toolbar onOpen={onOpen} onInsertImage={onInsertImage} onSignature={onSignature} />
      {ready ? (
        <>
          <ContextBar />
          <div className="workspace">
            {sidebarOpen && <Sidebar onInsertPdf={onInsertPdf} />}
            <main className="main">
              <Viewer />
              <SearchPanel />
            </main>
          </div>
        </>
      ) : (
        <EmptyState onOpen={onOpen} dragging={dragging} />
      )}

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">
            <Icon name="upload" size={36} />
            <span>{ready ? 'Drop a PDF to open or insert it, or an image to place it on the page' : 'Drop your PDF to open it'}</span>
          </div>
        </div>
      )}

      <SelectionPopover />
      <Notice />
      <LoadingOverlay />

      {signatureOpen && <SignatureDialog onClose={() => setSignatureOpen(false)} />}
      {password && (
        <PasswordDialog
          fileName={password.file.name}
          incorrect={password.incorrect}
          onCancel={() => setPassword(null)}
          onSubmit={(pw) => {
            const p = password;
            setPassword(null);
            if (p.mode === 'open') void open(p.file, pw);
            else void insertPdf(p.file, p.insertAt ?? getState().pages.length, pw);
          }}
        />
      )}
      {pendingDrop && (
        <ChoiceDialog
          title="Open or insert?"
          message={
            <>
              <strong>{pendingDrop.file.name}</strong> — open it as a new document (unsaved edits to the current file will be lost) or insert its pages after the current page?
            </>
          }
          options={[
            { label: 'Insert pages', value: 'insert' },
            { label: 'Open as new document', value: 'open', primary: true },
            { label: 'Cancel', value: 'cancel' },
          ]}
          onChoose={(v) => {
            const f = pendingDrop.file;
            setPendingDrop(null);
            if (v === 'open') void open(f);
            else if (v === 'insert') void insertPdf(f, getState().currentPage + 1);
          }}
        />
      )}
    </div>
  );
}
