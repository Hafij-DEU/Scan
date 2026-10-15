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
    const bg = [0, 1, 2].map((ch) => background(img, ch));
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const r = curve(d[i] / bg[0][p], 1.5);
      const g = curve(d[i + 1] / bg[1][p], 1.5);
      const b = curve(d[i + 2] / bg[2][p], 1.5);
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      d[i] = l + (r - l) * 1.3;
      d[i + 1] = l + (g - l) * 1.3;
      d[i + 2] = l + (b - l) * 1.3;
    }
    return out;
  }

  // Grayscale and B&W work on luminance normalised by the paper brightness.
  const lum = new ImageData(img.width, img.height);
  const ld = lum.data;
  for (let i = 0; i < n * 4; i += 4) {
    ld[i] = (img.data[i] * 77 + img.data[i + 1] * 150 + img.data[i + 2] * 29) >> 8;
  }
  const bg = background(lum, 0);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const norm = ld[i] / bg[p];
    let v: number;
    if (filter === 'gray') {
      v = curve(norm, 1.3);
    } else {
      // Soft threshold keeps anti-aliased edges on text.
      v = norm >= 0.8 ? 255 : norm <= 0.62 ? 0 : ((norm - 0.62) / 0.18) * 255;
    }
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  return out;
}

function curve(norm: number, gamma: number): number {
  const t = norm * 1.1 - 0.1;
  return t <= 0 ? 0 : t >= 1 ? 255 : 255 * Math.pow(t, gamma);
}

/**
 * Per-pixel estimate of the paper (background) value of one channel: the
 * bright-half mean of coarse blocks, dilated to cover dense text and
 * smoothed, then bilinearly interpolated to full size. Never below 1.
 */
function background(img: ImageData, ch: number): Float32Array {
  const { width: w, height: h, data } = img;
  const block = Math.max(8, Math.round(Math.max(w, h) / 48));
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
  grid = neighbourhood(grid, bw, bh, 'mean');

  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(bh - 1, Math.max(0, (y + 0.5) / block - 0.5));
    const y0 = Math.floor(gy);
    const y1 = Math.min(bh - 1, y0 + 1);
    const fy = gy - y0;
    for (let x = 0; x < w; x++) {
      const gx = Math.min(bw - 1, Math.max(0, (x + 0.5) / block - 0.5));
      const x0 = Math.floor(gx);
      const x1 = Math.min(bw - 1, x0 + 1);
      const fx = gx - x0;
      const top = grid[y0 * bw + x0] + (grid[y0 * bw + x1] - grid[y0 * bw + x0]) * fx;
      const bot = grid[y1 * bw + x0] + (grid[y1 * bw + x1] - grid[y1 * bw + x0]) * fx;
      out[y * w + x] = Math.max(1, top + (bot - top) * fy);
    }
  }
  return out;
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
