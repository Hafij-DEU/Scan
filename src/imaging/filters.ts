export type FilterId = 'original' | 'magic' | 'lighten' | 'gray' | 'bw';

export const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'magic', label: 'Magic color' },
  { id: 'original', label: 'Original' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'gray', label: 'Grayscale' },
  { id: 'bw', label: 'B & W' },
];

/** Returns a new image with the filter applied; the input is not modified. */
export function applyFilter(img: ImageData, filter: FilterId): ImageData {
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  if (filter === 'original') return out;
  const d = out.data;
  const n = img.width * img.height;

  if (filter === 'lighten') {
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = 255 * Math.pow(i / 255, 0.7);
    for (let i = 0; i < n * 4; i += 4) {
      d[i] = lut[d[i]];
      d[i + 1] = lut[d[i + 1]];
      d[i + 2] = lut[d[i + 2]];
    }
    return out;
  }

  if (filter === 'magic') {
    // Divide each channel by its estimated paper colour: removes shadows and
    // colour casts, then a contrast curve and a saturation boost.
    const paper = new PaperSampler(img.width, img.height);
    const grids = [0, 1, 2].map((ch) => paperGrid(img, ch, paper.block));
    const rows = [0, 1, 2].map(() => new Float32Array(img.width));
    const lut = curveLut(1.5);
    for (let y = 0, i = 0; y < img.height; y++) {
      for (let ch = 0; ch < 3; ch++) paper.row(grids[ch], y, rows[ch]);
      const [br, bgr, bb] = rows;
      for (let x = 0; x < img.width; x++, i += 4) {
        const r = lut[Math.min(CURVE_STEPS, ((d[i] / br[x]) * CURVE_STEPS) | 0)];
        const g = lut[Math.min(CURVE_STEPS, ((d[i + 1] / bgr[x]) * CURVE_STEPS) | 0)];
        const b = lut[Math.min(CURVE_STEPS, ((d[i + 2] / bb[x]) * CURVE_STEPS) | 0)];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        d[i] = l + (r - l) * 1.3;
        d[i + 1] = l + (g - l) * 1.3;
        d[i + 2] = l + (b - l) * 1.3;
      }
    }
    return out;
  }

  // Grayscale and B&W work on luminance normalised by the paper brightness.
  const lum = new ImageData(img.width, img.height);
  const ld = lum.data;
  for (let i = 0; i < n * 4; i += 4) {
    ld[i] = (img.data[i] * 77 + img.data[i + 1] * 150 + img.data[i + 2] * 29) >> 8;
  }
  const paper = new PaperSampler(img.width, img.height);
  const grid = paperGrid(lum, 0, paper.block);
  const row = new Float32Array(img.width);
  const lut = curveLut(1.3);
  for (let y = 0, i = 0; y < img.height; y++) {
    paper.row(grid, y, row);
    for (let x = 0; x < img.width; x++, i += 4) {
      const norm = ld[i] / row[x];
      let v: number;
      if (filter === 'gray') {
        v = lut[Math.min(CURVE_STEPS, (norm * CURVE_STEPS) | 0)];
      } else {
        // Soft threshold keeps anti-aliased edges on text.
        v = norm >= 0.8 ? 255 : norm <= 0.62 ? 0 : ((norm - 0.62) / 0.18) * 255;
      }
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  return out;
}

/** Table resolution of the contrast curve over normalised values 0..1. */
const CURVE_STEPS = 4096;
const curveLuts = new Map<number, Float32Array>();

/** curve() sampled at CURVE_STEPS + 1 points: one lookup per channel instead of a Math.pow. */
function curveLut(gamma: number): Float32Array {
  let lut = curveLuts.get(gamma);
  if (!lut) {
    lut = new Float32Array(CURVE_STEPS + 1);
    for (let i = 0; i <= CURVE_STEPS; i++) lut[i] = curve(i / CURVE_STEPS, gamma);
    curveLuts.set(gamma, lut);
  }
  return lut;
}

function curve(norm: number, gamma: number): number {
  const t = norm * 1.1 - 0.1;
  return t <= 0 ? 0 : t >= 1 ? 255 : 255 * Math.pow(t, gamma);
}

/**
 * Coarse estimate of the paper (background) value of one channel: the
 * bright-half mean of each block, dilated to cover dense text and smoothed.
 * PaperSampler interpolates it to per-pixel values one row at a time.
 */
function paperGrid(img: ImageData, ch: number, block: number): Float32Array {
  const { width: w, height: h, data } = img;
  const bw = Math.ceil(w / block);
  const bh = Math.ceil(h / block);
  let grid = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const x0 = bx * block;
      const y0 = by * block;
      const x1 = Math.min(w, x0 + block);
      const y1 = Math.min(h, y0 + block);
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { sum += data[(y * w + x) * 4 + ch]; count++; }
      const mean = sum / Math.max(1, count);
      let hiSum = 0;
      let hiCount = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const v = data[(y * w + x) * 4 + ch];
          if (v >= mean) { hiSum += v; hiCount++; }
        }
      }
      grid[by * bw + bx] = hiCount ? hiSum / hiCount : mean;
    }
  }
  grid = neighbourhood(grid, bw, bh, 'max');
  grid = neighbourhood(grid, bw, bh, 'mean');
  return neighbourhood(grid, bw, bh, 'mean');
}

/**
 * Bilinear interpolation of a paper grid to full size, a row at a time, so no
 * full-size float buffer is needed. Column weights are shared by all channels.
 * Values are never below 1.
 */
class PaperSampler {
  readonly block: number;
  private readonly bw: number;
  private readonly bh: number;
  private readonly x0: Int32Array;
  private readonly x1: Int32Array;
  private readonly fx: Float32Array;

  constructor(w: number, h: number) {
    this.block = Math.max(8, Math.round(Math.max(w, h) / 48));
    this.bw = Math.ceil(w / this.block);
    this.bh = Math.ceil(h / this.block);
    this.x0 = new Int32Array(w);
    this.x1 = new Int32Array(w);
    this.fx = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const gx = Math.min(this.bw - 1, Math.max(0, (x + 0.5) / this.block - 0.5));
      this.x0[x] = Math.floor(gx);
      this.x1[x] = Math.min(this.bw - 1, this.x0[x] + 1);
      this.fx[x] = gx - this.x0[x];
    }
  }

  row(grid: Float32Array, y: number, out: Float32Array): void {
    const { bw, bh, x0, x1, fx } = this;
    const gy = Math.min(bh - 1, Math.max(0, (y + 0.5) / this.block - 0.5));
    const r0 = Math.floor(gy) * bw;
    const r1 = Math.min(bh - 1, Math.floor(gy) + 1) * bw;
    const fy = gy - Math.floor(gy);
    for (let x = 0; x < out.length; x++) {
      const top = grid[r0 + x0[x]] + (grid[r0 + x1[x]] - grid[r0 + x0[x]]) * fx[x];
      const bot = grid[r1 + x0[x]] + (grid[r1 + x1[x]] - grid[r1 + x0[x]]) * fx[x];
      const v = top + (bot - top) * fy;
      out[x] = v > 1 ? v : 1;
    }
  }
}

function neighbourhood(g: Float32Array, w: number, h: number, mode: 'max' | 'mean'): Float32Array<ArrayBuffer> {
  const out = new Float32Array(g.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = mode === 'max' ? -Infinity : 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const v = g[yy * w + xx];
          if (mode === 'max') acc = v > acc ? v : acc;
          else acc += v;
          count++;
        }
      }
      out[y * w + x] = mode === 'max' ? acc : acc / count;
    }
  }
  return out;
}
