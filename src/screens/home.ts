import { getPage, listDocs } from '../store';
import { h, icon } from '../ui/dom';
import { push, type Screen } from '../ui/router';
import { cameraScreen } from './camera';
import { docScreen } from './doc';
import { importInto } from './flow';

export function homeScreen(): Screen {
  const list = h('div', { class: 'doc-grid' });
  const urls: string[] = [];
  const revoke = () => urls.splice(0).forEach((u) => URL.revokeObjectURL(u));

  async function load() {
    const docs = await listDocs();
    revoke();
    list.replaceChildren();
    if (!docs.length) {
      list.append(h('div', { class: 'empty' },
        icon('pdf'),
        h('p', {}, 'No documents yet'),
        h('p', { class: 'muted' }, 'Tap Scan to capture a page, or import photos.'),
      ));
      return;
    }
    for (const doc of docs) {
      const first = doc.pages[0] ? await getPage(doc.pages[0]) : undefined;
      const thumb = h('div', { class: 'doc-thumb' });
      if (first) {
        const url = URL.createObjectURL(first.thumb);
        urls.push(url);
        thumb.append(h('img', { src: url, alt: '' }));
      } else {
        thumb.append(icon('pdf'));
      }
      const count = `${doc.pages.length} page${doc.pages.length === 1 ? '' : 's'}`;
      list.append(h('button', { class: 'doc-card', onclick: () => push(docScreen(doc.id)) },
        thumb,
        h('div', { class: 'doc-info' }, h('strong', {}, doc.name), h('span', { class: 'muted' }, `${count} · ${formatDate(doc.updated)}`)),
      ));
    }
  }

  const el = h('div', { class: 'home' },
    h('header', { class: 'bar brand' }, h('h1', {}, 'DocScan')),
    h('main', { class: 'content' }, list),
    h('div', { class: 'fab-row' },
      h('button', { class: 'fab secondary', onclick: () => void importInto(null) }, icon('image'), h('span', {}, 'Import')),
      h('button', { class: 'fab', onclick: () => push(cameraScreen(null)) }, icon('camera'), h('span', {}, 'Scan')),
    ),
  );
  void load();
  return { name: 'home', el, resume: () => void load(), dispose: revoke };
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
