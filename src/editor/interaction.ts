/** Pointer gesture helper and small DOM utilities shared by components. */

export interface DragHandlers {
  /** dx/dy in client pixels since the gesture started. */
  onMove?: (dx: number, dy: number, e: PointerEvent) => void;
  onEnd?: (moved: boolean, e: PointerEvent) => void;
  /** Movement below this (px) counts as a click. */
  threshold?: number;
}

/** Track a pointer drag from a pointerdown event until release. */
export function dragGesture(start: PointerEvent | React.PointerEvent, handlers: DragHandlers): void {
  const startX = start.clientX;
  const startY = start.clientY;
  const pointerId = start.pointerId;
  const threshold = handlers.threshold ?? 3;
  let moved = false;
  const target = start.target as HTMLElement | null;
  try {
    target?.setPointerCapture?.(pointerId);
  } catch {
    /* ignore */
  }
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < threshold) return;
    moved = true;
    handlers.onMove?.(dx, dy, e);
  };
  const finish = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    try {
      target?.releasePointerCapture?.(pointerId);
    } catch {
      /* ignore */
    }
    handlers.onEnd?.(moved, e);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
}

/** Imperative hooks into the viewer, registered by the Viewer component. */
export const viewerController: {
  scrollToPage: (index: number) => void;
  scrollToRect: (pageIndex: number, rect: { x: number; y: number; width: number; height: number }) => void;
  zoomAtCenter: (direction: 1 | -1) => void;
} = {
  scrollToPage: () => undefined,
  scrollToRect: () => undefined,
  zoomAtCenter: () => undefined,
};

/** Open the native file picker. Resolves with an empty list when cancelled. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => done([]));
    input.click();
  });
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function isImageFile(file: File): boolean {
  return /^image\/(png|jpeg|jpg|gif|webp|bmp|svg\+xml|avif)$/.test(file.type);
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? '⌘' : 'Ctrl';
