import type { FilterId } from './imaging/filters';
import type { Quad } from './imaging/geometry';

export type Rotation = 0 | 90 | 180 | 270;

export interface DocMeta {
  id: string;
  name: string;
  created: number;
  updated: number;
  pages: string[];
}

export interface PageRec {
  id: string;
  docId: string;
  /** Uncropped capture, kept so the crop and filter can be re-edited. */
  original: Blob;
  quad: Quad;
  filter: FilterId;
  rotation: Rotation;
  processed: Blob;
  width: number;
  height: number;
  thumb: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('docscan', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('docs', { keyPath: 'id' });
      d.createObjectStore('pages', { keyPath: 'id' }).createIndex('docId', 'docId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: 'docs' | 'pages', mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
  return (await db()).transaction(name, mode).objectStore(name);
}

export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export async function listDocs(): Promise<DocMeta[]> {
  const docs = await wrap((await store('docs')).getAll() as IDBRequest<DocMeta[]>);
  return docs.sort((a, b) => b.updated - a.updated);
}

export async function getDoc(id: string): Promise<DocMeta | undefined> {
  return wrap((await store('docs')).get(id) as IDBRequest<DocMeta | undefined>);
}

export async function putDoc(doc: DocMeta): Promise<void> {
  await wrap((await store('docs', 'readwrite')).put(doc));
}

export async function getPage(id: string): Promise<PageRec | undefined> {
  return wrap((await store('pages')).get(id) as IDBRequest<PageRec | undefined>);
}

export async function putPage(page: PageRec): Promise<void> {
  await wrap((await store('pages', 'readwrite')).put(page));
}

export async function deletePage(doc: DocMeta, pageId: string): Promise<void> {
  await wrap((await store('pages', 'readwrite')).delete(pageId));
  doc.pages = doc.pages.filter((p) => p !== pageId);
  doc.updated = Date.now();
  await putDoc(doc);
}

export async function deleteDoc(doc: DocMeta): Promise<void> {
  const d = await db();
  const tx = d.transaction(['docs', 'pages'], 'readwrite');
  const pages = tx.objectStore('pages');
  for (const id of doc.pages) pages.delete(id);
  tx.objectStore('docs').delete(doc.id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function defaultDocName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Scan ${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}.${p(date.getMinutes())}`;
}
