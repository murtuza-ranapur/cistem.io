/** The account's diagrams (the drawer) and what to show when the page opens. */
import { create } from 'zustand';
import { api, type Summary } from '../lib/api';
import { useCloud, setStatus, signedIn, whenSaved } from './cloud';
import { openCloudTab, openSharedTab, newTab, closeCloudTabs, closeTab, activeTab, isFirstVisit, tabs } from './tabs';
import { useUi } from './ui';

/** The drawer's list: null while loading, or the error that stopped it. */
export const useDiagramList = create(() => ({ items: null as Summary[] | null, error: '' }));

export async function refreshList() {
  if (!signedIn()) return;
  try { useDiagramList.setState({ items: await api.list(), error: '' }); }
  catch (e) { useDiagramList.setState({ error: (e as Error).message }); }
}
whenSaved(() => { void refreshList(); });

export function openDrawer() { useUi.setState({ drawerOpen: true }); void refreshList(); }
export const closeDrawer = () => useUi.setState({ drawerOpen: false });

export async function openDiagram(id: string) { closeDrawer(); await openCloudTab(id); }
export async function newDiagram() { closeDrawer(); await newTab('system'); }
export async function deleteDiagram(id: string) {
  try { await api.remove(id); await closeCloudTabs(id); await refreshList(); }
  catch (e) { setStatus('error', (e as Error).message); }
}

/**
 * Resolve who we are and what to show. The tabs restored from this device are already on screen; this links
 * them up with the account: ?s= opens a shared copy, ?d= a saved diagram (in its tab, or a new one), otherwise
 * the open tab is refreshed from the cloud. A first visit opens the most recent diagram.
 */
export async function bootCloud(href: string): Promise<void> {
  const u = new URL(href);
  const s = u.searchParams.get('s'), d = u.searchParams.get('d');
  useCloud.setState({ user: await api.me().catch(() => null) });

  if (s) { await openSharedTab(s); return; }
  if (!signedIn()) { setStatus('local'); return; }

  // just came back from GitHub? restore the address we left from
  try {
    const back = sessionStorage.getItem('cistem.returnTo');
    if (back !== null) {
      sessionStorage.removeItem('cistem.returnTo');
      const bu = new URL(location.origin + '/' + back), bd = bu.searchParams.get('d');
      if (bd && !d) { window.history.replaceState(null, '', bu.toString()); return bootCloud(bu.toString()); }
    }
  } catch { /* ignore */ }

  if (d) { await openCloudTab(d); return; }
  const t = activeTab();
  if (t?.cloudId) { await openCloudTab(t.cloudId, true); return; }
  const list = await api.list().catch(() => [] as Summary[]);
  if (list.length && !tabs().list.some(x => x.cloudId)) {
    const placeholder = isFirstVisit() ? t?.key : undefined;   // the example a first visit starts with
    await openCloudTab(list[0].id);
    if (placeholder) await closeTab(placeholder);
    return;
  }
  setStatus('local');
}
