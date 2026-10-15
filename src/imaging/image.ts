import { applyFilter, type FilterId } from './filters';
import type { Quad } from './geometry';
import { warpPerspective } from './warp';
import type { Rotation } from '../store';

/** Long side cap for imported images; keeps memory bounded on phones. */
const MAX_SOURCE = 3200;
/** Long side of a saved page (about A4 at 300 dpi). */
export const PAGE_SIDE = 2480;

export function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}

/** Decodes an image file or blob (EXIF orientation applied) into a canvas. */
export async function loadImage(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  return drawScaled(bmp, bmp.width, bmp.height, MAX_SOURCE);
}

export function drawScaled(src: CanvasImageSource, w: number, h: number, maxSide: number): HTMLCanvasElement {
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = canvasOf(Math.round(w * s), Math.round(h * s));
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Crop + perspective correction + filter + rotation, at most maxSide pixels on the long side. */
export function renderPage(original: HTMLCanvasElement, quad: Quad, filter: FilterId, rotation: Rotation, maxSide: number): HTMLCanvasElement {
  const src = ctx2d(original).getImageData(0, 0, original.width, original.height);
  const filtered = applyFilter(warpPerspective(src, quad, maxSide), filter);
  const flat = canvasOf(filtered.width, filtered.height);
  ctx2d(flat).putImageData(filtered, 0, 0);
  return rotate(flat, rotation);
}

export function rotate(c: HTMLCanvasElement, rotation: Rotation): HTMLCanvasElement {
  if (rotation === 0) return c;
  const swap = rotation === 90 || rotation === 270;
  const out = canvasOf(swap ? c.height : c.width, swap ? c.width : c.height);
  const ctx = ctx2d(out);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

export function toJpeg(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', quality);
  });
}

export function thumbnail(c: HTMLCanvasElement): Promise<Blob> {
  return toJpeg(drawScaled(c, c.width, c.height, 360), 0.75);
}
