import { drawScaled, toJpeg } from '../imaging/image';
import { firstJpeg } from '../pdf';
import {
  canChooseFolder, canRevealFolder, canShare, chooseFolder, deleteFile, folderLabel, folderSeesAllFiles, listPdfs, openFile,
  readFile, renameFile, revealFolder, shareSaved, type FileEntry,
} from '../platform';
import { safeFileName, settings, updateSettings, type FileSort } from '../settings';
import { onSyncStatus, requestSync, syncNow, syncStatus, type SyncStatus } from '../sync';
import { actionSheet, confirmDialog, errorMessage, h, icon, iconButton, promptDialog, toast } from '../ui/dom';

export interface Panel {
  el: HTMLElement;
  load(): Promise<void>;
  setQuery(q: string): void;
  dispose(): void;
}

const SORTS: { id: FileSort; label: string }[] = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'name', label: 'Name' },
  { id: 'size', label: 'Size' },
];

/** The PDFs tab: every PDF in the save folder, with folder and sync controls. */
export function filesPanel(): Panel {
  const folderName = h('span', { class: 'folder-name' });
  const hint = h('p', { class: 'folder-hint', hidden: true }, 'Only PDFs saved by DocScan are listed. Pick the folder with Change to see every PDF in it.');
  const syncChip = h('button', { class: 'sync-chip', hidden: true, onclick: () => void runSync() });
  const sorts = h('div', { class: 'chip-row' });
  const list = h('div', { class: 'file-list' });
  const urls: string[] = [];
  const revoke = () => urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  let files: FileEntry[] = [];
  let query = '';
  let loading = false;

  const thumbs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      thumbs.unobserve(e.target);
      void fillThumb(e.target as HTMLElement);
    }
  }, { rootMargin: '200px' });

  function renderSorts() {
    const current = settings().fileSort;
    sorts.replaceChildren(icon('sort'), ...SORTS.map((s) => h('button', {
      class: `pill ${s.id === current ? 'on' : ''}`,
      onclick: () => {
        updateSettings({ fileSort: s.id });
        renderSorts();
        render();
      },
    }, s.label)));
  }

  async function load() {
    if (loading) return;
    loading = true;
    try {
      const label = await folderLabel();
      folderName.textContent = label;
      folderName.title = label;
      hint.hidden = folderSeesAllFiles(label);
      files = await listPdfs();
      render();
    } catch (e) {
      list.replaceChildren(h('p', { class: 'empty muted' }, `Cannot read the folder: ${errorMessage(e)}`));
    } finally {
      loading = false;
    }
  }

  function sorted(): FileEntry[] {
    const q = query.toLowerCase();
    const out = files.filter((f) => !q || f.name.toLowerCase().includes(q));
    const by = settings().fileSort;
    if (by === 'name') out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    else if (by === 'size') out.sort((a, b) => b.size - a.size);
    else if (by === 'oldest') out.sort((a, b) => a.modified - b.modified);
    else out.sort((a, b) => b.modified - a.modified);
    return out;
  }

  function render() {
    revoke();
    thumbs.disconnect();
    list.replaceChildren();
    const shown = sorted();
    if (!shown.length) {
      list.append(h('div', { class: 'empty' },
        icon('folder'),
        h('p', {}, query ? 'No matching PDFs' : 'No PDFs here yet'),
        h('p', { class: 'muted' }, query ? 'Try another name.' : 'Open a scan and tap Save PDF. It lands in this folder.'),
      ));
      return;
    }
    for (const f of shown) {
      const thumb = h('div', { class: 'file-thumb', 'data-name': f.name, 'data-key': `${f.name}|${f.size}|${f.modified}` }, icon('pdf'));
      thumbs.observe(thumb);
      list.append(h('div', { class: 'file-row' },
        h('button', { class: 'file-main', onclick: () => void open(f) },
          thumb,
          h('div', { class: 'doc-info' },
            h('strong', {}, f.name.replace(/\.pdf$/i, '')),
            h('span', { class: 'muted' }, `${formatSize(f.size)} · ${formatDate(f.modified)}`),
          ),
        ),
        iconButton('more', 'More', () => void menu(f)),
      ));
    }
  }

  async function fillThumb(el: HTMLElement) {
    const key = el.dataset.key!;
    try {
      let blob = await thumbCache.get(key);
      if (!blob) {
        const made = await makeThumb(el.dataset.name!);
        if (!made) return;
        await thumbCache.put(key, made);
        blob = made;
      }
      const url = URL.createObjectURL(blob);
      urls.push(url);
      el.replaceChildren(h('img', { src: url, alt: '' }));
    } catch {
      // keep the PDF icon
    }
  }

  async function open(f: FileEntry) {
    try {
      await openFile(f.name);
    } catch (e) {
      toast(errorMessage(e), true);
    }
  }

  async function menu(f: FileEntry) {
    const choice = await actionSheet(f.name, [
      { value: 'open', label: 'Open', icon: 'open' },
      canShare && { value: 'share', label: 'Share', icon: 'share' },
      { value: 'rename', label: 'Rename', icon: 'edit' },
      { value: 'delete', label: 'Delete', icon: 'trash', danger: true },
    ]);
    try {
      if (choice === 'open') await open(f);
      else if (choice === 'share') shareSaved(f.name);
      else if (choice === 'rename') {
        const base = await promptDialog('Rename PDF', f.name.replace(/\.pdf$/i, ''));
        if (!base) return;
        const to = `${safeFileName(base)}.pdf`;
        if (to === f.name) return;
        if (files.some((o) => o.name === to)) {
          toast(`${to} already exists`, true);
          return;
        }
        await renameFile(f.name, to);
        toast('Renamed');
        requestSync();
        await load();
      } else if (choice === 'delete') {
        const synced = syncStatus().email ? ' It is also removed from Google Drive at the next sync.' : '';
        if (!(await confirmDialog(`Delete “${f.name}” from the folder?${synced}`, 'Delete', true))) return;
        await deleteFile(f.name);
        toast('PDF deleted');
        requestSync();
        await load();
      }
    } catch (e) {
      toast(errorMessage(e), true);
    }
  }

  async function changeFolder() {
    try {
      const label = await chooseFolder();
      if (label) {
        toast(`Saving to ${label}`);
        await load();
        requestSync();
      }
    } catch (e) {
      toast(errorMessage(e), true);
    }
  }

  async function runSync() {
    const s = syncStatus();
    if (!s.email) return;
    try {
      await syncNow();
      await load();
    } catch (e) {
      toast(errorMessage(e), true);
    }
  }

  function showSync(s: SyncStatus) {
    syncChip.hidden = !s.email;
    if (!s.email) return;
    syncChip.classList.toggle('spinning', s.running);
    syncChip.classList.toggle('error', !!s.error && !s.running);
    const text = s.running ? 'Syncing…' : s.error ? 'Sync problem' : s.last ? `Drive · ${s.summary}` : 'Drive';
    syncChip.title = s.error ?? `Google Drive: ${s.email}`;
    syncChip.replaceChildren(icon(s.running ? 'sync' : 'cloud'), h('span', {}, text));
  }
  const offSync = onSyncStatus((s) => {
    showSync(s);
    // Downloads changed the folder.
    if (!s.running) void load();
  });
  showSync(syncStatus());

  const el = h('div', { class: 'panel' },
    h('div', { class: 'folder-card' },
      h('div', { class: 'folder-icon' }, icon('folder')),
      h('div', { class: 'folder-text' }, h('span', { class: 'muted' }, 'Save folder'), folderName),
      canRevealFolder && iconButton('open', 'Open folder', () => void revealFolder().catch((e) => toast(errorMessage(e), true))),
      canChooseFolder && h('button', { class: 'pill on', onclick: () => void changeFolder() }, 'Change'),
    ),
    hint,
    h('div', { class: 'list-head' }, sorts, syncChip),
    list,
  );
  renderSorts();

  return {
    el,
    load,
    setQuery(q) {
      if (q === query) return;
      query = q;
      render();
    },
    dispose() {
      offSync();
      thumbs.disconnect();
      revoke();
    },
  };
}

/** First page image of the PDF, scaled down; null when the PDF has no JPEG pages. */
async function makeThumb(name: string): Promise<Blob | null> {
  // Most DocScan pages fit in the first 2 MB; read the whole file only when needed.
  let bytes = new Uint8Array(await (await readFile(name, 2 * 1024 * 1024)).arrayBuffer());
  let jpeg = firstJpeg(bytes);
  let bmp = jpeg ? await createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' })).catch(() => null) : null;
  if (!bmp && bytes.length >= 2 * 1024 * 1024) {
    bytes = new Uint8Array(await (await readFile(name)).arrayBuffer());
    jpeg = firstJpeg(bytes);
    bmp = jpeg ? await createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' })).catch(() => null) : null;
  }
  if (!bmp) return null;
  const c = drawScaled(bmp, bmp.width, bmp.height, 200);
  bmp.close();
  return toJpeg(c, 0.7);
}

/** Thumbnails keyed by name, size and date, so a changed file gets a new one. */
const thumbCache = (() => {
  let dbp: Promise<IDBDatabase> | null = null;
  const store = async (mode: IDBTransactionMode) => {
    dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('docscan-thumbs', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('thumbs');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return (await dbp).transaction('thumbs', mode).objectStore('thumbs');
  };
  const wrap = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return {
    get: async (key: string) => wrap((await store('readonly')).get(key) as IDBRequest<Blob | undefined>),
    put: async (key: string, blob: Blob) => void (await wrap((await store('readwrite')).put(blob, key))),
  };
})();

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
