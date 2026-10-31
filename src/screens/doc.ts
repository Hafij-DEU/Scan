import { savePdf, sharePdf } from '../export';
import { canShare } from '../platform';
import { deleteDoc, getDoc, getPage, putDoc, type DocMeta } from '../store';
import { actionButton, confirmDialog, h, iconButton, promptDialog, toast } from '../ui/dom';
import { pop, push, type Screen } from '../ui/router';
import { cameraScreen } from './camera';
import { importInto } from './flow';
import { pageScreen } from './page';

export function docScreen(docId: string): Screen {
  const title = h('button', { class: 'bar-title title-btn', title: 'Rename', onclick: () => void rename() });
  const grid = h('div', { class: 'page-grid' });
  const urls: string[] = [];
  const revoke = () => urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  let doc: DocMeta | undefined;

  async function load() {
    doc = await getDoc(docId);
    if (!doc) {
      pop();
      return;
    }
    title.textContent = doc.name;
    revoke();
    grid.replaceChildren();
    for (const [i, pid] of doc.pages.entries()) {
      const page = await getPage(pid);
      if (!page) continue;
      const url = URL.createObjectURL(page.thumb);
      urls.push(url);
      grid.append(h('button', { class: 'page-card', onclick: () => push(pageScreen(docId, pid)) },
        h('img', { src: url, alt: `Page ${i + 1}` }),
        h('span', { class: 'page-num' }, String(i + 1)),
      ));
    }
    if (!doc.pages.length) grid.append(h('p', { class: 'empty muted' }, 'No pages. Add one with the camera or import a photo.'));
  }

  async function rename() {
    if (!doc) return;
    const name = await promptDialog('Rename document', doc.name);
    if (!name) return;
    doc.name = name;
    doc.updated = Date.now();
    await putDoc(doc);
    title.textContent = name;
  }

  async function remove() {
    if (!doc) return;
    const n = doc.pages.length;
    if (!(await confirmDialog(`Delete “${doc.name}” and its ${n} page${n === 1 ? '' : 's'}?`, 'Delete', true))) return;
    await deleteDoc(doc);
    pop();
    toast('Document deleted');
  }

  const el = h('div', { class: 'doc' },
    h('header', { class: 'bar' },
      iconButton('back', 'Back', () => pop()),
      title,
      iconButton('trash', 'Delete document', () => void remove()),
    ),
    h('main', { class: 'content' }, grid),
    h('div', { class: 'toolbar' },
      actionButton('camera', 'Scan', () => push(cameraScreen(docId))),
      actionButton('image', 'Import', () => void importInto(docId)),
      actionButton('pdf', 'Save PDF', () => void (doc && savePdf(doc)), 'primary'),
      canShare && actionButton('share', 'Share', () => void (doc && sharePdf(doc))),
    ),
  );
  void load();
  return { name: `doc:${docId}`, el, resume: () => void load(), dispose: revoke };
}

