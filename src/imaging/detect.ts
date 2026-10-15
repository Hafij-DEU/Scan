import { convexHull, isConvex, maxAreaQuad, polygonArea, scaleQuad, type Pt, type Quad } from './geometry';

const WORK_SIZE = 320;

let workCanvas: HTMLCanvasElement | null = null;

/**
 * Finds the page outline in an image. The page is segmented from the
 * background with Otsu thresholding (both polarities are tried), holes left
 * by printed text are filled, and the largest quadrilateral on the convex
 * hull of the region is taken as the page. Returns null when no plausible
 * page is found; corners are in source pixel coordinates.
 */
export function detectDocument(src: CanvasImageSource, srcW: number, srcH: number): Quad | null {
  const scale = Math.min(1, WORK_SIZE / Math.max(srcW, srcH));
  const w = Math.max(8, Math.round(srcW * scale));
  const h = Math.max(8, Math.round(srcH * scale));
  workCanvas ??= document.createElement('canvas');
  workCanvas.width = w;
  workCanvas.height = h;
  const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;

  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    gray[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  }
  boxBlur(gray, w, h, 2);
  boxBlur(gray, w, h, 2);
  const t = otsu(gray);

  let best: { quad: Quad; score: number } | null = null;
  for (const bright of [true, false]) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = (bright ? gray[i] > t : gray[i] <= t) ? 1 : 0;
    const region = largestRegion(mask, w, h);
    if (!region) continue;
    fillHoles(region, w, h);
    const quad = quadOf(region, w, h);
    if (!quad || !isConvex(quad)) continue;
    const quadArea = polygonArea(quad);
    const frac = quadArea / (w * h);
    if (frac < 0.12 || frac > 0.985) continue;
    let regionArea = 0;
    for (let i = 0; i < region.length; i++) regionArea += region[i];
    const fill = regionArea / quadArea;
    if (fill < 0.82) continue;
    const score = quadArea * fill * fill;
    if (!best || score > best.score) best = { quad, score };
  }
  return best ? scaleQuad(best.quad, 1 / scale) : null;
}

function boxBlur(a: Uint8Array, w: number, h: number, r: number): void {
  const tmp = new Uint8Array(a.length);
  const span = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += a[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / span;
      sum += a[row + clamp(x + r + 1, 0, w - 1)] - a[row + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      a[y * w + x] = sum / span;
      sum += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function otsu(gray: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = i;
    }
  }
  return threshold;
}

/** Largest 4-connected component of mask==1, as a 0/1 mask. */
function largestRegion(mask: Uint8Array, w: number, h: number): Uint8Array | null {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let next = 0;
  let bestLabel = 0;
  let bestSize = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    let size = 0;
    let sp = 0;
    stack[sp++] = start;
    label[start] = next;
    while (sp > 0) {
      const p = stack[--sp];
      size++;
      const x = p % w;
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[sp++] = p + 1; }
      if (p >= w && mask[p - w] && !label[p - w]) { label[p - w] = next; stack[sp++] = p - w; }
      if (p < w * (h - 1) && mask[p + w] && !label[p + w]) { label[p + w] = next; stack[sp++] = p + w; }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = next;
    }
  }
  if (!bestLabel) return null;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = label[i] === bestLabel ? 1 : 0;
  return out;
}

/** Marks every pixel not reachable from the image border through background as region. */
function fillHoles(region: Uint8Array, w: number, h: number): void {
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const seed = (p: number) => {
    if (!region[p] && !outside[p]) { outside[p] = 1; stack[sp++] = p; }
  };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < w * (h - 1)) seed(p + w);
  }
  for (let i = 0; i < region.length; i++) if (!outside[i]) region[i] = 1;
}

function quadOf(region: Uint8Array, w: number, h: number): Quad | null {
  // Row extremes are enough to determine the convex hull.
  const pts: Pt[] = [];
  for (let y = 0; y < h; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < w; x++) {
      if (region[y * w + x]) {
        if (lo < 0) lo = x;
        hi = x;
      }
    }
    if (lo >= 0) {
      pts.push({ x: lo, y }, { x: hi + 1, y });
      if (y === h - 1 || !rowHas(region, w, y + 1)) pts.push({ x: lo, y: y + 1 }, { x: hi + 1, y: y + 1 });
    }
  }
  return maxAreaQuad(convexHull(pts));
}

function rowHas(region: Uint8Array, w: number, y: number): boolean {
  for (let x = 0; x < w; x++) if (region[y * w + x]) return true;
  return false;
}
