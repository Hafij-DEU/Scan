import { applyFilter, FILTERS, type FilterId } from '../imaging/filters';
import { canvasOf, ctx2d, rotate } from '../imaging/image';
import { warpPerspective } from '../imaging/warp';
import type { Rotation } from '../store';
import { actionButton, busy, errorMessage, h, iconButton, toast } from '../ui/dom';
import { pop, type Screen } from '../ui/router';
import { openDoc, savePage, type PageDraft } from './flow';

const PREVIEW_SIDE = 1600;

/** Filter choice and rotation on the perspective-corrected page. */
export function editScreen(draft: PageDraft): Screen {
  let filter: FilterId = draft.filter;
  let rotation: Rotation = draft.rotation;
  let base: ImageData | null = null;
  let filtered: HTMLCanvasElement | null = null;
  const stage = h('div', { class: 'edit-stage' }, h('div', { class: 'spinner' }));
  const chips = h('div', { class: 'filter-strip' });
  const chipButtons = new Map<FilterId, HTMLButtonElement>();

  function init() {
    const src = ctx2d(draft.original).getImageData(0, 0, draft.original.width, draft.original.height);
    base = warpPerspective(src, draft.quad, PREVIEW_SIDE);
    const small = warpPerspective(src, draft.quad, 160);
    for (const f of FILTERS) {
      const t = applyFilter(small, f.id);
      const c = canvasOf(t.width, t.height);
      ctx2d(c).putImageData(t, 0, 0);
      const btn = h('button', { class: 'chip', onclick: () => setFilter(f.id) }, c, h('span', {}, f.label));
      chipButtons.set(f.id, btn);
      chips.append(btn);
    }
    setFilter(filter);
  }

  function setFilter(id: FilterId) {
    if (!base) return;
    filter = id;
    chipButtons.forEach((b, k) => b.classList.toggle('selected', k === id));
    const t = applyFilter(base, id);
    filtered = canvasOf(t.width, t.height);
    ctx2d(filtered).putImageData(t, 0, 0);
    show();
  }

  function show() {
    if (!filtered) return;
    const c = rotate(filtered, rotation);
    c.className = 'edit-preview';
    stage.replaceChildren(c);
  }

  function turn(delta: 90 | 270) {
    rotation = ((rotation + delta) % 360) as Rotation;
    show();
  }

  async function save() {
    const done = await busy('Saving page…');
    try {
      const id = await savePage({ ...draft, filter, rotation });
      done();
      openDoc(id);
      toast('Page saved');
    } catch (e) {
      done();
      toast(`Could not save: ${errorMessage(e)}`, true);
    }
  }

  const el = h('div', { class: 'edit dark-screen' },
    h('header', { class: 'bar dark' }, iconButton('back', 'Back', () => pop()), h('span', { class: 'bar-title' }, 'Enhance')),
    stage,
    chips,
    h('div', { class: 'toolbar dark' },
      actionButton('rotl', 'Left', () => turn(270)),
      actionButton('rotr', 'Right', () => turn(90)),
      actionButton('check', 'Save', () => void save(), 'primary'),
    ),
  );
  // Let the screen paint before the heavy warp.
  requestAnimationFrame(() => setTimeout(() => {
    try {
      init();
    } catch (e) {
      toast(errorMessage(e), true);
    }
  }, 0));
  return { name: 'edit', el };
}
