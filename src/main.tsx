import './style.css';
import './notes/notes.css';
import './ui/projects.css';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { bootWorkspace, bootAccount } from './store/projects';
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
  await bootWorkspace(exampleFile);   // the project this device had open, from what this browser keeps
  startPersisting();
  await bootAccount(openedWith);     // the account's projects when signed in (and ?d= / ?p= / ?s=)
  startPolling();
})();
