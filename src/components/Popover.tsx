/**
 * Anchored popover rendered through a portal so it is never clipped by
 * scrolling or overflow-hidden ancestors (sidebars, modals, toolbars).
 * It positions itself relative to an anchor element, flips above when there is
 * no room below, stays inside the viewport, follows the anchor on resize, and
 * closes on outside clicks, Escape or scrolling.
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export type PopoverAlign = 'left' | 'right';

const GAP = 6;
const MARGIN = 8;
const HIDDEN = { visibility: 'hidden' } as const;

export function Popover({
  anchorRef,
  align = 'left',
  onClose,
  children,
  className,
  role = 'menu',
  label,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  align?: PopoverAlign;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  role?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<'below' | 'above'>('below');

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const el = ref.current;
    if (!anchor || !el) return;

    // Position imperatively so the popover is visible (and therefore focusable) before focus moves into it.
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const below = a.bottom + GAP + h <= vh - MARGIN || a.top - GAP - h < MARGIN;
      const top = below ? a.bottom + GAP : a.top - GAP - h;
      let left = align === 'right' ? a.right - w : a.left;
      left = Math.max(MARGIN, Math.min(left, vw - MARGIN - w));
      el.style.top = `${Math.round(Math.max(MARGIN, top))}px`;
      el.style.left = `${Math.round(left)}px`;
      el.style.visibility = 'visible';
      setPlacement(below ? 'below' : 'above');
    };
    place();

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (el.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        const items = Array.from(el.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        let next = 0;
        if (e.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % items.length;
        else if (e.key === 'ArrowUp') next = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length;
        else if (e.key === 'End') next = items.length - 1;
        items[next].focus();
      }
      if (e.key === 'Tab') onClose();
    };
    // Scrolling an ancestor (e.g. the sidebar) would detach the popover from its anchor, so close like a native menu.
    const onScroll = (e: Event) => {
      if (el.contains(e.target as Node)) return;
      onClose();
    };
    // A resize only moves the anchor: follow it.
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    // Move focus into the menu for keyboard users.
    const first = el.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, [anchorRef, align, onClose]);

  return createPortal(
    <div
      ref={ref}
      className={`popover popover-${placement}${className ? ` ${className}` : ''}`}
      style={HIDDEN}
      role={role}
      aria-label={label}
      // Keep pointer events inside the popover from reaching drag/drop or page handlers underneath.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
