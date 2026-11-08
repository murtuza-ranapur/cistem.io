import './style.css';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { bootTabs } from './store/tabs';
import { bootCloud } from './store/account';
import { startPolling } from './store/cloud';
import { startPersisting } from './store/persist';
import { listenForClipboard } from './store/clipboard';
import { listenForKeys } from './ui/keyboard';
import { initTooltips } from './lib/tooltip';
import { exampleFile } from './ui/actions';
import { toast } from './store/ui';

// the address the page was opened with: restoring tabs rewrites the URL before the account is checked
const openedWith = location.href;

createRoot(document.getElementById('root')!).render(<App />);
listenForKeys();
listenForClipboard();
initTooltips();
if (new URL(openedWith).searchParams.get('login') === 'failed') toast('GitHub sign-in didn\'t complete. Try again.', 5000);

(async () => {
  await bootTabs(exampleFile);   // this device's tabs, from their local copies
  startPersisting();
  await bootCloud(openedWith);   // links them up with the account (and ?d= / ?s=)
  startPolling();
})();
