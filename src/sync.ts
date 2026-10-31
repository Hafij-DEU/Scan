import { canSignIn, deleteFile, listPdfs, oauthListen, openUrl, readFile, writeFile, type FileEntry } from './platform';
import { settings } from './settings';

/**
 * Two-way sync between the save folder and a "DocScan" folder in the user's
 * Google Drive. Uses the drive.file scope, so the app sees only files it
 * created there. Sign-in is OAuth 2 for installed apps: PKCE, system browser,
 * redirect to a loopback port the app listens on.
 */

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ACCOUNT_KEY = 'docscan.google';
const STATE_KEY = 'docscan.syncState';

interface Account {
  refresh: string;
  email: string;
  folderId?: string;
}

interface RemoteFile {
  id: string;
  name: string;
  md5Checksum?: string;
  modifiedTime: string;
  size?: string;
}

/** What both sides looked like after the last successful sync of a file. */
interface FileState {
  id: string;
  md5: string;
  size: number;
  mod: number;
}

export interface SyncStatus {
  configured: boolean;
  email: string | null;
  running: boolean;
  last: number | null;
  error: string | null;
  /** Summary of the last run, e.g. "2 up, 1 down". */
  summary: string;
}

const status: SyncStatus = { configured: false, email: null, running: false, last: null, error: null, summary: '' };
const listeners = new Set<(s: SyncStatus) => void>();
let access: { token: string; expires: number } | null = null;
let timer = 0;

export function clientId(): string {
  return settings().clientId.trim() || (import.meta.env.VITE_GOOGLE_CLIENT_ID) || '';
}

function clientSecret(): string {
  return settings().clientSecret.trim() || (import.meta.env.VITE_GOOGLE_CLIENT_SECRET) || '';
}

export function syncStatus(): SyncStatus {
  status.configured = canSignIn && !!clientId();
  status.email = account()?.email ?? null;
  return status;
}

export function onSyncStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  const s = syncStatus();
  listeners.forEach((fn) => fn(s));
}

function account(): Account | null {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? 'null') as Account | null;
  } catch {
    return null;
  }
}

function saveAccount(a: Account | null): void {
  if (a) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a));
  else localStorage.removeItem(ACCOUNT_KEY);
}

function loadState(): Record<string, FileState> {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') as Record<string, FileState>;
  } catch {
    return {};
  }
}

function saveState(s: Record<string, FileState>): void {
  localStorage.setItem(STATE_KEY, JSON.stringify(s));
}

export async function signIn(): Promise<string> {
  const id = clientId();
  if (!id) throw new Error('Add a Google OAuth client ID in Settings first');
  const { port, wait } = await oauthListen();
  const redirect = `http://127.0.0.1:${port}`;
  const verifier = randomString(64);
  const state = randomString(24);
  const { challenge, method } = await pkceChallenge(verifier);
  const url = `${AUTH}?${new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    response_type: 'code',
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: method,
    state,
    access_type: 'offline',
    prompt: 'consent',
  })}`;
  await openUrl(url);
  const reply = new URLSearchParams(await wait);
  if (reply.get('state') !== state) throw new Error('Sign-in failed: the reply did not match the request');
  const error = reply.get('error');
  if (error) throw new Error(error === 'access_denied' ? 'Sign-in cancelled' : `Sign-in failed: ${error}`);
  const code = reply.get('code');
  if (!code) throw new Error('Sign-in failed: no code returned');

  const token = await tokenRequest({
    code,
    client_id: id,
    redirect_uri: redirect,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  if (!token.refresh_token) throw new Error('Google did not return a refresh token; remove DocScan from your Google account permissions and sign in again');
  access = { token: token.access_token, expires: Date.now() + (token.expires_in - 60) * 1000 };
  const about = await api<{ user: { emailAddress: string } }>(`${API}/about?fields=user(emailAddress)`);
  saveAccount({ refresh: token.refresh_token, email: about.user.emailAddress });
  saveState({});
  status.error = null;
  emit();
  return about.user.emailAddress;
}

export async function signOut(): Promise<void> {
  const a = account();
  saveAccount(null);
  saveState({});
  access = null;
  status.error = null;
  status.last = null;
  status.summary = '';
  emit();
  if (a) {
    // Revoking is best effort; the local token is gone either way.
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: a.refresh }),
    }).catch(() => undefined);
  }
}

/** Sync soon (debounced) when signed in and auto-sync is on. */
export function requestSync(delay = 1500): void {
  if (!account() || !settings().autoSync || !syncStatus().configured) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => void syncNow().catch(() => undefined), delay);
}

let running: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  running ??= runSync().finally(() => {
    running = null;
  });
  return running;
}

async function runSync(): Promise<void> {
  const a = account();
  if (!a) throw new Error('Not signed in');
  status.running = true;
  status.error = null;
  emit();
  let up = 0;
  let down = 0;
  let removed = 0;
  try {
    const folder = await driveFolder(a);
    const local = byName(await listPdfs());
    const remote = byName(await listRemote(folder));
    const state = loadState();
    const synced = new Set<string>();
    const names = new Set([...local.keys(), ...remote.keys(), ...Object.keys(state)]);

    for (const name of names) {
      const L = local.get(name);
      const R = remote.get(name);
      const S = state[name];
      try {
        if (L && R) {
          const lChanged = !S || L.size !== S.size || L.modified !== S.mod;
          const rChanged = !S || (R.md5Checksum ?? '') !== S.md5;
          if (!S && L.size === Number(R.size ?? -1)) {
            // Same file on both sides already (first sync after sign-in).
          } else if (lChanged && rChanged) {
            if (L.modified >= Date.parse(R.modifiedTime)) {
              await uploadUpdate(R.id, name);
              up++;
            } else {
              await download(R.id, name, true);
              down++;
            }
          } else if (lChanged) {
            await uploadUpdate(R.id, name);
            up++;
          } else if (rChanged) {
            await download(R.id, name, true);
            down++;
          }
          synced.add(name);
        } else if (L) {
          if (S && L.size === S.size && L.modified === S.mod) {
            // Unchanged here and gone from Drive: it was deleted there.
            await deleteFile(name);
            removed++;
          } else {
            await uploadNew(folder, name);
            up++;
            synced.add(name);
          }
        } else if (R) {
          if (S && (R.md5Checksum ?? '') === S.md5) {
            // Unchanged on Drive and gone from here: it was deleted here.
            await api(`${API}/files/${R.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
            removed++;
          } else {
            await download(R.id, name, false);
            down++;
            synced.add(name);
          }
        }
      } catch (e) {
        console.warn(`sync ${name}:`, e);
        status.error = `${name}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // Record what both sides look like now for every file that is in sync.
    const localNow = byName(await listPdfs());
    const remoteNow = byName(await listRemote(folder));
    const next: Record<string, FileState> = {};
    for (const name of synced) {
      const L = localNow.get(name);
      const R = remoteNow.get(name);
      if (L && R) next[name] = { id: R.id, md5: R.md5Checksum ?? '', size: L.size, mod: L.modified };
    }
    saveState(next);
    status.last = Date.now();
    status.summary = [up && `${up} up`, down && `${down} down`, removed && `${removed} removed`].filter(Boolean).join(', ') || 'Up to date';
  } catch (e) {
    status.error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    status.running = false;
    emit();
  }
}

function byName<T extends { name: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.name, i]));
}

async function driveFolder(a: Account): Promise<string> {
  if (a.folderId) {
    const f = await api<{ trashed: boolean }>(`${API}/files/${a.folderId}?fields=trashed`).catch(() => null);
    if (f && !f.trashed) return a.folderId;
  }
  const q = `name='DocScan' and mimeType='${FOLDER_MIME}' and trashed=false and 'root' in parents`;
  const found = await api<{ files: { id: string }[] }>(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`);
  let id = found.files[0]?.id;
  if (!id) {
    const created = await api<{ id: string }>(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'DocScan', mimeType: FOLDER_MIME }),
    });
    id = created.id;
  }
  saveAccount({ ...a, folderId: id });
  return id;
}

async function listRemote(folder: string): Promise<RemoteFile[]> {
  const out: RemoteFile[] = [];
  let page = '';
  do {
    const params = new URLSearchParams({
      q: `'${folder}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'`,
      fields: 'nextPageToken,files(id,name,md5Checksum,modifiedTime,size)',
      pageSize: '1000',
      orderBy: 'modifiedTime desc',
    });
    if (page) params.set('pageToken', page);
    const res = await api<{ files: RemoteFile[]; nextPageToken?: string }>(`${API}/files?${params}`);
    // Drive allows duplicate names; keep the newest of each (listed first).
    for (const f of res.files) if (f.name.toLowerCase().endsWith('.pdf') && !out.some((o) => o.name === f.name)) out.push(f);
    page = res.nextPageToken ?? '';
  } while (page);
  return out;
}

async function uploadNew(folder: string, name: string): Promise<void> {
  const blob = await readFile(name);
  const boundary = `docscan${randomString(16)}`;
  const meta = JSON.stringify({ name, parents: [folder], mimeType: 'application/pdf' });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

async function uploadUpdate(id: string, name: string): Promise<void> {
  const blob = await readFile(name);
  await api(`${UPLOAD}/files/${id}?uploadType=media&fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/pdf' },
    body: blob,
  });
}

async function download(id: string, name: string, overwrite: boolean): Promise<void> {
  const res = await authed(`${API}/files/${id}?alt=media`);
  const blob = new Blob([await res.arrayBuffer()], { type: 'application/pdf' });
  await writeFile(name, blob, overwrite);
}

interface TokenReply {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenReply> {
  const secret = clientSecret();
  const body = new URLSearchParams(secret ? { ...params, client_secret: secret } : params);
  const res = await fetch(TOKEN, { method: 'POST', body });
  const json = (await res.json().catch(() => ({}))) as TokenReply & { error?: string; error_description?: string };
  if (!res.ok) {
    const err = new Error(json.error_description || json.error || `Google sign-in error ${res.status}`);
    (err as Error & { code?: string }).code = json.error;
    throw err;
  }
  return json;
}

async function accessToken(): Promise<string> {
  if (access && access.expires > Date.now()) return access.token;
  const a = account();
  if (!a) throw new Error('Not signed in');
  try {
    const t = await tokenRequest({ refresh_token: a.refresh, client_id: clientId(), grant_type: 'refresh_token' });
    access = { token: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000 };
    return access.token;
  } catch (e) {
    if ((e as Error & { code?: string }).code === 'invalid_grant') {
      saveAccount(null);
      emit();
      throw new Error('Google access expired; sign in again');
    }
    throw e;
  }
}

async function authed(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await accessToken()}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && retry) {
    access = null;
    return authed(url, init, false);
  }
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(json?.error?.message || `Google Drive error ${res.status}`);
  }
  return res;
}

async function api<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await authed(url, init);
  return (await res.json().catch(() => ({}))) as T;
}

function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function pkceChallenge(verifier: string): Promise<{ challenge: string; method: string }> {
  if (!crypto.subtle) return { challenge: verifier, method: 'plain' };
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const b64 = btoa(String.fromCharCode(...hash)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { challenge: b64, method: 'S256' };
}

export type { FileEntry };
