import { savePdf, sharePdf } from '../export';
import { canShare } from '../platform';
import { settings, updateSettings, type DocSort } from '../settings';
import { deleteDoc, getPage, listDocs, putDoc, type DocMeta } from '../store';
import { requestSync } from '../sync';
import { actionSheet, confirmDialog, h, icon, iconButton, promptDialog, toast } from '../ui/dom';
import { push, type Screen } from '../ui/router';
import { cameraScreen } from './camera';
import { docScreen } from './doc';
import { filesPanel, formatDate, type Panel } from './files';
import { importInto } from './flow';
import { settingsScreen } from './settings';

type Tab = 'scans' | 'pdfs';

const SORTS: { id: DocSort; label: string }[] = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'name', label: 'Name' },
  { id: 'pages', label: 'Pages' },
];

export function homeScreen(): Screen {
  const scans = scansPanel();
  const files = filesPanel();
  const panels: Record<Tab, Panel> = { scans, pdfs: files };
  let tab: Tab = 'scans';

  const search = h('input', { class: 'search-input', type: 'search', placeholder: 'Search by name', 'aria-label': 'Search' });
  const searchRow = h('div', { class: 'search-row', hidden: true },
    icon('search'),
    search,
    iconButton('close', 'Close search', () => toggleSearch(false)),
  );
  search.addEventListener('input', () => panels[tab].setQuery(search.value.trim()));

  function toggleSearch(on = searchRow.hidden) {
    searchRow.hidden = !on;
    if (on) setTimeout(() => search.focus(), 30);
    else if (search.value) {
      search.value = '';
      panels[tab].setQuery('');
    }
  }

  const tabButtons = {
    scans: h('button', { class: 'tab', onclick: () => show('scans') }, icon('scans'), h('span', {}, 'Scans')),
    pdfs: h('button', { class: 'tab', onclick: () => show('pdfs') }, icon('pdf'), h('span', {}, 'PDFs')),
  };
  const body = h('main', { class: 'content' });

  function show(t: Tab) {
    if (tab !== t) panels[tab].setQuery('');
    tab = t;
    for (const [k, b] of Object.entries(tabButtons)) b.classList.toggle('on', k === t);
    body.replaceChildren(panels[t].el);
    body.scrollTop = 0;
    panels[t].setQuery(search.value.trim());
    void panels[t].load();
    if (t === 'pdfs') requestSync(300);
  }

  const el = h('div', { class: 'home' },
    h('header', { class: 'hero' },
      h('div', { class: 'hero-row' },
        h('div', { class: 'hero-logo' }, icon('scans')),
        h('h1', {}, 'DocScan'),
        iconButton('search', 'Search', () => toggleSearch()),
        iconButton('settings', 'Settings', () => push(settingsScreen())),
      ),
      searchRow,
    ),
    h('div', { class: 'home-body' },
      body,
      h('div', { class: 'fab-row' },
        h('button', { class: 'fab secondary', onclick: () => void importInto(null) }, icon('image'), h('span', {}, 'Import')),
        h('button', { class: 'fab round secondary', title: 'Scan an ID card', 'aria-label': 'Scan an ID card', onclick: () => push(cameraScreen(null, {})) }, icon('idcard')),
        h('button', { class: 'fab', onclick: () => push(cameraScreen(null)) }, icon('camera'), h('span', {}, 'Scan')),
      ),
    ),
    h('nav', { class: 'tabs' }, tabButtons.scans, tabButtons.pdfs),
  );
  show('scans');
  return {
    name: 'home',
    el,
    resume: () => void panels[tab].load(),
    dispose() {
      scans.dispose();
      files.dispose();
    },
  };
}

/** The Scans tab: documents kept in the app. */
function scansPanel(): Panel {
  const sorts = h('div', { class: 'chip-row' });
  const list = h('div', { class: 'doc-grid' });
  const urls: string[] = [];
  const revoke = () => urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  let docs: DocMeta[] = [];
  let query = '';
  let gen = 0;

  function renderSorts() {
    const current = settings().sort;
    sorts.replaceChildren(icon('sort'), ...SORTS.map((s) => h('button', {
      class: `pill ${s.id === current ? 'on' : ''}`,
      onclick: () => {
        updateSettings({ sort: s.id });
        renderSorts();
        void render();
      },
    }, s.label)));
  }

  async function load() {
    docs = await listDocs();
    await render();
  }

  function sorted(): DocMeta[] {
    const q = query.toLowerCase();
    const out = docs.filter((d) => !q || d.name.toLowerCase().includes(q));
    const by = settings().sort;
    if (by === 'name') out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    else if (by === 'pages') out.sort((a, b) => b.pages.length - a.pages.length);
    else if (by === 'oldest') out.sort((a, b) => a.updated - b.updated);
    else out.sort((a, b) => b.updated - a.updated);
    return out;
  }

  async function render() {
    const my = ++gen;
    const shown = sorted();
    const cards: HTMLElement[] = [];
    const made: string[] = [];
    for (const doc of shown) {
      const first = doc.pages[0] ? await getPage(doc.pages[0]) : undefined;
      if (my !== gen) {
        made.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      const thumb = h('div', { class: 'doc-thumb' });
      if (first) {
        const url = URL.createObjectURL(first.thumb);
        made.push(url);
        thumb.append(h('img', { src: url, alt: '' }));
      } else {
        thumb.append(icon('pdf'));
      }
      const count = `${doc.pages.length} page${doc.pages.length === 1 ? '' : 's'}`;
      cards.push(h('div', { class: 'doc-card' },
        h('button', { class: 'doc-main', onclick: () => push(docScreen(doc.id)) },
          thumb,
          h('div', { class: 'doc-info' },
            h('strong', {}, doc.name),
            h('span', { class: 'muted' }, count),
            h('span', { class: 'muted small' }, formatDate(doc.updated)),
          ),
        ),
        iconButton('more', 'More', () => void menu(doc)),
      ));
    }
    revoke();
    urls.push(...made);
    if (!cards.length) {
      cards.push(h('div', { class: 'empty' },
        icon(query ? 'search' : 'scans'),
        h('p', {}, query ? 'No matching scans' : 'No scans yet'),
        h('p', { class: 'muted' }, query ? 'Try another name.' : 'Tap Scan to capture a page, or import photos.'),
      ));
    }
    list.replaceChildren(...cards);
  }

  async function menu(doc: DocMeta) {
    const choice = await actionSheet(doc.name, [
      { value: 'open', label: 'Open', icon: 'open' },
      { value: 'rename', label: 'Rename', icon: 'edit' },
      { value: 'pdf', label: 'Save PDF to folder', icon: 'pdf' },
      canShare && { value: 'share', label: 'Share PDF', icon: 'share' },
      { value: 'delete', label: 'Delete', icon: 'trash', danger: true },
    ]);
    if (choice === 'open') push(docScreen(doc.id));
    else if (choice === 'pdf') await savePdf(doc);
    else if (choice === 'share') await sharePdf(doc);
    else if (choice === 'rename') {
      const name = await promptDialog('Rename scan', doc.name);
      if (!name || name === doc.name) return;
      doc.name = name;
      doc.updated = Date.now();
      await putDoc(doc);
      await load();
    } else if (choice === 'delete') {
      const n = doc.pages.length;
      if (!(await confirmDialog(`Delete “${doc.name}” and its ${n} page${n === 1 ? '' : 's'}? Saved PDFs stay in the folder.`, 'Delete', true))) return;
      await deleteDoc(doc);
      toast('Scan deleted');
      await load();
    }
  }

  renderSorts();
  return {
    el: h('div', { class: 'panel' }, h('div', { class: 'list-head' }, sorts), list),
    load,
    setQuery(q) {
      if (q === query) return;
      query = q;
      void render();
    },
    dispose: revoke,
  };
}
