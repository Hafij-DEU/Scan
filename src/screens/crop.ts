import { fullQuad, isConvex, type Pt, type Quad } from '../imaging/geometry';
import { actionButton, h, iconButton, toast } from '../ui/dom';
import { pop, push, type Screen } from '../ui/router';
import { editScreen } from './edit';
import { autoQuad, type PageDraft } from './flow';

const HANDLE = 11;
const GRAB = 44;
const LOUPE = 56;

/** Shows the capture with four draggable corners. */
export function cropScreen(draft: PageDraft, detected: boolean): Screen {
  const img = draft.original;
  let quad = copy(draft.quad);
  const canvas = h('canvas', { class: 'crop-canvas' });
  const stage = h('div', { class: 'crop-stage' }, canvas);
  const hint = h('p', { class: 'hint' }, detected ? 'Drag the corners to adjust' : 'Page edges not found. Drag the corners to the page.');
  const view = { s: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };
  let drag = -1;
  let grabOffset: Pt = { x: 0, y: 0 };

  function measure() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const pad = 22;
    view.dpr = window.devicePixelRatio || 1;
    view.w = r.width;
    view.h = r.height;
    view.s = Math.min((r.width - 2 * pad) / img.width, (r.height - 2 * pad) / img.height);
    view.ox = (r.width - img.width * view.s) / 2;
    view.oy = (r.height - img.height * view.s) / 2;
    canvas.width = Math.round(r.width * view.dpr);
    canvas.height = Math.round(r.height * view.dpr);
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    draw();
  }

  const toScreen = (p: Pt): Pt => ({ x: view.ox + p.x * view.s, y: view.oy + p.y * view.s });

  function draw() {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const iw = img.width * view.s;
    const ih = img.height * view.s;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.drawImage(img, view.ox, view.oy, iw, ih);
    const pts = quad.map(toScreen);
    ctx.beginPath();
    ctx.rect(view.ox, view.oy, iw, ih);
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fill('evenodd');
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isConvex(quad) ? '#2dd4bf' : '#f87171';
    ctx.stroke();
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, HANDLE, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0f766e';
      ctx.stroke();
    }
    if (drag >= 0) loupe(ctx, quad[drag], pts[drag]);
  }

  /** Magnified view of the area under the dragged corner, kept away from the finger. */
  function loupe(ctx: CanvasRenderingContext2D, p: Pt, sp: Pt) {
    const left = sp.x > view.w / 2 || sp.y > LOUPE * 3;
    const cx = left ? LOUPE + 12 : view.w - LOUPE - 12;
    const cy = LOUPE + 12;
    const half = LOUPE / (view.s * 2.5);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, LOUPE, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(cx - LOUPE, cy - LOUPE, LOUPE * 2, LOUPE * 2);
    ctx.drawImage(img, p.x - half, p.y - half, half * 2, half * 2, cx - LOUPE, cy - LOUPE, LOUPE * 2, LOUPE * 2);
    ctx.strokeStyle = '#2dd4bf';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx, cy + 10);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, LOUPE, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }

  function local(e: PointerEvent): Pt {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = local(e);
    let best = -1;
    let bestD = GRAB;
    quad.forEach((q, i) => {
      const s = toScreen(q);
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) return;
    const s = toScreen(quad[best]);
    grabOffset = { x: s.x - p.x, y: s.y - p.y };
    drag = best;
    canvas.setPointerCapture(e.pointerId);
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag < 0) return;
    const p = local(e);
    const x = (p.x + grabOffset.x - view.ox) / view.s;
    const y = (p.y + grabOffset.y - view.oy) / view.s;
    quad[drag] = { x: Math.min(img.width, Math.max(0, x)), y: Math.min(img.height, Math.max(0, y)) };
    draw();
  });
  const release = () => {
    drag = -1;
    draw();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  const ro = new ResizeObserver(measure);
  ro.observe(stage);

  const el = h('div', { class: 'crop dark-screen' },
    h('header', { class: 'bar dark' }, iconButton('back', 'Back', () => pop()), h('span', { class: 'bar-title' }, 'Adjust corners')),
    stage,
    hint,
    h('div', { class: 'toolbar dark' },
      actionButton('auto', 'Auto', () => {
        const r = autoQuad(img);
        quad = r.quad;
        if (!r.detected) toast('No page edges found');
        draw();
      }),
      actionButton('full', 'Whole image', () => {
        quad = fullQuad(img.width, img.height);
        draw();
      }),
      actionButton('check', 'Next', () => {
        if (!isConvex(quad)) {
          toast('The corners must form a four-sided shape', true);
          return;
        }
        push(editScreen({ ...draft, quad: copy(quad) }));
      }, 'primary'),
    ),
  );
  return { name: 'crop', el, resume: measure, dispose: () => ro.disconnect() };
}

function copy(q: Quad): Quad {
  return q.map((p) => ({ x: p.x, y: p.y })) as Quad;
}
