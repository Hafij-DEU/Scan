import './style.css';
import { homeScreen } from './screens/home';
import { closeDialog } from './ui/dom';
import { initRouter, pop } from './ui/router';

initRouter(document.getElementById('app')!, homeScreen());

window.__docscanBack = () => closeDialog() || pop();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.__docscanBack?.();
});

// Scans live only in IndexedDB; ask the browser not to evict them under storage pressure.
void navigator.storage?.persist?.().catch(() => false);
