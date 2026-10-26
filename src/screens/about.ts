import { h, iconButton } from '../ui/dom';
import { pop, type Screen } from '../ui/router';

const REPO = 'https://github.com/Hafij-DEU/Scan';

export function aboutScreen(): Screen {
  const el = h('div', { class: 'about' },
    h('header', { class: 'bar' },
      iconButton('back', 'Back', () => pop()),
      h('h1', { class: 'bar-title' }, 'About'),
    ),
    h('main', { class: 'content' },
      h('h2', {}, `DocScan ${__APP_VERSION__}`),
      h('p', {}, 'Developed by Md. Hafijur Rahman'),
      h('p', {}, 'GitHub: ', h('a', { href: REPO, target: '_blank', rel: 'noreferrer' }, REPO)),
      h('p', {}, 'License: MIT'),
      h('p', { class: 'muted' }, 'Third-party software: Electron (MIT) and Chromium (BSD and others) on desktop, AndroidX WebKit (Apache-2.0) on Android. The PDF writer and image processing are written from scratch, with no OCR or PDF library. Details: THIRD_PARTY_NOTICES.md in the GitHub repository.'),
      h('p', { class: 'muted' }, 'This app was generated with AI. Developer support may not be available.'),
    ),
  );
  return { name: 'about', el };
}
