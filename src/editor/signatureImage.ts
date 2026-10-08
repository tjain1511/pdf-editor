/**
 * Turns a photo or scan of a handwritten signature into a clean, transparent
 * "inked" image: uneven lighting and paper texture are removed, the ink is
 * isolated, specks are cleaned up and the result is re-coloured with a solid
 * ink colour. Everything runs on the main thread with typed arrays and is
 * fast enough for interactive slider adjustments at the working resolution.
 */

/** Longest side of the working image, in pixels. */
const MAX_SIDE = 1400;

export interface SignatureSource {
  width: number;
  height: number;
  /** Illumination-normalised darkness per pixel: 0 = paper, 1 = solid ink. */
  darkness: Float32Array;
  /** Otsu-derived ink threshold in darkness units. */
  autoThreshold: number;
}

export interface SignatureOptions {
  /** -1..1: negative keeps only the darkest ink, positive picks up fainter strokes. */
  sensitivity: number;
  /** 0..100: how aggressively small specks are discarded. */
  cleanup: number;
  /** -2..2: thin or thicken strokes by this many pixels. */
  weight: number;
  /** Ink colour as #rrggbb. */
  color: string;
}

export const DEFAULT_SIGNATURE_OPTIONS: SignatureOptions = { sensitivity: 0, cleanup: 30, weight: 0, color: '#1a1a2e' };

export interface SignatureResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/** Decode a photo and compute the normalised darkness map used by {@link renderSignature}. */
export async function loadSignatureSource(file: Blob): Promise<SignatureSource> {
  if (file.size > 50 * 1024 * 1024) throw new Error('Image is too large (max 50 MB).');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This file could not be read as an image.');
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const gray = toGray(data, width * height);
    const background = estimateBackground(gray, width, height);
    const darkness = new Float32Array(width * height);
    for (let i = 0; i < darkness.length; i++) {
      const bg = Math.max(background[i], 24);
      darkness[i] = Math.min(1, Math.max(0, 1 - gray[i] / bg));
    }
    return { width, height, darkness, autoThreshold: otsu(darkness) };
  } finally {
    bitmap.close();
  }
}

/**
 * Perceived darkness per pixel. The minimum channel is blended in so coloured
 * inks (blue, red) read as dark even when their luminance is not very low.
 */
function toGray(data: Uint8ClampedArray, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const a = data[p + 3] / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const min = Math.min(r, g, b);
    // Transparent areas count as paper.
    out[i] = (0.45 * lum + 0.55 * min) * a + 255 * (1 - a);
  }
  return out;
}

/**
 * Estimate the paper brightness under every pixel so shadows and vignetting
 * can be divided out. A first large box mean is used to tell paper from ink,
 * then the mean is recomputed over paper pixels only so the ink does not
 * darken its own surroundings.
 */
function estimateBackground(gray: Float32Array, w: number, h: number): Float32Array {
  const radius = Math.max(8, Math.round(Math.max(w, h) / 14));
  const rough = boxMean(gray, null, w, h, radius);
  const paper = new Uint8Array(w * h);
  for (let i = 0; i < paper.length; i++) paper[i] = gray[i] >= rough[i] * 0.92 ? 1 : 0;
  return boxMean(gray, paper, w, h, radius, rough);
}

/** Box-filtered mean using integral images; with a mask only masked pixels contribute. */
function boxMean(values: Float32Array, mask: Uint8Array | null, w: number, h: number, radius: number, fallback?: Float32Array): Float32Array {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  const cnt = new Float64Array(W * (h + 1));
  for (let y = 1; y <= h; y++) {
    let rowSum = 0;
    let rowCnt = 0;
    const row = (y - 1) * w;
    for (let x = 1; x <= w; x++) {
      const i = row + x - 1;
      const on = mask ? mask[i] : 1;
      if (on) {
        rowSum += values[i];
        rowCnt++;
      }
      sum[y * W + x] = sum[(y - 1) * W + x] + rowSum;
      cnt[y * W + x] = cnt[(y - 1) * W + x] + rowCnt;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      const s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0];
      const c = cnt[y1 * W + x1] - cnt[y0 * W + x1] - cnt[y1 * W + x0] + cnt[y0 * W + x0];
      out[y * w + x] = c > 0 ? s / c : fallback ? fallback[y * w + x] : 255;
    }
  }
  return out;
}

/** Otsu's threshold over the darkness map, clamped to a sensible ink range. */
function otsu(darkness: Float32Array): number {
  const bins = 256;
  const hist = new Float64Array(bins);
  for (let i = 0; i < darkness.length; i++) hist[Math.min(bins - 1, Math.round(darkness[i] * (bins - 1)))]++;
  // Ignore the paper spike so a mostly-blank photo still yields a useful split.
  hist[0] = 0;
  hist[1] = 0;
  let total = 0;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) {
    total += hist[i];
    sumAll += i * hist[i];
  }
  if (!total) return 0.3;
  let best = 0;
  let bestVar = -1;
  let wB = 0;
  let sumB = 0;
  for (let t = 0; t < bins; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) {
      bestVar = v;
      best = t;
    }
  }
  return Math.min(0.6, Math.max(0.12, best / (bins - 1)));
}

/** Render the cleaned, re-inked signature. Returns null when no ink is found. */
export function renderSignature(src: SignatureSource, opts: SignatureOptions): SignatureResult | null {
  const { width: w, height: h, darkness } = src;
  const n = w * h;
  // Sensitivity shifts the threshold between "darkest ink only" and "faint strokes too".
  const t = clamp(src.autoThreshold * (1 - opts.sensitivity * 0.7), 0.04, 0.95);
  const band = Math.max(0.03, t * 0.25);
  let alpha: Float32Array = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = clamp((darkness[i] - (t - band)) / (2 * band), 0, 1);

  // Drop small specks: label connected components of the solid ink and keep the big ones.
  const minArea = Math.round(((opts.cleanup * opts.cleanup) / 16) * (n / (MAX_SIDE * MAX_SIDE * 0.75)));
  const keep = keepLargeComponents(alpha, w, h, Math.max(minArea, 2));
  dilate(keep, w, h);
  for (let i = 0; i < n; i++) if (!keep[i]) alpha[i] = 0;

  // Stroke weight: grow or shrink the ink by whole pixels.
  for (let k = 0; k < Math.abs(opts.weight); k++) alpha = opts.weight > 0 ? rankFilter(alpha, w, h, Math.max) : rankFilter(alpha, w, h, Math.min);

  // Soften edges once so the strokes look anti-aliased rather than jagged.
  alpha = blur3(alpha, w, h);

  // Crop to the ink with a little padding.
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > 0.02) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;

  const [r, g, b] = hexToRgb(opts.color);
  const out = new ImageData(cw, ch);
  const px = out.data;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const a = alpha[(y + minY) * w + (x + minX)];
      const p = (y * cw + x) * 4;
      px[p] = r;
      px[p + 1] = g;
      px[p + 2] = b;
      px[p + 3] = Math.round(a * 255);
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  canvas.getContext('2d')!.putImageData(out, 0, 0);
  return { canvas, width: cw, height: ch };
}

/** Encode a rendered signature as a transparent PNG. */
export function signatureToPng(result: SignatureResult): Promise<Blob> {
  return new Promise((resolve, reject) =>
    result.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode signature'))), 'image/png'),
  );
}

/** 8-connected component labelling of solid ink (alpha >= 0.5); returns a mask of components with area >= minArea. */
function keepLargeComponents(alpha: Float32Array, w: number, h: number, minArea: number): Uint8Array {
  const n = w * h;
  const label = new Int32Array(n);
  const keep = new Uint8Array(n);
  const stack = new Int32Array(n);
  const members: number[] = [];
  let next = 0;
  for (let start = 0; start < n; start++) {
    if (label[start] || alpha[start] < 0.5) continue;
    next++;
    let sp = 0;
    stack[sp++] = start;
    label[start] = next;
    members.length = 0;
    while (sp) {
      const i = stack[--sp];
      members.push(i);
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (label[j] || alpha[j] < 0.5) continue;
          label[j] = next;
          stack[sp++] = j;
        }
      }
    }
    if (members.length >= minArea) for (const i of members) keep[i] = 1;
  }
  return keep;
}

/** In-place 3x3 dilation of a binary mask so anti-aliased fringes around kept ink survive. */
function dilate(mask: Uint8Array, w: number, h: number): void {
  const src = mask.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[y * w + x]) continue;
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && src[yy * w + xx]) {
            on = 1;
            break;
          }
        }
      }
      mask[y * w + x] = on;
    }
  }
}

/** 3x3 max (dilate) or min (erode) filter on a float image. */
function rankFilter(src: Float32Array, w: number, h: number, pick: (a: number, b: number) => number): Float32Array<ArrayBuffer> {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = src[row + x];
      if (x > 0) v = pick(v, src[row + x - 1]);
      if (x < w - 1) v = pick(v, src[row + x + 1]);
      tmp[row + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      if (y > 0) v = pick(v, tmp[(y - 1) * w + x]);
      if (y < h - 1) v = pick(v, tmp[(y + 1) * w + x]);
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Separable [1 2 1]/4 blur. */
function blur3(src: Float32Array, w: number, h: number): Float32Array<ArrayBuffer> {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const l = src[row + Math.max(0, x - 1)];
      const r = src[row + Math.min(w - 1, x + 1)];
      tmp[row + x] = (l + 2 * src[row + x] + r) / 4;
    }
  }
  for (let y = 0; y < h; y++) {
    const up = Math.max(0, y - 1) * w;
    const dn = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) out[y * w + x] = (tmp[up + x] + 2 * tmp[y * w + x] + tmp[dn + x]) / 4;
  }
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [26, 26, 46];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
