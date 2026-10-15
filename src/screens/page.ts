import { loadImage } from '../imaging/image';
import { saveBlob } from '../platform';
import { deletePage, getDoc, getPage, putDoc } from '../store';
import { actionButton, busy, confirmDialog, errorMessage, h, iconButton, toast } from '../ui/dom';
import { pop, push, type Screen } from '../ui/router';
import { cropScreen } from './crop';
import { fileName } from './doc';

/** One page full size, with re-edit, reorder, JPEG export and delete. */
export function pageScreen(docId: string, pageId: string): Screen {
  let current = pageId;
  let url = '';
  const img = h('img', { class: 'page-full', alt: '' });
  const label = h('span', { class: 'bar-title' });
  const prev = iconButton('left', 'Previous page', () => void step(-1));
  const next = iconButton('right', 'Next page', () => void step(1));

  async function load() {
    const doc = await getDoc(docId);
    const page = await getPage(current);
    if (!doc || !page) {
      pop();
      return;
    }
    const i = doc.pages.indexOf(current);
    label.textContent = `Page ${i + 1} of ${doc.pages.length}`;
    prev.disabled = i <= 0;
    next.disabled = i >= doc.pages.length - 1;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(page.processed);
    img.src = url;
  }

  async function step(delta: number) {
    const doc = await getDoc(docId);
    const id = doc?.pages[doc.pages.indexOf(current) + delta];
    if (!id) return;
    current = id;
    await load();
  }

  async function move(delta: number) {
    const doc = await getDoc(docId);
    if (!doc) return;
    const i = doc.pages.indexOf(current);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= doc.pages.length) return;
    [doc.pages[i], doc.pages[j]] = [doc.pages[j], doc.pages[i]];
    doc.updated = Date.now();
    await putDoc(doc);
    await load();
  }

  async function edit() {
    const page = await getPage(current);
    if (!page) return;
    const done = await busy('Loading…');
    try {
      const original = await loadImage(page.original);
      push(cropScreen({ docId, pageId: current, original, quad: page.quad, filter: page.filter, rotation: page.rotation }, true));
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      done();
    }
  }

  async function saveJpg() {
    const doc = await getDoc(docId);
    const page = await getPage(current);
    if (!doc || !page) return;
    try {
      toast(await saveBlob(page.processed, `${fileName(doc.name)}-p${doc.pages.indexOf(current) + 1}.jpg`));
    } catch (e) {
      toast(errorMessage(e), true);
    }
  }

  async function remove() {
    const doc = await getDoc(docId);
    if (!doc || !(await confirmDialog('Delete this page?', 'Delete', true))) return;
    await deletePage(doc, current);
    toast('Page deleted');
    pop();
  }

  const el = h('div', { class: 'page dark-screen' },
    h('header', { class: 'bar dark' }, iconButton('back', 'Back', () => pop()), label, prev, next),
    h('div', { class: 'page-stage' }, img),
    h('div', { class: 'toolbar dark' },
      actionButton('crop', 'Edit', () => void edit()),
      actionButton('left', 'Move', () => void move(-1)),
      actionButton('right', 'Move', () => void move(1)),
      actionButton('download', 'JPG', () => void saveJpg()),
      actionButton('trash', 'Delete', () => void remove()),
    ),
  );
  void load();
  return { name: 'page', el, resume: () => void load(), dispose: () => url && URL.revokeObjectURL(url) };
}
