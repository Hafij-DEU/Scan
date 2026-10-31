type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown>;

/** Small element builder: `on*` function props become listeners, `class` sets className. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value as EventListener);
    else if (key in el && typeof value !== 'string') (el as unknown as Props)[key] = value;
    else el.setAttribute(key, String(value));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const ICONS: Record<string, string> = {
  back: 'M15 18l-6-6 6-6',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9h.01',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  rotl: 'M3 4v6h6M3.5 10A8.5 8.5 0 1 1 6 16.5',
  rotr: 'M21 4v6h-6M20.5 10A8.5 8.5 0 1 0 18 16.5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  pdf: 'M6 3h8l5 5v13H6zM14 3v5h5M9 13h6M9 17h6',
  plus: 'M12 5v14M5 12h14',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14',
  auto: 'M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  more: 'M12 6h.01M12 12h.01M12 18h.01',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z',
  sign: 'M3 17c3-1 4-9 6-9s-1 9 2 9 3-4 5-4 1 3 5 3M3 21h18',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  idcard: 'M3 5h18v14H3zM8.5 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.5 16a3 3 0 0 1 6 0M14 9h4M14 13h4',
  cloud: 'M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 8.5 4.75 4.75 0 0 1 17.5 18z',
  sync: 'M20 11a8 8 0 0 0-14.3-4.3L4 9M4 4v5h5M4 13a8 8 0 0 0 14.3 4.3L20 15M20 20v-5h-5',
  sort: 'M7 4v16M3.5 16.5 7 20l3.5-3.5M14 6h7M14 12h5M14 18h3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  close: 'M6 6l12 12M18 6L6 18',
  palette: 'M12 3a9 9 0 0 0 0 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.3-1-2.5 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5zM7.5 12h.01M9.5 7.5h.01M14.5 7.5h.01M17 11h.01',
  scans: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
};

export function icon(name: keyof typeof ICONS | string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] ?? '');
  svg.append(path);
  return svg;
}

export function iconButton(name: string, label: string, onclick: () => void, extra = ''): HTMLButtonElement {
  return h('button', { class: `icon-btn ${extra}`, title: label, 'aria-label': label, onclick }, icon(name));
}

export function actionButton(name: string, label: string, onclick: () => void, extra = ''): HTMLButtonElement {
  return h('button', { class: `action ${extra}`, onclick }, icon(name), h('span', {}, label));
}

let dismissTop: (() => void) | null = null;

/** Closes the open dialog, if any (used by the Android back button). */
export function closeDialog(): boolean {
  if (!dismissTop) return false;
  dismissTop();
  return true;
}

export function modal<T>(build: (done: (value: T) => void) => HTMLElement, cancelValue: T): Promise<T> {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'backdrop' });
    const finish = (value: T) => {
      dismissTop = null;
      backdrop.remove();
      resolve(value);
    };
    backdrop.append(build(finish));
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) finish(cancelValue);
    });
    dismissTop = () => finish(cancelValue);
    document.body.append(backdrop);
  });
}

export function confirmDialog(message: string, okLabel: string, danger = false): Promise<boolean> {
  return modal<boolean>((done) => h('div', { class: 'dialog', role: 'dialog' },
    h('p', {}, message),
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'text-btn', onclick: () => done(false) }, 'Cancel'),
      h('button', { class: `text-btn primary ${danger ? 'danger' : ''}`, onclick: () => done(true) }, okLabel),
    ),
  ), false);
}

export function promptDialog(title: string, value: string): Promise<string | null> {
  return modal<string | null>((done) => {
    const input = h('input', { class: 'text-input', value, maxlength: 120 });
    const submit = () => {
      const v = input.value.trim();
      done(v ? v : null);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    setTimeout(() => { input.focus(); input.select(); }, 30);
    return h('div', { class: 'dialog', role: 'dialog' },
      h('h2', {}, title),
      input,
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'text-btn', onclick: () => done(null) }, 'Cancel'),
        h('button', { class: 'text-btn primary', onclick: submit }, 'Save'),
      ),
    );
  }, null);
}

export interface SheetItem<T> {
  value: T;
  label: string;
  icon?: string;
  danger?: boolean;
}

/** Bottom sheet with a list of actions; resolves to the chosen value, or null. */
export function actionSheet<T>(title: string, items: (SheetItem<T> | false | null | undefined)[]): Promise<T | null> {
  return modal<T | null>((done) => h('div', { class: 'sheet', role: 'dialog' },
    h('div', { class: 'sheet-handle' }),
    title ? h('h2', {}, title) : null,
    ...items.filter((i): i is SheetItem<T> => !!i).map((i) =>
      h('button', { class: `sheet-item ${i.danger ? 'danger' : ''}`, onclick: () => done(i.value) }, i.icon ? icon(i.icon) : null, h('span', {}, i.label))),
  ), null);
}

/** Message with several buttons (the last one is the main action); resolves to the chosen value, or null. */
export function choiceDialog<T>(message: string, choices: { label: string; value: T; danger?: boolean }[]): Promise<T | null> {
  return modal<T | null>((done) => h('div', { class: 'dialog', role: 'dialog' },
    h('p', {}, message),
    h('div', { class: 'dialog-actions wrap' },
      h('button', { class: 'text-btn', onclick: () => done(null) }, 'Cancel'),
      ...choices.map((c, i) => h('button', {
        class: `text-btn ${i === choices.length - 1 ? 'primary' : ''} ${c.danger ? 'danger' : ''}`,
        onclick: () => done(c.value),
      }, c.label)),
    ),
  ), null);
}

/** Read-only text with a Copy button (recognised text). */
export function textDialog(title: string, text: string): Promise<void> {
  return modal<void>((done) => {
    const area = h('textarea', { class: 'text-input text-area', readOnly: true });
    area.value = text;
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(area.value);
      } catch {
        area.select();
        document.execCommand('copy');
      }
      toast('Text copied');
    };
    return h('div', { class: 'dialog wide', role: 'dialog' },
      h('h2', {}, title),
      area,
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'text-btn', onclick: () => done() }, 'Close'),
        h('button', { class: 'text-btn primary', onclick: () => void copy() }, icon('copy'), 'Copy'),
      ),
    );
  }, undefined);
}

export function toast(message: string, error = false): void {
  const el = h('div', { class: `toast ${error ? 'error' : ''}`, role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

/** Shows a blocking spinner; call the returned function to hide it. Waits one frame so it paints before heavy work. */
export async function busy(message: string): Promise<(() => void) & { text(message: string): void }> {
  const label = h('p', {}, message);
  const el = h('div', { class: 'backdrop busy' }, h('div', { class: 'spinner' }), label);
  document.body.append(el);
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  return Object.assign(() => el.remove(), { text: (m: string) => void (label.textContent = m) });
}

export function pickImages(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', multiple, class: 'hidden' });
    input.addEventListener('change', () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
