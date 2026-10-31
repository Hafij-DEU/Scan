/** Methods injected by android/.../Host.java with addJavascriptInterface. Each returns "ok:<info>" or "error:<message>". */
interface AndroidHost {
  folderLabel(): string;
  chooseFolder(): string;
  resetFolder(): string;
  listPdfs(): string;
  readFile(name: string, maxBytes: number): string;
  writeFile(name: string, mime: string, base64: string, overwrite: boolean): string;
  fileExists(name: string): string;
  deleteFile(name: string): string;
  renameFile(from: string, to: string): string;
  openFile(name: string): string;
  shareSaved(name: string): string;
  shareFile(name: string, mime: string, base64: string): string;
  openUrl(url: string): string;
  setSystemBars(top: string, bottom: string, lightBottom: boolean): string;
  oauthListen(): string;
}

/** The part of Tauri's global API (app.withGlobalTauri) the desktop app uses. */
interface TauriCore {
  invoke<T>(cmd: string, args?: Record<string, unknown> | Uint8Array, options?: { headers: Record<string, string> }): Promise<T>;
}

declare global {
  interface Window {
    DocScanHost?: AndroidHost;
    __TAURI__?: { core: TauriCore };
    /** Called by the Android back button; returns true when the app handled it. */
    __docscanBack?: () => boolean;
    /** Android: result of the folder picker (label, or null when cancelled). */
    __docscanFolderPicked?: (label: string | null) => void;
    /** Android: query string of the Google sign-in redirect, or null on timeout. */
    __docscanOAuth?: (query: string | null) => void;
  }
}

const host = window.DocScanHost;
const tauri = window.__TAURI__?.core;

export const isAndroid = !!host;
export const isDesktop = !!tauri;
export const canShare = isAndroid;

export interface FileEntry {
  name: string;
  size: number;
  /** Milliseconds since the epoch. */
  modified: number;
}

/** Thrown by writeFile when the file is there and overwrite is false. */
export class FileExistsError extends Error {
  constructor(name: string) {
    super(`${name} already exists`);
  }
}

function ok(reply: string): string {
  if (reply.startsWith('error:')) throw new Error(reply.slice(6));
  return reply.slice(3);
}

/** Where saved PDFs go, for display. */
export async function folderLabel(): Promise<string> {
  if (host) return ok(host.folderLabel());
  if (tauri) return tauri.invoke<string>('folder_path');
  return 'Browser storage';
}

export const canChooseFolder = !!host || !!tauri;

/** Lets the user pick the save folder; resolves to the new label, or null when cancelled. */
export async function chooseFolder(): Promise<string | null> {
  if (host) {
    return new Promise((resolve) => {
      window.__docscanFolderPicked = (label) => {
        window.__docscanFolderPicked = undefined;
        resolve(label);
      };
      ok(host.chooseFolder());
    });
  }
  if (tauri) return (await tauri.invoke<string>('choose_folder')) || null;
  return null;
}

/** Android only: forget the picked folder and go back to Documents/DocScan. */
export function resetFolder(): void {
  if (host) ok(host.resetFolder());
}

/** Android without a picked folder only sees PDFs the app wrote itself. */
export function folderSeesAllFiles(label: string): boolean {
  return !host || label !== 'Documents/DocScan';
}

export async function listPdfs(): Promise<FileEntry[]> {
  if (host) return JSON.parse(ok(host.listPdfs())) as FileEntry[];
  if (tauri) return tauri.invoke<FileEntry[]>('list_pdfs');
  return (await browserFiles.all()).map(({ name, blob, modified }) => ({ name, size: blob.size, modified }));
}

/** The file, or only its first `max` bytes. */
export async function readFile(name: string, max = 0): Promise<Blob> {
  const type = mimeOf(name);
  if (host) return new Blob([fromBase64(ok(host.readFile(name, max)))], { type });
  if (tauri) {
    const buf = await tauri.invoke<ArrayBuffer>('read_file', max ? { name, max } : { name });
    return new Blob([buf], { type });
  }
  const rec = await browserFiles.get(name);
  if (!rec) throw new Error(`${name} not found`);
  return max ? rec.blob.slice(0, max, type) : rec.blob;
}

export async function writeFile(name: string, blob: Blob, overwrite = false): Promise<void> {
  try {
    if (host) {
      ok(host.writeFile(name, blob.type || mimeOf(name), await toBase64(blob), overwrite));
    } else if (tauri) {
      // Raw bytes, not JSON: a multi-page PDF goes across without base64 or number arrays.
      await tauri.invoke('write_file', new Uint8Array(await blob.arrayBuffer()), {
        headers: { 'x-file-name': encodeURIComponent(name), 'x-overwrite': overwrite ? '1' : '0' },
      });
    } else {
      if (!overwrite && (await browserFiles.get(name))) throw new Error('exists');
      await browserFiles.put({ name, blob, modified: Date.now() });
    }
  } catch (e) {
    if (e === 'exists' || (e instanceof Error && e.message === 'exists')) throw new FileExistsError(name);
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export async function fileExists(name: string): Promise<boolean> {
  if (host) return ok(host.fileExists(name)) === 'true';
  if (tauri) return tauri.invoke<boolean>('file_exists', { name });
  return !!(await browserFiles.get(name));
}

export async function deleteFile(name: string): Promise<void> {
  if (host) ok(host.deleteFile(name));
  else if (tauri) await tauri.invoke('delete_file', { name });
  else await browserFiles.remove(name);
}

export async function renameFile(from: string, to: string): Promise<void> {
  if (host) ok(host.renameFile(from, to));
  else if (tauri) await tauri.invoke('rename_file', { from, to });
  else {
    const rec = await browserFiles.get(from);
    if (!rec) throw new Error(`${from} not found`);
    if (await browserFiles.get(to)) throw new Error(`${to} already exists`);
    await browserFiles.put({ ...rec, name: to });
    await browserFiles.remove(from);
  }
}

/** Opens a saved file in the system viewer. */
export async function openFile(name: string): Promise<void> {
  if (host) ok(host.openFile(name));
  else if (tauri) await tauri.invoke('open_file', { name });
  else {
    const url = URL.createObjectURL(await readFile(name));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export const canRevealFolder = !!tauri;

export async function revealFolder(): Promise<void> {
  if (tauri) await tauri.invoke('reveal_folder');
}

/** Android: share a file from the save folder. */
export function shareSaved(name: string): void {
  if (!host) throw new Error('Sharing is not available on this device');
  ok(host.shareSaved(name));
}

/** Android: share an in-memory file. */
export async function shareBlob(blob: Blob, name: string): Promise<void> {
  if (!host) throw new Error('Sharing is not available on this device');
  ok(host.shareFile(name, blob.type, await toBase64(blob)));
}

export async function openUrl(url: string): Promise<void> {
  if (host) ok(host.openUrl(url));
  else if (tauri) await tauri.invoke('open_url', { url });
  else window.open(url, '_blank', 'noopener');
}

/** Loopback listener for the Google sign-in redirect: its port and the redirect's query string. */
export async function oauthListen(): Promise<{ port: number; wait: Promise<string> }> {
  if (host) {
    const wait = new Promise<string>((resolve, reject) => {
      window.__docscanOAuth = (query) => {
        window.__docscanOAuth = undefined;
        if (query === null) reject(new Error('Sign-in timed out'));
        else resolve(query);
      };
    });
    return { port: Number(ok(host.oauthListen())), wait };
  }
  if (tauri) {
    const port = await tauri.invoke<number>('oauth_listen');
    return { port, wait: tauri.invoke<string>('oauth_wait') };
  }
  throw new Error('Google sign-in needs the DocScan app');
}

export const canSignIn = !!host || !!tauri;

/** Android: colour the status bar and navigation bar strips. */
export function setSystemBars(top: string, bottom: string, lightBottom: boolean): void {
  host?.setSystemBars(top, bottom, lightBottom);
}

export function mimeOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Plain-browser stand-in for the folder (development with `pnpm dev`). */
interface BrowserFile {
  name: string;
  blob: Blob;
  modified: number;
}

const browserFiles = (() => {
  let dbp: Promise<IDBDatabase> | null = null;
  const store = async (mode: IDBTransactionMode) => {
    dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('docscan-files', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'name' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return (await dbp).transaction('files', mode).objectStore('files');
  };
  const wrap = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return {
    all: async () => wrap((await store('readonly')).getAll() as IDBRequest<BrowserFile[]>),
    get: async (name: string) => wrap((await store('readonly')).get(name) as IDBRequest<BrowserFile | undefined>),
    put: async (f: BrowserFile) => void (await wrap((await store('readwrite')).put(f))),
    remove: async (name: string) => void (await wrap((await store('readwrite')).delete(name))),
  };
})();
