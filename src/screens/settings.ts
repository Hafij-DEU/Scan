import {
  canChooseFolder, canRevealFolder, canSignIn, chooseFolder, folderLabel, isAndroid, openUrl, resetFolder, revealFolder,
} from '../platform';
import {
  ACCENTS, setSignature, settings, signature, updateSettings, type PageSize, type Quality, type Settings, type Theme,
} from '../settings';
import { onSyncStatus, requestSync, signIn, signOut, syncNow, syncStatus, type SyncStatus } from '../sync';
import { confirmDialog, errorMessage, h, icon, iconButton, toast } from '../ui/dom';
import { pop, push, type Screen } from '../ui/router';
import { aboutScreen } from './about';
import { drawSignature } from './sign';

const CONSOLE = 'https://console.cloud.google.com/apis/credentials';

export function settingsScreen(): Screen {
  const offs: (() => void)[] = [];

  const body = h('main', { class: 'content settings' },
    section('Appearance', 'palette',
      row('Theme', segmented<Theme>([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], 'theme')),
      row('Colour', accentPicker()),
    ),
    folderSection(),
    section('PDF', 'pdf',
      row('Page size', segmented<PageSize>([['fit', 'Fit'], ['a4', 'A4'], ['letter', 'Letter']], 'pageSize')),
      row('Image quality', segmented<Quality>([['original', 'Best'], ['medium', 'Medium'], ['small', 'Small']], 'quality')),
      nameRow(),
      toggleRow('Searchable PDF', 'Adds recognised text (English) so you can search and copy it in PDF readers. Slower to save.', 'searchable'),
    ),
    driveSection(),
    signatureSection(),
    h('button', { class: 'settings-link', onclick: () => push(aboutScreen()) }, icon('info'), h('span', {}, 'About DocScan'), icon('right')),
  );

  /** One settings field as a row of buttons. */
  function segmented<T extends string>(options: [T, string][], key: keyof Settings) {
    const wrap = h('div', { class: 'segmented' });
    const render = () => wrap.replaceChildren(...options.map(([value, label]) => h('button', {
      class: settings()[key] === value ? 'on' : '',
      onclick: () => {
        updateSettings({ [key]: value });
        render();
      },
    }, label)));
    render();
    return wrap;
  }

  function accentPicker() {
    const wrap = h('div', { class: 'swatches' });
    const render = () => wrap.replaceChildren(...ACCENTS.map((a) => {
      const b = h('button', {
        class: `swatch ${settings().accent === a.id ? 'on' : ''}`,
        title: a.label,
        'aria-label': a.label,
        onclick: () => {
          updateSettings({ accent: a.id });
          render();
        },
      });
      b.style.background = `linear-gradient(135deg, ${a.color}, ${a.color2})`;
      return b;
    }));
    render();
    return wrap;
  }

  function toggleRow(label: string, hint: string, key: 'searchable' | 'autoSync') {
    const input = h('input', { type: 'checkbox', class: 'switch', checked: settings()[key] });
    input.addEventListener('change', () => {
      updateSettings({ [key]: input.checked });
      if (key === 'autoSync' && input.checked) requestSync(200);
    });
    return h('label', { class: 'set-row toggle' }, h('div', {}, h('strong', {}, label), h('span', { class: 'muted' }, hint)), input);
  }

  function nameRow() {
    const input = h('input', { class: 'text-input', value: settings().namePattern, placeholder: '{name}', maxlength: 80 });
    input.addEventListener('change', () => updateSettings({ namePattern: input.value.trim() || '{name}' }));
    return h('div', { class: 'set-row stack' },
      h('strong', {}, 'File name'),
      input,
      h('span', { class: 'muted' }, '{name} = scan name, {date} = 2026-10-31, {time} = 14.05'),
    );
  }

  function folderSection() {
    const label = h('span', { class: 'folder-name' }, '…');
    const refresh = () => void folderLabel().then((l) => {
      label.textContent = l;
      label.title = l;
    });
    refresh();
    const run = (fn: () => Promise<unknown>) => () => void fn().catch((e) => toast(errorMessage(e), true));
    return section('Save folder', 'folder',
      h('div', { class: 'set-row stack' },
        label,
        h('span', { class: 'muted' }, 'Saved PDFs go here, and the PDFs tab lists this folder.'),
        h('div', { class: 'button-row' },
          canChooseFolder && h('button', {
            class: 'pill on',
            onclick: run(async () => {
              const l = await chooseFolder();
              if (l) {
                refresh();
                toast(`Saving to ${l}`);
                requestSync();
              }
            }),
          }, 'Change'),
          isAndroid && h('button', {
            class: 'pill',
            onclick: () => {
              resetFolder();
              refresh();
              toast('Saving to Documents/DocScan');
            },
          }, 'Use Documents/DocScan'),
          canRevealFolder && h('button', { class: 'pill', onclick: run(revealFolder) }, 'Open folder'),
        ),
      ),
    );
  }

  function driveSection() {
    if (!canSignIn) {
      return section('Google Drive', 'cloud', h('p', { class: 'set-row muted' }, 'Drive sync works in the desktop and Android apps.'));
    }
    const state = h('div', { class: 'set-row stack' });
    const idInput = h('input', { class: 'text-input', value: settings().clientId, placeholder: 'xxxx.apps.googleusercontent.com', spellcheck: 'false' });
    const secretInput = h('input', { class: 'text-input', value: settings().clientSecret, placeholder: 'Client secret', spellcheck: 'false', type: 'password' });
    idInput.addEventListener('change', () => updateSettings({ clientId: idInput.value.trim() }));
    secretInput.addEventListener('change', () => updateSettings({ clientSecret: secretInput.value.trim() }));

    const act = (fn: () => Promise<unknown>) => () => void fn().catch((e) => toast(errorMessage(e), true));
    function render(s: SyncStatus) {
      if (!s.configured) {
        state.replaceChildren(
          h('strong', {}, 'Not set up'),
          h('span', { class: 'muted' }, 'Add a Google OAuth client below to turn on sync.'),
        );
        return;
      }
      if (!s.email) {
        state.replaceChildren(
          h('span', { class: 'muted' }, 'Keep the save folder in step with a “DocScan” folder in your Google Drive, on every device you sign in on.'),
          h('div', { class: 'button-row' }, h('button', {
            class: 'btn primary',
            onclick: act(async () => {
              toast('Finish signing in in your browser');
              const email = await signIn();
              toast(`Signed in as ${email}`);
              await syncNow();
            }),
          }, icon('cloud'), 'Sign in with Google')),
        );
        return;
      }
      const when = s.running ? 'Syncing now…' : s.error ? `Problem: ${s.error}` : s.last ? `Last sync ${new Date(s.last).toLocaleTimeString()} · ${s.summary}` : 'Not synced yet';
      state.replaceChildren(
        h('strong', {}, s.email),
        h('span', { class: s.error ? 'error-text' : 'muted' }, when),
        h('div', { class: 'button-row' },
          h('button', { class: 'btn primary', disabled: s.running, onclick: act(syncNow) }, icon('sync'), 'Sync now'),
          h('button', {
            class: 'pill',
            onclick: act(async () => {
              if (await confirmDialog('Sign out of Google Drive? Files stay in the folder and in Drive.', 'Sign out')) await signOut();
            }),
          }, 'Sign out'),
        ),
      );
    }
    render(syncStatus());
    offs.push(onSyncStatus(render));

    const setup = h('details', { class: 'set-row setup' },
      h('summary', {}, 'Google API client'),
      h('ol', {},
        h('li', {}, 'Open Google Cloud Console and create a project.'),
        h('li', {}, 'Enable the Google Drive API.'),
        h('li', {}, 'Set up the OAuth consent screen and add yourself as a test user.'),
        h('li', {}, 'Create an OAuth client ID of type “Desktop app”.'),
        h('li', {}, 'Paste its client ID and secret here. Then sign in.'),
      ),
      h('button', { class: 'pill', onclick: () => void openUrl(CONSOLE) }, 'Open Cloud Console'),
      idInput,
      secretInput,
      h('button', {
        class: 'pill on',
        onclick: () => {
          updateSettings({ clientId: idInput.value.trim(), clientSecret: secretInput.value.trim() });
          render(syncStatus());
          toast('Client saved');
        },
      }, 'Save client'),
    );
    if (!syncStatus().configured) setup.open = true;

    return section('Google Drive', 'cloud',
      state,
      toggleRow('Auto sync', 'Sync after saving and when the app opens.', 'autoSync'),
      setup,
    );
  }

  function signatureSection() {
    const preview = h('div', { class: 'sig-preview' });
    const clear = h('button', {
      class: 'pill',
      onclick: () => {
        setSignature(null);
        render();
      },
    }, 'Clear');
    const render = () => {
      const sig = signature();
      preview.replaceChildren(sig ? h('img', { src: sig, alt: 'Your signature' }) : h('span', { class: 'muted' }, 'No signature yet'));
      clear.hidden = !sig;
    };
    render();
    return section('Signature', 'sign',
      h('div', { class: 'set-row stack' },
        preview,
        h('span', { class: 'muted' }, 'Stored only on this device. Open a page and tap Sign to place it.'),
        h('div', { class: 'button-row' },
          h('button', { class: 'pill on', onclick: () => void drawSignature().then((ok) => ok && render()) }, 'Draw'),
          clear,
        ),
      ),
    );
  }

  const el = h('div', { class: 'settings-screen' },
    h('header', { class: 'bar' }, iconButton('back', 'Back', () => pop()), h('h1', { class: 'bar-title' }, 'Settings')),
    body,
  );
  return { name: 'settings', el, dispose: () => offs.forEach((f) => f()) };
}

function section(title: string, iconName: string, ...rows: (Node | false)[]): HTMLElement {
  return h('section', { class: 'set-section' },
    h('h2', {}, icon(iconName), title),
    h('div', { class: 'set-card' }, ...rows),
  );
}

function row(label: string, control: Node): HTMLElement {
  return h('div', { class: 'set-row' }, h('strong', {}, label), control);
}
