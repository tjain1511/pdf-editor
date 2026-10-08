import { useEffect, useRef } from 'react';
import { commitFrom, stopEditing, updateElement } from '../editor/actions';
import { getState } from '../editor/store';
import type { TextElement } from '../editor/types';
import { CSS_FONT_STACK, TEXT_PADDING } from '../pdf/fonts';
import { getEmbeddedFont } from '../pdf/embeddedFonts';

export function TextEditor({ el, scale }: { el: TextElement; scale: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const before = useRef(getState().pages);
  const finished = useRef(false);
  const embedded = getEmbeddedFont(el.embeddedFont);
  const family = embedded ? `"${embedded.loadedName}", ${CSS_FONT_STACK[el.fontFamily]}` : CSS_FONT_STACK[el.fontFamily];

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
    autosize(ta);
  }, []);

  useEffect(() => {
    if (ref.current) autosize(ref.current);
  });

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    commitFrom(before.current);
    stopEditing();
  };

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={el.text}
      spellCheck={false}
      placeholder="Type here"
      style={{
        width: el.hScale !== 1 ? `${100 / el.hScale}%` : undefined,
        transform: el.hScale !== 1 ? `scaleX(${el.hScale})` : undefined,
        transformOrigin: 'left top',
        fontFamily: family,
        fontSize: el.fontSize * scale,
        lineHeight: `${el.fontSize * el.lineHeight * scale}px`,
        fontWeight: el.bold ? 700 : 400,
        fontStyle: el.italic ? 'italic' : 'normal',
        textDecoration: el.underline ? 'underline' : 'none',
        textAlign: el.align,
        color: el.color,
        padding: TEXT_PADDING * scale,
        background: el.background ?? 'transparent',
        whiteSpace: el.autoWidth ? 'pre' : undefined,
      }}
      onChange={(e) => {
        updateElement(el.id, { text: e.target.value }, { transient: true });
        autosize(e.target);
      }}
      onBlur={finish}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          finish();
        }
      }}
    />
  );
}

function autosize(ta: HTMLTextAreaElement) {
  ta.style.height = '0px';
  ta.style.height = `${ta.scrollHeight}px`;
}
