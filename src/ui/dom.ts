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
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
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

function modal<T>(build: (done: (value: T) => void) => HTMLElement, cancelValue: T): Promise<T> {
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

export function toast(message: string, error = false): void {
  const el = h('div', { class: `toast ${error ? 'error' : ''}`, role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

/** Shows a blocking spinner; call the returned function to hide it. Waits one frame so it paints before heavy work. */
export async function busy(message: string): Promise<() => void> {
  const el = h('div', { class: 'backdrop busy' }, h('div', { class: 'spinner' }), h('p', {}, message));
  document.body.append(el);
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  return () => el.remove();
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
