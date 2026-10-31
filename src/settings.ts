/** User preferences, kept in localStorage. */

export type Theme = 'system' | 'light' | 'dark';
export type Accent = 'teal' | 'indigo' | 'violet' | 'rose' | 'amber';
export type PageSize = 'fit' | 'a4' | 'letter';
export type Quality = 'original' | 'medium' | 'small';
export type DocSort = 'newest' | 'oldest' | 'name' | 'pages';
export type FileSort = 'newest' | 'oldest' | 'name' | 'size';

export interface Settings {
  theme: Theme;
  accent: Accent;
  pageSize: PageSize;
  quality: Quality;
  /** File name for saved PDFs: {name}, {date} and {time} are replaced. */
  namePattern: string;
  /** Add an invisible text layer (OCR) to saved PDFs. */
  searchable: boolean;
  sort: DocSort;
  fileSort: FileSort;
  /** Sync the save folder with Google Drive after saving and on start. */
  autoSync: boolean;
  /** OAuth client overrides; empty means the ones built into the release. */
  clientId: string;
  clientSecret: string;
}

const DEFAULTS: Settings = {
  theme: 'system',
  accent: 'teal',
  pageSize: 'fit',
  quality: 'original',
  namePattern: '{name}',
  searchable: false,
  sort: 'newest',
  fileSort: 'newest',
  autoSync: true,
  clientId: '',
  clientSecret: '',
};

const KEY = 'docscan.settings';
let cache: Settings | null = null;
const listeners = new Set<(s: Settings) => void>();

export function settings(): Settings {
  if (!cache) {
    let saved: Partial<Settings> = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    } catch {
      // corrupt or blocked storage: defaults
    }
    cache = { ...DEFAULTS, ...saved };
  }
  return cache;
}

export function updateSettings(patch: Partial<Settings>): void {
  cache = { ...settings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // storage full or blocked: keep the change for this session
  }
  listeners.forEach((fn) => fn(cache!));
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Swatch colours; the CSS defines the same pairs as --accent and --accent-2. */
export const ACCENTS: { id: Accent; label: string; color: string; color2: string }[] = [
  { id: 'teal', label: 'Teal', color: '#0d9488', color2: '#0891b2' },
  { id: 'indigo', label: 'Indigo', color: '#4f46e5', color2: '#7c3aed' },
  { id: 'violet', label: 'Violet', color: '#7c3aed', color2: '#db2777' },
  { id: 'rose', label: 'Rose', color: '#e11d48', color2: '#f97316' },
  { id: 'amber', label: 'Amber', color: '#d97706', color2: '#e11d48' },
];

/** Applies theme and accent to the document element. */
export function applyAppearance(s = settings()): void {
  const root = document.documentElement;
  if (s.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = s.theme;
  root.dataset.accent = s.accent;
}

export function isDark(): boolean {
  const t = settings().theme;
  return t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}

/** "{name} {date}" → "Receipts 2026-10-31". */
export function pdfFileName(docName: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const time = `${p(now.getHours())}.${p(now.getMinutes())}`;
  const base = (settings().namePattern || '{name}')
    .replaceAll('{name}', docName)
    .replaceAll('{date}', date)
    .replaceAll('{time}', time);
  return `${safeFileName(base)}.pdf`;
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^\.+/, '').trim() || 'scan';
}

/** Stored signature image (PNG data URL), or null. */
export function signature(): string | null {
  try {
    return localStorage.getItem('docscan.signature');
  } catch {
    return null;
  }
}

export function setSignature(dataUrl: string | null): void {
  try {
    if (dataUrl) localStorage.setItem('docscan.signature', dataUrl);
    else localStorage.removeItem('docscan.signature');
  } catch {
    // storage blocked
  }
}
