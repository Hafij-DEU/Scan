import { canvasOf, ctx2d, loadImage, thumbnail, toJpeg } from '../imaging/image';
import { setSignature, signature } from '../settings';
import { getDoc, getPage, putDoc, putPage, type PageMark } from '../store';
import { actionButton, busy, errorMessage, h, iconButton, modal, toast } from '../ui/dom';
import { pop, type Screen } from '../ui/router';
import { drawMarks } from './flow';

/** Signature pad; stores the trimmed drawing. Resolves true when a signature was saved. */
export function drawSignature(): Promise<boolean> {
  return modal<boolean>((done) => {
    const pad = h('canvas', { class: 'sign-pad', width: 900, height: 360 });
    const g = ctx2d(pad);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 6;
    g.strokeStyle = '#111';
    let drawn = false;
    let last: { x: number; y: number } | null = null;
    const at = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * pad.width, y: ((e.clientY - r.top) / r.height) * pad.height };
    };
    pad.addEventListener('pointerdown', (e) => {
      pad.setPointerCapture(e.pointerId);
      last = at(e);
      g.beginPath();
      g.arc(last.x, last.y, g.lineWidth / 2, 0, Math.PI * 2);
      g.fillStyle = '#111';
      g.fill();
      drawn = true;
    });
    pad.addEventListener('pointermove', (e) => {
      if (!last) return;
      const p = at(e);
      g.beginPath();
      g.moveTo(last.x, last.y);
      g.lineTo(p.x, p.y);
      g.stroke();
      last = p;
    });
    const end = () => void (last = null);
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);

    const save = () => {
      const url = drawn ? trimmed(pad) : null;
      if (!url) {
        toast('Draw your signature first', true);
        return;
      }
      setSignature(url);
      done(true);
    };
    return h('div', { class: 'dialog wide', role: 'dialog' },
      h('h2', {}, 'Draw your signature'),
      pad,
      h('div', { class: 'dialog-actions' },
        h('button', {
          class: 'text-btn',
          onclick: () => {
            g.clearRect(0, 0, pad.width, pad.height);
            drawn = false;
          },
        }, 'Clear'),
        h('span', { class: 'grow' }),
        h('button', { class: 'text-btn', onclick: () => done(false) }, 'Cancel'),
        h('button', { class: 'text-btn primary', onclick: save }, 'Save'),
      ),
    );
  }, false);
}

/** Crops the drawing to its ink, with a small margin. */
function trimmed(c: HTMLCanvasElement): string | null {
  const { data, width, height } = ctx2d(c).getImageData(0, 0, c.width, c.height);
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 16) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const m = 8;
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(width - 1, x1 + m);
  y1 = Math.min(height - 1, y1 + m);
  const out = canvasOf(x1 - x0 + 1, y1 - y0 + 1);
  ctx2d(out).drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

function dataUrlBlob(url: string): Blob {
  const [head, body] = url.split(',', 2);
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: /data:([^;]+)/.exec(head)?.[1] ?? 'image/png' });
}

/** Places the saved signature on a page: drag to move, slider to resize. */
export function signScreen(docId: string, pageId: string): Screen {
  let x = 0.55;
  let y = 0.78;
  let w = 0.32;
  let url = '';
  const pageImg = h('img', { class: 'sign-page', alt: '' });
  const mark = h('img', { class: 'sign-mark', alt: 'Signature', draggable: false });
  const wrap = h('div', { class: 'sign-wrap' }, pageImg, mark);
  const size = h('input', { type: 'range', min: '8', max: '80', value: String(w * 100), class: 'range' });

  function place() {
    mark.style.left = `${x * 100}%`;
    mark.style.top = `${y * 100}%`;
    mark.style.width = `${w * 100}%`;
  }

  function useSignature() {
    const sig = signature();
    if (sig) mark.src = sig;
  }

  size.addEventListener('input', () => {
    w = Number(size.value) / 100;
    x = Math.min(x, 1 - w);
    place();
  });

  let drag: { px: number; py: number; x: number; y: number } | null = null;
  mark.addEventListener('pointerdown', (e) => {
    mark.setPointerCapture(e.pointerId);
    drag = { px: e.clientX, py: e.clientY, x, y };
  });
  mark.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = wrap.getBoundingClientRect();
    const hFrac = mark.getBoundingClientRect().height / r.height;
    x = clamp(drag.x + (e.clientX - drag.px) / r.width, 0, 1 - w);
    y = clamp(drag.y + (e.clientY - drag.py) / r.height, 0, 1 - hFrac);
    place();
  });
  const end = () => void (drag = null);
  mark.addEventListener('pointerup', end);
  mark.addEventListener('pointercancel', end);

  async function load() {
    const page = await getPage(pageId);
    if (!page) {
      pop();
      return;
    }
    url = URL.createObjectURL(page.processed);
    pageImg.src = url;
    useSignature();
    place();
  }

  async function confirm() {
    const sig = signature();
    const page = await getPage(pageId);
    const doc = await getDoc(docId);
    if (!sig || !page || !doc) return;
    const done = await busy('Signing…');
    try {
      const m: PageMark = { png: dataUrlBlob(sig), x, y, w };
      const c = await loadImage(page.processed);
      await drawMarks(c, [m]);
      page.processed = await toJpeg(c, 0.88);
      page.thumb = await thumbnail(c);
      page.marks = [...(page.marks ?? []), m];
      delete page.ocr;
      await putPage(page);
      doc.updated = Date.now();
      await putDoc(doc);
      done();
      pop();
      toast('Signature added');
    } catch (e) {
      done();
      toast(errorMessage(e), true);
    }
  }

  const el = h('div', { class: 'sign dark-screen' },
    h('header', { class: 'bar dark' }, iconButton('back', 'Back', () => pop()), h('span', { class: 'bar-title' }, 'Sign page')),
    h('div', { class: 'sign-stage' }, wrap),
    h('label', { class: 'sign-size' }, h('span', {}, 'Size'), size),
    h('div', { class: 'toolbar dark' },
      actionButton('sign', 'Redraw', () => void drawSignature().then((ok) => ok && useSignature())),
      actionButton('check', 'Apply', () => void confirm(), 'primary'),
    ),
  );
  void load();
  return { name: 'sign', el, dispose: () => url && URL.revokeObjectURL(url) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
