import { useMemo, useRef } from 'react';
import {
  commitFrom,
  deleteSelected,
  duplicateSelected,
  reorderSelected,
  setToolSetting,
  updateElements,
} from '../editor/actions';
import { getState, useEditor } from '../editor/store';
import type { EditorElement, EditorPage, FontFamily, TextElement, Tool } from '../editor/types';
import { FONT_FAMILIES, layoutText } from '../pdf/fonts';
import { getEmbeddedFont } from '../pdf/embeddedFonts';
import { ColorSwatch, Divider, NumberField, Select, ToolButton } from './controls';
import { Icon } from './Icons';

const TOOL_HINTS: Partial<Record<Tool, string>> = {
  select: 'Click an element to select it. Drag to move, use the handles to resize or rotate. Select text on the page to highlight it.',
  text: 'Click anywhere on a page to add a text box.',
  'edit-text': 'Click a line of existing text to replace it. The original is covered and your text is placed on top.',
  draw: 'Draw freehand on the page.',
  highlight: 'Select text to highlight it, or drag over an area.',
  rect: 'Drag to draw a rectangle.',
  ellipse: 'Drag to draw an ellipse.',
  line: 'Drag to draw a line.',
  arrow: 'Drag to draw an arrow.',
  cover: 'Drag over content to cover it with a solid box. Covered content is removed from view in the exported PDF.',
  checkbox: 'Click to place a checkbox.',
};

export function ContextBar() {
  const selectedIds = useEditor((s) => s.selectedIds);
  const pages = useEditor((s) => s.pages);
  const tool = useEditor((s) => s.tool);
  const settings = useEditor((s) => s.toolSettings);
  const editingId = useEditor((s) => s.editingId);

  const selected = useMemo(() => {
    if (!selectedIds.length) return [];
    const set = new Set(selectedIds);
    const out: EditorElement[] = [];
    for (const p of pages) for (const e of p.elements) if (set.has(e.id)) out.push(e);
    return out;
  }, [selectedIds, pages]);

  const beforeRef = useRef<EditorPage[] | null>(null);
  const patch = (p: Partial<EditorElement> | ((e: EditorElement) => EditorElement), final = true) => {
    if (!beforeRef.current) beforeRef.current = getState().pages;
    updateElements(selectedIds, p, { transient: true });
    if (final) {
      commitFrom(beforeRef.current);
      beforeRef.current = null;
    }
  };
  // Live colour previews are transient; commit once when the picker closes.
  const colorPatch = (key: string) => (v: string | null) => patch({ [key]: v } as Partial<EditorElement>, false);
  const commitColor = () => {
    if (beforeRef.current) {
      commitFrom(beforeRef.current);
      beforeRef.current = null;
    }
  };

  if (!selected.length) {
    return <div className="contextbar" onPointerUp={commitColor}>{renderToolDefaults(tool, settings)}</div>;
  }

  const first = selected[0];
  const sameType = selected.every((e) => e.type === first.type);
  const single = selected.length === 1;

  return (
    <div className="contextbar" onPointerUp={commitColor} onBlur={commitColor}>
      <span className="ctx-label">{describe(selected)}</span>
      <Divider />
      {sameType && first.type === 'text' && (
        <TextControls el={first} patch={patch} colorPatch={colorPatch} />
      )}
      {sameType && first.type === 'shape' && (
        <>
          <span className="ctx-field"><span>Stroke</span><ColorSwatch label="Stroke colour" value={first.strokeColor} onChange={colorPatch('strokeColor')} allowNone /></span>
          <NumberField label="Stroke width" value={first.strokeWidth} min={0} max={40} step={0.5} suffix="pt" onChange={(v) => patch({ strokeWidth: v })} />
          <span className="ctx-field"><span>Fill</span><ColorSwatch label="Fill colour" value={first.fillColor} onChange={colorPatch('fillColor')} allowNone /></span>
        </>
      )}
      {sameType && first.type === 'line' && (
        <>
          <span className="ctx-field"><span>Colour</span><ColorSwatch label="Line colour" value={first.strokeColor} onChange={colorPatch('strokeColor')} /></span>
          <NumberField label="Stroke width" value={first.strokeWidth} min={0.5} max={40} step={0.5} suffix="pt" onChange={(v) => patch({ strokeWidth: v })} />
          <ToolButton icon="arrow" label="Arrow head at end" active={first.arrowEnd} onClick={() => patch({ arrowEnd: !first.arrowEnd })} />
          <ToolButton icon="arrow" label="Arrow head at start" active={first.arrowStart} onClick={() => patch({ arrowStart: !first.arrowStart })} className="flip-x" />
        </>
      )}
      {sameType && first.type === 'path' && (
        <>
          <span className="ctx-field"><span>Colour</span><ColorSwatch label="Stroke colour" value={first.strokeColor} onChange={colorPatch('strokeColor')} /></span>
          <NumberField label="Stroke width" value={first.strokeWidth} min={0.5} max={40} step={0.5} suffix="pt" onChange={(v) => patch({ strokeWidth: v })} />
        </>
      )}
      {sameType && first.type === 'markup' && (
        <>
          <span className="ctx-field"><span>Colour</span><ColorSwatch label="Markup colour" value={first.color} onChange={colorPatch('color')} /></span>
          <Select
            label="Markup type"
            value={first.kind}
            options={[{ value: 'highlight', label: 'Highlight' }, { value: 'underline', label: 'Underline' }, { value: 'strikethrough', label: 'Strikethrough' }]}
            onChange={(kind) => patch({ kind })}
          />
        </>
      )}
      {sameType && first.type === 'cover' && (
        <span className="ctx-field"><span>Colour</span><ColorSwatch label="Cover colour" value={first.color} onChange={colorPatch('color')} /></span>
      )}
      {sameType && first.type === 'checkbox' && (
        <>
          <Select
            label="Style"
            value={first.style}
            options={[{ value: 'check', label: 'Check' }, { value: 'cross', label: 'Cross' }, { value: 'radio', label: 'Radio' }]}
            onChange={(style) => patch({ style })}
          />
          <ToolButton icon="check" label="Checked" active={first.checked} onClick={() => patch({ checked: !first.checked })} />
          <span className="ctx-field"><span>Colour</span><ColorSwatch label="Colour" value={first.color} onChange={colorPatch('color')} /></span>
          <NumberField label="Size" value={first.width} min={6} max={200} suffix="pt" onChange={(v) => patch({ width: v, height: v })} />
        </>
      )}
      <Divider />
      <span className="ctx-field"><span>Opacity</span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={first.opacity}
          aria-label="Opacity"
          onChange={(e) => patch({ opacity: parseFloat(e.target.value) }, false)}
          onPointerUp={commitColor}
          onKeyUp={commitColor}
        />
      </span>
      {single && first.type !== 'markup' && first.type !== 'line' && (
        <NumberField label="Rotation" value={((first.rotation % 360) + 360) % 360} min={0} max={359} suffix="°" onChange={(v) => patch({ rotation: v })} />
      )}
      <Divider />
      <ToolButton icon="front" label="Bring to front" onClick={() => reorderSelected('front')} />
      <ToolButton icon="back" label="Send to back" onClick={() => reorderSelected('back')} />
      <ToolButton icon="duplicate" label="Duplicate" shortcut="⌘D" onClick={duplicateSelected} />
      <ToolButton icon="trash" label="Delete" shortcut="Del" onClick={deleteSelected} disabled={!!editingId} />
    </div>
  );
}

function TextControls({
  el,
  patch,
  colorPatch,
}: {
  el: TextElement;
  patch: (p: Partial<EditorElement>, final?: boolean) => void;
  colorPatch: (key: string) => (v: string | null) => void;
}) {
  const substituted = useMemo(() => layoutText(el).substituted, [el]);
  const embedded = getEmbeddedFont(el.embeddedFont);
  // The last document font this element used, so it can be re-selected after switching away.
  const lastEmbedded = useRef<string | null>(el.embeddedFont);
  if (el.embeddedFont) lastEmbedded.current = el.embeddedFont;
  const original = getEmbeddedFont(lastEmbedded.current);
  const familyValue = embedded ? 'original' : el.fontFamily;
  const familyOptions: { value: string; label: string }[] = [
    ...(original ? [{ value: 'original', label: `Original (${original.baseFont.replace(/^[A-Z]{6}\+/, '')})` }] : []),
    ...FONT_FAMILIES.map((f) => ({ value: f, label: f === 'Times' ? 'Times Roman' : f })),
  ];
  return (
    <>
      <Select
        label="Font family"
        value={familyValue}
        options={familyOptions}
        onChange={(v) => (v === 'original' ? patch({ embeddedFont: lastEmbedded.current, hScale: 1 }) : patch({ fontFamily: v as FontFamily, embeddedFont: null }))}
      />
      <NumberField label="Font size" value={el.fontSize} min={4} max={300} suffix="pt" onChange={(v) => patch({ fontSize: v })} />
      <ToolButton
        icon="bold"
        label={embedded ? 'Bold (switches to a standard font)' : 'Bold'}
        shortcut="⌘B"
        active={el.bold}
        onClick={() => patch({ bold: !el.bold, embeddedFont: null })}
      />
      <ToolButton
        icon="italic"
        label={embedded ? 'Italic (switches to a standard font)' : 'Italic'}
        shortcut="⌘I"
        active={el.italic}
        onClick={() => patch({ italic: !el.italic, embeddedFont: null })}
      />
      <ToolButton icon="underline" label="Underline" shortcut="⌘U" active={el.underline} onClick={() => patch({ underline: !el.underline })} />
      <Divider />
      <ToolButton icon="align-left" label="Align left" active={el.align === 'left'} onClick={() => patch({ align: 'left' })} />
      <ToolButton icon="align-center" label="Align centre" active={el.align === 'center'} onClick={() => patch({ align: 'center' })} />
      <ToolButton icon="align-right" label="Align right" active={el.align === 'right'} onClick={() => patch({ align: 'right' })} />
      <Divider />
      <span className="ctx-field"><span>Colour</span><ColorSwatch label="Text colour" value={el.color} onChange={colorPatch('color')} /></span>
      <span className="ctx-field"><span>Fill</span><ColorSwatch label="Background colour" value={el.background} onChange={colorPatch('background')} allowNone /></span>
      <span className="ctx-field"><span>Width</span>
        <NumberField label="Horizontal glyph scale" value={Math.round(el.hScale * 100)} min={50} max={200} suffix="%" width={64} onChange={(v) => patch({ hScale: v / 100 })} />
      </span>
      {substituted && (
        <span className="ctx-warning" title="Standard PDF fonts only support Latin characters. Unsupported characters are replaced in the export.">
          <Icon name="warning" size={14} /> Some characters not supported
        </span>
      )}
    </>
  );
}

function renderToolDefaults(tool: Tool, s: ReturnType<typeof getState>['toolSettings']) {
  const hint = <span className="ctx-hint">{TOOL_HINTS[tool]}</span>;
  switch (tool) {
    case 'draw':
    case 'rect':
    case 'ellipse':
    case 'line':
    case 'arrow':
      return (
        <>
          <span className="ctx-field"><span>Stroke</span><ColorSwatch label="Stroke colour" value={s.strokeColor} onChange={(v) => v && setToolSetting('strokeColor', v)} /></span>
          <NumberField label="Stroke width" value={s.strokeWidth} min={0.5} max={40} step={0.5} suffix="pt" onChange={(v) => setToolSetting('strokeWidth', v)} />
          {(tool === 'rect' || tool === 'ellipse') && (
            <span className="ctx-field"><span>Fill</span><ColorSwatch label="Fill colour" value={s.fillColor} onChange={(v) => setToolSetting('fillColor', v)} allowNone /></span>
          )}
          <Divider />
          {hint}
        </>
      );
    case 'highlight':
      return (
        <>
          <span className="ctx-field"><span>Colour</span><ColorSwatch label="Highlight colour" value={s.highlightColor} onChange={(v) => v && setToolSetting('highlightColor', v)} /></span>
          <Divider />
          {hint}
        </>
      );
    case 'text':
    case 'edit-text':
      return (
        <>
          <Select
            label="Font family"
            value={s.fontFamily}
            options={FONT_FAMILIES.map((f) => ({ value: f, label: f === 'Times' ? 'Times Roman' : f }))}
            onChange={(v: FontFamily) => setToolSetting('fontFamily', v)}
          />
          <NumberField label="Font size" value={s.fontSize} min={4} max={300} suffix="pt" onChange={(v) => setToolSetting('fontSize', v)} />
          <span className="ctx-field"><span>Colour</span><ColorSwatch label="Text colour" value={s.textColor} onChange={(v) => v && setToolSetting('textColor', v)} /></span>
          <Divider />
          {hint}
        </>
      );
    case 'cover':
      return (
        <>
          <span className="ctx-field"><span>Colour</span><ColorSwatch label="Cover colour" value={s.coverColor} onChange={(v) => v && setToolSetting('coverColor', v)} /></span>
          <Divider />
          {hint}
        </>
      );
    default:
      return hint;
  }
}

function describe(elements: EditorElement[]): string {
  if (elements.length > 1) return `${elements.length} elements`;
  const el = elements[0];
  switch (el.type) {
    case 'text': return 'Text';
    case 'image': return 'Image';
    case 'path': return el.kind === 'signature' ? 'Signature' : 'Drawing';
    case 'shape': return el.shape === 'rect' ? 'Rectangle' : 'Ellipse';
    case 'line': return el.arrowEnd || el.arrowStart ? 'Arrow' : 'Line';
    case 'markup': return el.kind === 'highlight' ? 'Highlight' : el.kind === 'underline' ? 'Underline' : 'Strikethrough';
    case 'cover': return 'Cover';
    case 'checkbox': return 'Checkbox';
  }
}
