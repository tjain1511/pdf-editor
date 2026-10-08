import { memo, useMemo, type CSSProperties, type ReactElement } from 'react';
import type { EditorElement, EditorPage, TextElement } from '../editor/types';
import { getState, useEditor } from '../editor/store';
import { commitFrom, moveElement, select, startEditing, stopEditing, toggleSelect, updateElement, updateElements } from '../editor/actions';
import { clampToPage, findElement, pageSize } from '../editor/pageUtils';
import { dragGesture } from '../editor/interaction';
import { getAsset } from '../editor/assets';
import { CSS_FONT_STACK, TEXT_PADDING, layoutText } from '../pdf/fonts';
import { getEmbeddedFont, renderTokens, segmentText } from '../pdf/embeddedFonts';
import { arrowHead, checkboxGeometry, ellipseSvgPath, lineEndpoints, pathStrokes, pathSvg } from '../pdf/shapes';
import { TextEditor } from './TextEditor';

export const ElementLayer = memo(function ElementLayer({ page, scale }: { page: EditorPage; pageIndex: number; scale: number }) {
  const tool = useEditor((s) => s.tool);
  const editingId = useEditor((s) => s.editingId);
  return (
    <div className={`element-layer${tool === 'select' ? ' is-interactive' : ''}`}>
      {page.elements.map((el) => (
        <ElementView key={el.id} el={el} page={page} scale={scale} editing={editingId === el.id} interactive={tool === 'select'} />
      ))}
    </div>
  );
});

const ElementView = memo(function ElementView({
  el,
  page,
  scale,
  editing,
  interactive,
}: {
  el: EditorElement;
  page: EditorPage;
  scale: number;
  editing: boolean;
  interactive: boolean;
}) {
  const style: CSSProperties = {
    left: el.x * scale,
    top: el.y * scale,
    width: el.width * scale,
    height: editing ? 'auto' : el.height * scale,
    minHeight: editing ? el.height * scale : undefined,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    opacity: el.opacity < 1 ? el.opacity : undefined,
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || e.button !== 0) return;
    e.stopPropagation();
    const s = getState();
    if (s.editingId === el.id) return;
    if (s.editingId) stopEditing();
    let ids: string[];
    if (e.shiftKey) {
      toggleSelect(el.id);
      ids = getState().selectedIds;
    } else if (!s.selectedIds.includes(el.id)) {
      select([el.id]);
      ids = [el.id];
    } else ids = s.selectedIds;
    if (!ids.includes(el.id)) return;
    const before = getState().pages;
    const starts = new Map<string, EditorElement>();
    for (const id of ids) {
      const found = findElement(before, id);
      if (found) starts.set(id, found.element);
    }
    const size = pageSize(page);
    dragGesture(e, {
      onMove: (dx, dy) => {
        updateElements(ids, (cur) => {
          const st = starts.get(cur.id);
          return st ? clampToPage(moveElement(st, dx / scale, dy / scale), size) : cur;
        }, { transient: true });
      },
      onEnd: (moved) => {
        if (moved) commitFrom(before);
      },
    });
  };

  const onDoubleClick = () => {
    if (!interactive) return;
    if (el.type === 'text') startEditing(el.id);
    else if (el.type === 'checkbox') updateElement(el.id, { checked: !el.checked });
  };

  return (
    <div
      className={`el el-${el.type}${el.type === 'markup' ? ` markup-${el.kind}` : ''}`}
      style={style}
      data-el-id={el.id}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <ElementContent el={el} scale={scale} editing={editing} />
    </div>
  );
});

function ElementContent({ el, scale, editing }: { el: EditorElement; scale: number; editing: boolean }) {
  switch (el.type) {
    case 'text':
      return editing ? <TextEditor el={el} scale={scale} /> : <TextLines el={el} scale={scale} />;
    case 'image': {
      const asset = getAsset(el.assetId);
      return asset ? <img src={asset.url} alt="" draggable={false} /> : <div className="el-missing">Image missing</div>;
    }
    case 'cover':
      return <div className="cover-fill" style={{ background: el.color }} />;
    default:
      return <ElementSvg el={el} scale={scale} />;
  }
}

function TextLines({ el, scale }: { el: TextElement; scale: number }) {
  const layout = useMemo(() => layoutText(el), [el]);
  const h = el.hScale > 0 ? el.hScale : 1;
  const embedded = getEmbeddedFont(el.embeddedFont);
  const fallbackFamily = CSS_FONT_STACK[el.fontFamily];
  const renderLine = (line: string) => {
    if (!embedded) return line || '\u00a0';
    if (!line) return '\u00a0';
    return segmentText(line, embedded).map((seg, k) =>
      seg.embedded ? (
        <span key={k} style={{ fontFamily: `"${embedded.loadedName}", ${fallbackFamily}` }}>
          {renderTokens(seg.text, embedded).map((tok, j) =>
            tok.kind === 'glyphs' ? (
              <span key={j}>{tok.text}</span>
            ) : (
              <span key={j} style={{ display: 'inline-block', width: tok.advance * el.fontSize * scale }} />
            ),
          )}
        </span>
      ) : (
        <span key={k}>{seg.text}</span>
      ),
    );
  };
  return (
    <div
      className="text-lines"
      style={{
        width: h !== 1 ? `${100 / h}%` : undefined,
        transform: h !== 1 ? `scaleX(${h})` : undefined,
        transformOrigin: 'left top',
        fontFamily: CSS_FONT_STACK[el.fontFamily],
        fontSize: el.fontSize * scale,
        lineHeight: `${layout.lineHeight * scale}px`,
        fontWeight: el.bold ? 700 : 400,
        fontStyle: el.italic ? 'italic' : 'normal',
        textDecoration: el.underline ? 'underline' : undefined,
        textAlign: el.align,
        color: el.color,
        padding: TEXT_PADDING * scale,
        background: el.background ?? undefined,
      }}
    >
      {layout.lines.map((line, i) => (
        <div key={i} className="text-line">
          {renderLine(line)}
        </div>
      ))}
    </div>
  );
}

/** Vector elements are drawn in element-local pixel coordinates (rotation is applied by the container). */
function ElementSvg({ el, scale }: { el: EditorElement; scale: number }) {
  const w = el.width * scale;
  const h = el.height * scale;
  let body: ReactElement | null = null;
  switch (el.type) {
    case 'shape': {
      const sw = el.strokeWidth * scale;
      const stroke = el.strokeColor && el.strokeWidth > 0 ? el.strokeColor : 'none';
      const fill = el.fillColor ?? 'none';
      body =
        el.shape === 'rect' ? (
          <rect x={0} y={0} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={sw} />
        ) : (
          <path d={ellipseSvgPath({ x: 0, y: 0, width: w, height: h }, 0)} fill={fill} stroke={stroke} strokeWidth={sw} />
        );
      break;
    }
    case 'line': {
      const local = { ...el, x: 0, y: 0, width: w, height: h, rotation: 0 };
      const { from, to } = lineEndpoints(local);
      const sw = el.strokeWidth * scale;
      body = (
        <>
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={el.strokeColor} strokeWidth={sw} strokeLinecap="round" />
          {el.arrowEnd && <polygon points={pts(arrowHead(from, to, sw))} fill={el.strokeColor} />}
          {el.arrowStart && <polygon points={pts(arrowHead(to, from, sw))} fill={el.strokeColor} />}
        </>
      );
      break;
    }
    case 'path': {
      const local = { ...el, x: 0, y: 0, width: w, height: h, rotation: 0 };
      const sw = el.strokeWidth * scale;
      body = (
        <>
          {pathStrokes(local).map((stroke, i) =>
            stroke.length === 1 ? (
              <circle key={i} cx={stroke[0].x} cy={stroke[0].y} r={sw / 2} fill={el.strokeColor} />
            ) : (
              <path key={i} d={pathSvg(stroke)} fill="none" stroke={el.strokeColor} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
            ),
          )}
        </>
      );
      break;
    }
    case 'markup': {
      body = (
        <>
          {el.rects.map((r, i) => {
            const x = (r.x - el.x) * scale;
            const y = (r.y - el.y) * scale;
            const rw = r.width * scale;
            const rh = r.height * scale;
            if (el.kind === 'highlight') return <rect key={i} x={x} y={y} width={rw} height={rh} fill={el.color} />;
            const t = Math.max(0.6, r.height * 0.06) * scale;
            const ly = el.kind === 'underline' ? y + rh - t : y + rh * 0.58;
            return <rect key={i} x={x} y={ly} width={rw} height={t} fill={el.color} />;
          })}
        </>
      );
      break;
    }
    case 'checkbox': {
      const geo = checkboxGeometry({ ...el, x: 0, y: 0, width: w, height: h, rotation: 0 });
      body = (
        <>
          {geo.box && <polygon points={pts(geo.box)} fill="none" stroke={el.color} strokeWidth={geo.boxStroke} />}
          {geo.circle && <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} fill="none" stroke={el.color} strokeWidth={geo.boxStroke} />}
          {geo.dot && <ellipse cx={w / 2} cy={h / 2} rx={geo.dot.width / 2} ry={geo.dot.height / 2} fill={el.color} />}
          {geo.strokes.map((s, i) => (
            <polyline key={i} points={pts(s)} fill="none" stroke={el.color} strokeWidth={geo.markStroke} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </>
      );
      break;
    }
    default:
      return null;
  }
  return (
    <svg className="el-svg" width={Math.max(w, 1)} height={Math.max(h, 1)} style={{ overflow: 'visible' }} aria-hidden="true">
      {body}
    </svg>
  );
}

const pts = (points: { x: number; y: number }[]) => points.map((p) => `${p.x},${p.y}`).join(' ');
