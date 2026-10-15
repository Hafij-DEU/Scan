export interface Pt {
  x: number;
  y: number;
}

/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];

export function fullQuad(w: number, h: number, inset = 0): Quad {
  const dx = w * inset;
  const dy = h * inset;
  return [
    { x: dx, y: dy },
    { x: w - dx, y: dy },
    { x: w - dx, y: h - dy },
    { x: dx, y: h - dy },
  ];
}

export function scaleQuad(q: Quad, s: number): Quad {
  return q.map((p) => ({ x: p.x * s, y: p.y * s })) as Quad;
}

export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Puts four arbitrary corners into tl, tr, br, bl order (clockwise on screen). */
export function orderQuad(pts: Pt[]): Quad {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // atan2 order on screen coordinates is clockwise; start at the corner nearest the origin.
  let start = 0;
  for (let i = 1; i < 4; i++) {
    if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
  }
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]) as Quad;
}

export function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

/** Andrew's monotone chain; returns the hull in counter-clockwise order. */
export function convexHull(points: Pt[]): Pt[] {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Largest-area quadrilateral whose corners lie on the convex hull. */
export function maxAreaQuad(hull: Pt[]): Quad | null {
  if (hull.length < 4) return null;
  const MAX = 56;
  const step = hull.length > MAX ? hull.length / MAX : 1;
  const idx: number[] = [];
  for (let f = 0; Math.round(f) < hull.length && idx.length < MAX; f += step) idx.push(Math.round(f));
  const n = idx.length;
  let best = -1;
  let pick = [0, 1, 2, 3];
  for (let a = 0; a < n - 3; a++) {
    for (let b = a + 1; b < n - 2; b++) {
      for (let c = b + 1; c < n - 1; c++) {
        for (let d = c + 1; d < n; d++) {
          // Convex quad area = |diagonal1 x diagonal2| / 2.
          const pa = hull[idx[a]];
          const pb = hull[idx[b]];
          const pc = hull[idx[c]];
          const pd = hull[idx[d]];
          const area = Math.abs((pc.x - pa.x) * (pd.y - pb.y) - (pc.y - pa.y) * (pd.x - pb.x)) / 2;
          if (area > best) {
            best = area;
            pick = [idx[a], idx[b], idx[c], idx[d]];
          }
        }
      }
    }
  }
  // Refine each corner over the hull points that subsampling skipped.
  if (step > 1) {
    const radius = Math.ceil(step);
    for (let round = 0; round < 2; round++) {
      for (let k = 0; k < 4; k++) {
        let bestI = pick[k];
        for (let o = -radius; o <= radius; o++) {
          const i = (pick[k] + o + hull.length) % hull.length;
          const trial = pick.slice();
          trial[k] = i;
          const area = polygonArea(trial.map((t) => hull[t]));
          if (area > best) {
            best = area;
            bestI = i;
          }
        }
        pick[k] = bestI;
      }
    }
  }
  return orderQuad(pick.map((i) => hull[i]));
}
