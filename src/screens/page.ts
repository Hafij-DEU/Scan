import { jpgFileName, pageText, writeWithChoice } from '../export';
import { loadImage } from '../imaging/image';
import { signature } from '../settings';
import { deletePage, getDoc, getPage, putDoc } from '../store';
import { actionButton, busy, confirmDialog, errorMessage, h, iconButton, textDialog, toast } from '../ui/dom';
import { pop, push, type Screen } from '../ui/router';
import { cropScreen } from './crop';
import { drawSignature, signScreen } from './sign';

/** One page full size, with re-edit, signing, text, reorder, JPEG export and delete. */
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
      const name = await writeWithChoice(jpgFileName(doc.name, doc.pages.indexOf(current) + 1), page.processed);
      if (name) toast(`Saved ${name}`);
    } catch (e) {
      toast(errorMessage(e), true);
    }
  }

  async function sign() {
    if (!signature() && !(await drawSignature())) return;
    push(signScreen(docId, current));
  }

  async function readText() {
    const page = await getPage(current);
    if (!page) return;
    const done = await busy('Reading text…');
    try {
      const { text } = await pageText(page, (p) => done.text(`Reading text… ${Math.round(p * 100)}%`));
      done();
      await textDialog('Text on this page', text || '(No text found)');
    } catch (e) {
      done();
      toast(`Text recognition failed: ${errorMessage(e)}`, true);
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
    h('div', { class: 'toolbar dark scroll' },
      actionButton('crop', 'Edit', () => void edit()),
      actionButton('sign', 'Sign', () => void sign()),
      actionButton('text', 'Text', () => void readText()),
      actionButton('left', 'Move', () => void move(-1)),
      actionButton('right', 'Move', () => void move(1)),
      actionButton('download', 'JPG', () => void saveJpg()),
      actionButton('trash', 'Delete', () => void remove()),
    ),
  );
  void load();
  return { name: 'page', el, resume: () => void load(), dispose: () => url && URL.revokeObjectURL(url) };
}
