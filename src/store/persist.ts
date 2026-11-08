/** Keep the open document in this browser, and send changes to the account when signed in. */
import { useEditor } from './editor';
import { currentFile } from './files';
import { cloud, scheduleSave } from './cloud';
import { activeTab, openProject } from './tabs';
import * as local from './local';
import { hint } from './ui';

let last = { key: '', body: '' };

/** Write the open document to this browser, only when it changed (other windows hear about these writes). */
export function persist() {
  const t = activeTab(), p = openProject();
  if (!t || !p || p.scope === 'view' || t.readonly || cloud().readonly) return;
  const file = currentFile();
  const body = JSON.stringify({ ...file, meta: { ...file.meta, updated: '' } });
  if (last.key === t.key && last.body === body) return;
  // deleted or moved away in another window since: don't bring it back
  const before = local.doc(t.key);
  if (p.scope === 'local' && last.key === t.key && (!before || before.project !== p.id)) return;
  local.putDoc(t.key, {
    project: p.scope === 'local' ? p.id : null,
    file,
    ...(t.cloudId ? { cloudId: t.cloudId, version: cloud().version } : {}),
  });
  last = { key: t.key, body };
}

export function startPersisting() {
  local.onWriteError(() => hint('This browser refused to store the diagram (storage full?) — export it, or sign in to save it to your account', 6000));
  useEditor.subscribe((s, prev) => {
    if (s.open === prev.open && s.meta === prev.meta) return;
    persist();
    scheduleSave();
  });
}
