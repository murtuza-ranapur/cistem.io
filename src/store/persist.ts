/** Keep the open document in its tab's local slot, and send changes to the account when signed in. */
import { storage } from '../lib/browser';
import { useEditor } from './editor';
import { currentFile } from './files';
import { scheduleSave } from './cloud';
import { slot, tabs } from './tabs';
import { hint } from './ui';

let last = { key: '', body: '' };

/** Write the open document to its slot, only when it changed (another window listens to these writes). */
export function persist() {
  const active = tabs().active; if (!active) return;
  const key = slot(active), file = currentFile();
  const body = JSON.stringify({ ...file, meta: { ...file.meta, updated: '' } });
  if (last.key === key && last.body === body) return;
  if (storage.set(key, JSON.stringify(file), () => hint('This diagram is too big to keep in this browser — export it, or sign in to save it to your account', 6000))) last = { key, body };
}

export function startPersisting() {
  useEditor.subscribe((s, prev) => {
    if (s.open === prev.open && s.meta === prev.meta) return;
    persist();
    scheduleSave();
  });
}
