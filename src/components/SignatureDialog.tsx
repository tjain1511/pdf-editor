import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { Point } from '../editor/types';
import { addElement, setTool } from '../editor/actions';
import { getState, notify } from '../editor/store';
import { createImage, createPath } from '../editor/factory';
import { importImage } from '../editor/assets';
import { pageSize } from '../editor/pageUtils';
import { isImageFile } from '../editor/interaction';
import {
  DEFAULT_SIGNATURE_OPTIONS,
  loadSignatureSource,
  renderSignature,
  signatureToPng,
  type SignatureOptions,
  type SignatureResult,
  type SignatureSource,
} from '../editor/signatureImage';
import { pathSvg } from '../pdf/shapes';
import { boundsOf } from '../pdf/geometry';
import { Modal } from './Dialogs';
import { ColorSwatch } from './controls';
import { Icon } from './Icons';

const PAD_W = 560;
const PAD_H = 220;

type DrawnSignature = { kind: 'drawn'; strokes: Point[][]; color: string; width: number };
type ImageSignature = { kind: 'image'; png: Blob; url: string; width: number; height: number };
type SavedSignature = DrawnSignature | ImageSignature;

/** Signatures created during this session, kept in memory only. */
const savedSignatures: SavedSignature[] = [];

function remember(sig: SavedSignature): void {
  if (savedSignatures.includes(sig)) return;
  savedSignatures.unshift(sig);
  while (savedSignatures.length > 5) {
    const dropped = savedSignatures.pop()!;
    if (dropped.kind === 'image') URL.revokeObjectURL(dropped.url);
  }
}

function forgetAll(): void {
  for (const s of savedSignatures) if (s.kind === 'image') URL.revokeObjectURL(s.url);
  savedSignatures.length = 0;
}

/** Place a signature on the current page, centred and scaled to a comfortable width. */
async function insertSignature(sig: SavedSignature): Promise<void> {
  const s = getState();
  if (!s.pages.length) return;
  const pageIndex = Math.min(s.currentPage, s.pages.length - 1);
  const { width: pw, height: ph } = pageSize(s.pages[pageIndex]);
  const targetW = Math.min(200, pw * 0.45);
  if (sig.kind === 'drawn') {
    const b = boundsOf(sig.strokes.flat());
    const k = targetW / Math.max(b.width, 1);
    const ox = (pw - b.width * k) / 2;
    const oy = (ph - b.height * k) / 2;
    const scaled = sig.strokes.map((st) => st.map((p) => ({ x: ox + (p.x - b.x) * k, y: oy + (p.y - b.y) * k })));
    addElement(pageIndex, createPath(scaled, { ...s.toolSettings, strokeColor: sig.color, strokeWidth: sig.width * k }, 'signature'));
  } else {
    const asset = await importImage(sig.png);
    const k = Math.min(targetW / asset.width, (ph * 0.3) / asset.height);
    const w = asset.width * k;
    const h = asset.height * k;
    addElement(pageIndex, createImage({ x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h }, asset.id));
  }
  setTool('select');
  remember(sig);
}

export function SignatureDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'draw' | 'upload'>('draw');
  const [saved, setSaved] = useState(savedSignatures.slice());

  const insert = async (sig: SavedSignature) => {
    try {
      await insertSignature(sig);
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not add the signature.', 'error');
    }
  };

  const recent = saved.length > 0 && (
    <div className="sig-saved">
      <span className="sig-saved-label">Recent</span>
      {saved.map((sig, i) => (
        <button key={i} type="button" className="sig-thumb" onClick={() => void insert(sig)} title="Insert this signature">
          {sig.kind === 'drawn' ? <DrawnThumb sig={sig} /> : <img src={sig.url} alt="" draggable={false} />}
        </button>
      ))}
      <button type="button" className="btn btn-small" onClick={() => { forgetAll(); setSaved([]); }}>Forget</button>
    </div>
  );

  return (
    <Modal title="Add signature" onClose={onClose} width={620}>
      <div className="seg" role="tablist" aria-label="Signature source">
        <button type="button" role="tab" aria-selected={mode === 'draw'} className={`seg-btn${mode === 'draw' ? ' is-active' : ''}`} onClick={() => setMode('draw')}>
          <Icon name="pen" size={15} /> Draw
        </button>
        <button type="button" role="tab" aria-selected={mode === 'upload'} className={`seg-btn${mode === 'upload' ? ' is-active' : ''}`} onClick={() => setMode('upload')}>
          <Icon name="image" size={15} /> Upload photo
        </button>
      </div>
      {mode === 'draw' ? <DrawPanel onInsert={insert} onCancel={onClose} recent={recent} /> : <UploadPanel onInsert={insert} onCancel={onClose} recent={recent} />}
    </Modal>
  );
}

function DrawnThumb({ sig }: { sig: DrawnSignature }) {
  const b = boundsOf(sig.strokes.flat());
  return (
    <svg viewBox={`${b.x - 4} ${b.y - 4} ${b.width + 8} ${b.height + 8}`} preserveAspectRatio="xMidYMid meet">
      {sig.strokes.map((st, k) => (
        <path key={k} d={pathSvg(st)} fill="none" stroke={sig.color} strokeWidth={sig.width * 1.4} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------------ */
/* Draw                                                                     */
/* ------------------------------------------------------------------------ */

interface PanelProps {
  onInsert: (sig: SavedSignature) => Promise<void>;
  onCancel: () => void;
  recent: ReactNode;
}

function DrawPanel({ onInsert, onCancel, recent }: PanelProps) {
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [color, setColor] = useState('#1a1a2e');
  const [width, setWidth] = useState(2.5);
  const svgRef = useRef<SVGSVGElement>(null);
  const current = useRef<Point[] | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const toLocal = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * PAD_W, y: ((e.clientY - r.top) / r.height) * PAD_H };
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      svg.setPointerCapture(e.pointerId);
      current.current = [toLocal(e)];
      setStrokes((s) => [...s, current.current!]);
    };
    const move = (e: PointerEvent) => {
      if (!current.current) return;
      const p = toLocal(e);
      const last = current.current[current.current.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 1) return;
      current.current.push(p);
      setStrokes((s) => s.slice());
    };
    const up = () => {
      current.current = null;
    };
    svg.addEventListener('pointerdown', down);
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    return () => {
      svg.removeEventListener('pointerdown', down);
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      svg.removeEventListener('pointercancel', up);
    };
  }, []);

  const nonEmpty = strokes.some((s) => s.length > 0);

  return (
    <>
      <div className="sig-toolbar">
        <span className="ctx-field"><span>Ink</span><ColorSwatch label="Ink colour" value={color} onChange={(v) => v && setColor(v)} /></span>
        <label className="ctx-field"><span>Thickness</span>
          <input type="range" min={1} max={6} step={0.5} value={width} onChange={(e) => setWidth(parseFloat(e.target.value))} aria-label="Thickness" />
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={() => setStrokes([])} disabled={!nonEmpty}>Clear</button>
      </div>
      <svg ref={svgRef} className="sig-pad" viewBox={`0 0 ${PAD_W} ${PAD_H}`} role="img" aria-label="Signature drawing area">
        <line x1={32} y1={PAD_H - 48} x2={PAD_W - 32} y2={PAD_H - 48} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="6 6" />
        {strokes.map((st, i) =>
          st.length === 1 ? (
            <circle key={i} cx={st[0].x} cy={st[0].y} r={width} fill={color} />
          ) : (
            <path key={i} d={pathSvg(st)} fill="none" stroke={color} strokeWidth={width * 1.4} strokeLinecap="round" strokeLinejoin="round" />
          ),
        )}
        {!nonEmpty && <text x={PAD_W / 2} y={PAD_H / 2} textAnchor="middle" className="sig-hint">Draw your signature here</text>}
      </svg>
      {recent}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="btn-primary"
          disabled={!nonEmpty}
          onClick={() => void onInsert({ kind: 'drawn', strokes: strokes.filter((s) => s.length), color, width })}
        >
          Add to page
        </button>
      </div>
      <p className="modal-note">Signatures are kept in memory for this session only and are never uploaded or stored.</p>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Upload photo                                                             */
/* ------------------------------------------------------------------------ */

function UploadPanel({ onInsert, onCancel, recent }: PanelProps) {
  const [source, setSource] = useState<SignatureSource | null>(null);
  const [opts, setOpts] = useState<SignatureOptions>(DEFAULT_SIGNATURE_OPTIONS);
  const [result, setResult] = useState<SignatureResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (file: File) => {
    if (!isImageFile(file)) {
      setError('Choose a PNG, JPEG, WebP or similar image file.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSource(await loadSignatureSource(file));
      setOpts((o) => ({ ...DEFAULT_SIGNATURE_OPTIONS, color: o.color }));
    } catch (err) {
      setSource(null);
      setError(err instanceof Error ? err.message : 'Could not read the image.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-render the cleaned signature whenever the photo or its settings change.
  useEffect(() => {
    if (!source) {
      setResult(null);
      setPreview(null);
      return;
    }
    const id = window.setTimeout(() => {
      const r = renderSignature(source, opts);
      setResult(r);
      setPreview(r ? r.canvas.toDataURL('image/png') : null);
    }, 40);
    return () => window.clearTimeout(id);
  }, [source, opts]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const file = Array.from(e.dataTransfer.files)[0];
    if (file) void load(file);
  };

  const add = async () => {
    if (!result) return;
    setAdding(true);
    try {
      const png = await signatureToPng(result);
      await onInsert({ kind: 'image', png, url: URL.createObjectURL(png), width: result.width, height: result.height });
    } finally {
      setAdding(false);
    }
  };

  const set = (patch: Partial<SignatureOptions>) => setOpts((o) => ({ ...o, ...patch }));

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void load(f);
        }}
      />
      {!source ? (
        <div
          className={`sig-drop${over ? ' is-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
        >
          <Icon name="upload" size={28} />
          <strong>{loading ? 'Reading photo…' : 'Choose a photo of your signature'}</strong>
          <span>or drop an image here</span>
          <span className="sig-drop-hint">Sign on plain white paper with a dark pen and photograph it in even light. The paper, shadows and specks are removed automatically.</span>
        </div>
      ) : (
        <>
          <div className="sig-controls">
            <label className="sig-ctl sig-ctl-ink">
              <span>Ink</span>
              <ColorSwatch label="Ink colour" value={opts.color} onChange={(v) => v && set({ color: v })} />
            </label>
            <label className="sig-ctl" title="Lower picks only the darkest ink; higher keeps fainter strokes">
              <span>Sensitivity</span>
              <input type="range" min={-1} max={1} step={0.05} value={opts.sensitivity} onChange={(e) => set({ sensitivity: parseFloat(e.target.value) })} aria-label="Sensitivity" />
            </label>
            <label className="sig-ctl" title="Removes dust, paper grain and other small specks">
              <span>Clean-up</span>
              <input type="range" min={0} max={100} step={1} value={opts.cleanup} onChange={(e) => set({ cleanup: parseInt(e.target.value, 10) })} aria-label="Clean-up" />
            </label>
            <label className="sig-ctl" title="Thin or thicken the strokes">
              <span>Weight</span>
              <input type="range" min={-2} max={2} step={1} value={opts.weight} onChange={(e) => set({ weight: parseInt(e.target.value, 10) })} aria-label="Stroke weight" />
            </label>
          </div>
          <div
            className={`sig-preview${over ? ' is-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            {preview ? (
              <img src={preview} alt="Cleaned signature preview" draggable={false} />
            ) : (
              <span className="sig-hint-text">{loading ? 'Reading photo…' : 'No ink found. Try raising the sensitivity or lowering clean-up.'}</span>
            )}
          </div>
          <div className="sig-secondary">
            <button type="button" className="btn btn-small" onClick={() => fileRef.current?.click()} disabled={loading}>
              <Icon name="image" size={14} /> Choose another photo
            </button>
            <button type="button" className="btn btn-small" onClick={() => setOpts((o) => ({ ...DEFAULT_SIGNATURE_OPTIONS, color: o.color }))}>Reset</button>
          </div>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
      {recent}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!result || adding} onClick={() => void add()}>
          {adding ? 'Adding…' : 'Add to page'}
        </button>
      </div>
      <p className="modal-note">Signatures are kept in memory for this session only and are never uploaded or stored.</p>
    </>
  );
}
