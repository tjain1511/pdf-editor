import { useEffect, useState, type RefObject } from 'react';

/** Whether the element is within (or near) the scrolling viewport. */
export function useVisible(ref: RefObject<HTMLElement | null>, rootSelector: string, margin = '100% 0px'): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = el.closest(rootSelector) as HTMLElement | null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting);
      },
      { root, rootMargin: margin, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootSelector, margin]);
  return visible;
}
