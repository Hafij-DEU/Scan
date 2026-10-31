import './style.css';
import { setSystemBars } from './platform';
import { applyAppearance, isDark, onSettings } from './settings';
import { homeScreen } from './screens/home';
import { requestSync } from './sync';
import { closeDialog } from './ui/dom';
import { initRouter, onScreenChange, pop, topScreen } from './ui/router';

/** Status and navigation bar colours follow the screen: accent on light screens, black on the camera and editors. */
function paintBars(): void {
  const top = topScreen();
  const dark = !!top?.el.classList.contains('dark-screen');
  const css = getComputedStyle(document.documentElement);
  const color = dark ? '#0b0f12' : css.getPropertyValue('--accent').trim() || '#0d9488';
  const bottom = dark ? '#161c21' : css.getPropertyValue('--surface').trim() || '#ffffff';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  setSystemBars(color, bottom, !dark && !isDark());
}

applyAppearance();
onSettings((s) => {
  applyAppearance(s);
  paintBars();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintBars);
onScreenChange(paintBars);

initRouter(document.getElementById('app')!, homeScreen());

window.__docscanBack = () => closeDialog() || pop();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.__docscanBack?.();
});

// Scans live only in IndexedDB; ask the browser not to evict them under storage pressure.
void navigator.storage?.persist?.().catch(() => false);
requestSync(800);
