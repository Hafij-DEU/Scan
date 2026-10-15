import { dist, type Quad } from './geometry';

/** Output size for a corrected page, from the lengths of the quad's opposite edges. */
export function warpSize(q: Quad, maxSide: number): { width: number; height: number } {
  const [tl, tr, br, bl] = q;
  let width = Math.max(dist(tl, tr), dist(bl, br));
  let height = Math.max(dist(tl, bl), dist(tr, br));
  const s = Math.min(1, maxSide / Math.max(width, height));
  width = Math.max(1, Math.round(width * s));
  height = Math.max(1, Math.round(height * s));
  return { width, height };
}

/**
 * Homography mapping (0,0)-(w,h) rectangle corners onto the quad:
 * returns [a..h] with x = (a u + b v + c) / (g u + h v + 1), y = (d u + e v + f) / (g u + h v + 1).
 */
function rectToQuad(w: number, h: number, q: Quad): number[] {
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i];
    const { x, y } = q[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    B.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    B.push(y);
  }
  return solve(A, B);
}

function solve(A: number[][], B: number[]): number[] {
  const n = B.length;
  const M = A.map((row, i) => [...row, B[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const p = M[col][col] || 1e-12;
    for (let c = col; c <= n; c++) M[col][c] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/** Perspective-corrects the quad region of src into an upright rectangle (bilinear sampling). */
export function warpPerspective(src: ImageData, q: Quad, maxSide: number): ImageData {
  const { width, height } = warpSize(q, maxSide);
  const [a, b, c, d, e, f, g, h] = rectToQuad(width, height, q);
  const out = new ImageData(width, height);
  const o = out.data;
  const s = src.data;
  const sw = src.width;
  const sh = src.height;
  let k = 0;
  for (let v = 0; v < height; v++) {
    const vy = v + 0.5;
    for (let u = 0; u < width; u++) {
      const ux = u + 0.5;
      const den = g * ux + h * vy + 1;
      let x = (a * ux + b * vy + c) / den - 0.5;
      let y = (d * ux + e * vy + f) / den - 0.5;
      if (x < 0) x = 0; else if (x > sw - 1) x = sw - 1;
      if (y < 0) y = 0; else if (y > sh - 1) y = sh - 1;
      const x0 = x | 0;
      const y0 = y | 0;
      const x1 = x0 + 1 < sw ? x0 + 1 : x0;
      const y1 = y0 + 1 < sh ? y0 + 1 : y0;
      const fx = x - x0;
      const fy = y - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = s[i00 + ch] + (s[i10 + ch] - s[i00 + ch]) * fx;
        const bot = s[i01 + ch] + (s[i11 + ch] - s[i01 + ch]) * fx;
        o[k + ch] = top + (bot - top) * fy;
      }
      o[k + 3] = 255;
      k += 4;
    }
  }
  return out;
}
