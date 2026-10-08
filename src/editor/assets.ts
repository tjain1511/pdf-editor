/**
 * Binary image assets referenced by image elements. Stored outside the
 * undo history so snapshots stay cheap, and exposed as object URLs for display.
 */
export interface ImageAsset {
  id: string;
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  url: string;
  width: number;
  height: number;
}

const assets = new Map<string, ImageAsset>();

export function getAsset(id: string): ImageAsset | undefined {
  return assets.get(id);
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function decode(blob: Blob, orientation: 'none' | 'from-image'): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: orientation });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode image'))), type, quality),
  );
}

/**
 * Import an image file. PNG and JPEG bytes are kept as-is (unless EXIF
 * orientation would change the display), everything else is converted to PNG.
 */
export async function importImage(file: Blob): Promise<ImageAsset> {
  if (file.size > 50 * 1024 * 1024) throw new Error('Image is too large (max 50 MB).');
  const oriented = await decode(file, 'from-image');
  let bytes: Uint8Array;
  let mime: 'image/png' | 'image/jpeg';
  let keep = file.type === 'image/png' || file.type === 'image/jpeg';
  if (keep && file.type === 'image/jpeg') {
    // Only keep raw JPEG bytes if orientation metadata does not rotate the image.
    const raw = await decode(file, 'none');
    keep = raw.width === oriented.width && raw.height === oriented.height;
    raw.close();
  }
  if (keep) {
    bytes = new Uint8Array(await file.arrayBuffer());
    mime = file.type as 'image/png' | 'image/jpeg';
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = oriented.width;
    canvas.height = oriented.height;
    canvas.getContext('2d')!.drawImage(oriented, 0, 0);
    const blob = await canvasToBlob(canvas, 'image/png');
    bytes = new Uint8Array(await blob.arrayBuffer());
    mime = 'image/png';
  }
  const asset: ImageAsset = {
    id: newId(),
    bytes,
    mime,
    url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })),
    width: oriented.width,
    height: oriented.height,
  };
  oriented.close();
  assets.set(asset.id, asset);
  return asset;
}

export function releaseAllAssets(): void {
  for (const a of assets.values()) URL.revokeObjectURL(a.url);
  assets.clear();
}

/** Release assets no longer referenced. */
export function pruneAssets(referenced: Set<string>): void {
  for (const [id, a] of assets) {
    if (!referenced.has(id)) {
      URL.revokeObjectURL(a.url);
      assets.delete(id);
    }
  }
}
