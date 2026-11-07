/**
 * Account + cloud sync: sign-in state, diagram drawer, autosave, conflict handling,
 * ?d= / ?s= URLs. Signed out, the editor works against localStorage only.
 */
import { api, ConflictError, AuthError, type Summary, type Stored, type Profile } from './api';
import { state, loadFile, renderAll, esc, currentFile } from './state';
import { fit } from './canvas';
import * as history from './history';
import { openCloudTab, openSharedTab, newTab, closeCloudTabs, activeTab, isFirstVisit, tabs, closeTab } from './tabs';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export type SyncStatus = 'local' | 'saved' | 'saving' | 'dirty' | 'conflict' | 'error' | 'readonly';
export const cloud = {
  user: null as Profile | null,
  id: null as string | null,
  version: 0,
  status: 'local' as SyncStatus,
  readonly: false,
  lastSerialized: '',
};
export const signedIn = () => !!cloud.user;
/** What the cloud has of the open document, ignoring the always-fresh `updated` stamp. */
export function signature(): string { const f = currentFile(); f.meta.updated = ''; return stable(f); }
/** JSON with object keys sorted: the server (Postgres jsonb) hands documents back with keys reordered. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => (v as any)[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable((v as any)[k])).join(',') + '}';
  return JSON.stringify(v) ?? 'null';
}

/** The cloud link of the open tab; tabs swap it in and out. */
export interface CloudSlot { id: string | null; version: number; status: SyncStatus; readonly: boolean; lastSerialized: string }
export function takeCloud(): CloudSlot {
  clearTimeout(timer);
  return { id: cloud.id, version: cloud.version, status: cloud.status, readonly: cloud.readonly, lastSerialized: cloud.lastSerialized };
}
export function putCloud(s: CloudSlot | null) {
  clearTimeout(timer);
  cloud.id = s?.id ?? null; cloud.version = s?.version ?? 0; cloud.readonly = s?.readonly ?? false; cloud.lastSerialized = s?.lastSerialized ?? '';
  setStatus(s?.status ?? 'local'); syncUrl();
}
const changeListeners: (() => void)[] = [];
/** Called after every status change (ids and versions are settled by then). */
export function onCloudChange(fn: () => void) { changeListeners.push(fn); }

let onStatus: ((s: SyncStatus, detail?: string) => void) | null = null;
let onUser: ((u: Profile | null) => void) | null = null;
export function onSyncStatus(fn: typeof onStatus) { onStatus = fn; }
export function onUserChange(fn: typeof onUser) { onUser = fn; }
export function setStatus(s: SyncStatus, detail?: string) { cloud.status = s; onStatus?.(s, detail); changeListeners.forEach(f => f()); }

// ---------- sign in / out ----------
export function signIn() {
  // keep what the user was looking at so it survives the redirect
  try { sessionStorage.setItem('cistem.returnTo', location.search); } catch { /* ignore */ }
  location.href = api.signInUrl();
}
export async function signOut() {
  try { await api.logout(); } catch { /* already out */ }
  cloud.user = null; cloud.id = null; cloud.version = 0; cloud.readonly = false; cloud.lastSerialized = '';
  onUser?.(null); setStatus('local'); syncUrl(); closeDrawer();
}

// ---------- autosave ----------
let timer = 0;
let inflight: Promise<void> | null = null;
export function scheduleSave() {
  if (!signedIn() || !cloud.id || cloud.readonly) return;
  if (signature() === cloud.lastSerialized) return;
  setStatus('dirty');
  clearTimeout(timer);
  timer = window.setTimeout(saveNow, 900);
}
export async function saveNow() {
  if (!signedIn()) return;
  if (!cloud.id) { await saveAsNew(); return; }
  if (cloud.readonly) return;
  if (inflight) await inflight;
  const file = currentFile();
  const serialized = signature();
  if (serialized === cloud.lastSerialized) { setStatus('saved'); return; }
  setStatus('saving');
  const id = cloud.id!;
  inflight = (async () => {
    try {
      const stored = await api.update(id, cloud.version, file);
      if (cloud.id !== id) return; // switched tabs meanwhile; that tab's slot was taken before the switch
      cloud.version = stored.version; cloud.lastSerialized = serialized;
      setStatus('saved'); refreshList();
    } catch (e) {
      if (e instanceof ConflictError) { pendingConflict = e.current; setStatus('conflict'); }
      else if (e instanceof AuthError) { cloud.user = null; onUser?.(null); setStatus('local', 'Session expired; sign in again to keep saving'); }
      else setStatus('error', (e as Error).message);
    } finally { inflight = null; }
  })();
  await inflight;
}
window.addEventListener('beforeunload', () => { if (cloud.status === 'dirty') saveNow(); });

// ---------- live refresh ----------
// While a saved diagram is open and nothing is pending, ask the API every few seconds whether
// someone else (another tab, an MCP client) saved a newer version, and load it if so.
let pollTimer = 0;
async function pollOnce() {
  if (!signedIn() || !cloud.id || cloud.readonly || cloud.status !== 'saved' || document.hidden) return;
  try {
    const list = await api.list();
    const mine = list.find(d => d.id === cloud.id);
    if (mine && mine.version > cloud.version && cloud.status === 'saved') {
      const fresh = await api.get(cloud.id);
      const sel = state.sel;
      adoptStored(fresh);
      state.sel = sel && (sel.type === 'node' ? state.doc.nodes.some(n => n.id === sel.id) : state.doc.edges.some(e => e.id === sel.id)) ? sel : null;
      renderAll();
      document.dispatchEvent(new CustomEvent('cistem:external-update'));
    }
  } catch { /* transient */ }
}
export function startPolling() {
  clearInterval(pollTimer);
  pollTimer = window.setInterval(pollOnce, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollOnce(); });
}

// ---------- conflict ----------
let pendingConflict: Stored | null = null;
export function resolveConflict(choice: 'theirs' | 'mine') {
  if (!pendingConflict) return;
  const theirs = pendingConflict; pendingConflict = null;
  if (choice === 'theirs') adoptStored(theirs);
  else { cloud.version = theirs.version; cloud.lastSerialized = ''; saveNow(); }
}

// ---------- open / create ----------
export function adoptStored(s: Stored, readonly = false) {
  const sameDiagram = cloud.id === s.id;
  cloud.id = readonly ? null : s.id; cloud.version = s.version; cloud.readonly = readonly;
  loadFile(s.document);
  cloud.lastSerialized = signature();
  history.reset();
  renderAll(); if (!sameDiagram) requestAnimationFrame(() => fit(false));
  setStatus(readonly ? 'readonly' : 'saved');
  syncUrl(readonly ? undefined : s.id);
  document.dispatchEvent(new CustomEvent('cistem:opened'));
}
/** Open a saved diagram: its tab if one is open, otherwise a new tab. */
export async function openDiagram(id: string) { closeDrawer(); await openCloudTab(id); }
export async function openShared(token: string) { await openSharedTab(token); }
/** Save the current in-memory diagram as a new cloud diagram. */
export async function saveAsNew() {
  if (!signedIn()) { signIn(); return; }
  try {
    setStatus('saving');
    const stored = await api.create(currentFile());
    cloud.id = stored.id; cloud.version = stored.version; cloud.readonly = false;
    cloud.lastSerialized = signature();
    setStatus('saved'); syncUrl(stored.id); refreshList();
    document.dispatchEvent(new CustomEvent('cistem:opened'));
  } catch (e) { setStatus('error', (e as Error).message); }
}
/** Open a document (the example, an imported file) in a new tab; signed in, it's saved as a new diagram. */
export async function openAsNew(file: unknown) { await newTab('system', file); }
export async function newDiagram() { closeDrawer(); await newTab('system'); }
export async function deleteDiagram(id: string) {
  try { await api.remove(id); await closeCloudTabs(id); refreshList(); }
  catch (e) { setStatus('error', (e as Error).message); }
}
export async function toggleShare(): Promise<string | null> {
  if (!cloud.id) return null;
  const s = await api.get(cloud.id);
  if (s.shareToken) { await api.unshare(cloud.id); refreshList(); return null; }
  const after = await api.share(cloud.id); refreshList();
  return shareUrl(after.shareToken!);
}
export const shareUrl = (token: string) => `${location.origin}/?s=${token}`;

export function syncUrl(id?: string) {
  const u = new URL(location.href);
  u.searchParams.delete('s'); u.searchParams.delete('login');
  if (id ?? cloud.id) u.searchParams.set('d', (id ?? cloud.id)!); else u.searchParams.delete('d');
  window.history.replaceState(null, '', u.toString());
}

// ---------- drawer ----------
const drawer = $('drawer'), listEl = $('drawerList');
/** Signed out, the drawer explains where diagrams live and offers sign-in, rather than leaving for GitHub unasked. */
export function openDrawer() {
  drawer.hidden = false;
  if (!signedIn()) {
    listEl.innerHTML = `<div class="dsignin"><p>Your diagrams are kept in this browser, one per tab.</p><p>Sign in with GitHub to save them to your account, open them on other devices, share links and use them from Claude (MCP).</p><button class="small primary" data-signin>Sign in with GitHub</button></div>`;
    (document.getElementById('saveAsNew') as HTMLElement).hidden = true;
    return;
  }
  (document.getElementById('saveAsNew') as HTMLElement).hidden = false;
  refreshList();
}
export function closeDrawer() { drawer.hidden = true; }
export async function refreshList() {
  if (!signedIn()) return;
  let list: Summary[];
  try { list = await api.list(); }
  catch (e) { listEl.innerHTML = `<p class="empty">Couldn't load diagrams: ${esc((e as Error).message)}</p>`; return; }
  if (!list.length) { listEl.innerHTML = '<p class="empty">No diagrams yet. Save this one or start a new one.</p>'; return; }
  const open = new Set(tabs.list.map(t => t.cloudId));
  listEl.innerHTML = list.map(d => `
    <div class="ditem ${d.id === cloud.id ? 'on' : ''}" data-open="${d.id}">
      <div class="dtitle">${esc(d.title)}${d.shared ? ' <span class="tag">shared</span>' : ''}${open.has(d.id) && d.id !== cloud.id ? ' <span class="tag">open</span>' : ''}</div>
      <div class="dmeta">${esc(d.kind)} · v${esc(d.version)} · ${esc(timeAgo(d.updatedAt))}</div>
      <button class="x" data-del="${d.id}" aria-label="Delete">×</button>
    </div>`).join('');
}
listEl.addEventListener('click', ev => {
  if ((ev.target as Element).closest('[data-signin]')) { signIn(); return; }
  const del = (ev.target as Element).closest('[data-del]') as HTMLElement | null;
  if (del) { const id = del.dataset.del!; confirmInline(del, () => deleteDiagram(id)); return; }
  const it = (ev.target as Element).closest('[data-open]') as HTMLElement | null;
  if (it) openDiagram(it.dataset.open!);
});
function confirmInline(btn: HTMLElement, yes: () => void) {
  if (btn.dataset.armed) { yes(); return; }
  btn.dataset.armed = '1'; btn.textContent = 'sure?'; btn.classList.add('armed');
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = '×'; btn.classList.remove('armed'); }, 2500);
}
function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ---------- boot ----------
/**
 * Resolve who we are and what to show. The tabs restored from this device are already on screen;
 * this links them up with the account: ?s= opens a shared copy, ?d= a saved diagram (in its tab, or a new
 * one), otherwise the open tab is refreshed from the cloud. A first visit opens the most recent diagram.
 */
// the address the page was opened with: restoring tabs rewrites the URL before bootCloud reads it
const openedWith = location.href;
export async function bootCloud(href = openedWith): Promise<void> {
  const u = new URL(href);
  const s = u.searchParams.get('s'), d = u.searchParams.get('d');
  try { cloud.user = await api.me(); } catch { cloud.user = null; }
  onUser?.(cloud.user);

  if (s) { await openShared(s); return; }
  if (!signedIn()) { setStatus('local'); return; }

  // Just came back from GitHub? restore the URL we left from.
  try {
    const back = sessionStorage.getItem('cistem.returnTo');
    if (back !== null) { sessionStorage.removeItem('cistem.returnTo'); const bu = new URL(location.origin + '/' + back); const bd = bu.searchParams.get('d'); if (bd && !d) { window.history.replaceState(null, '', bu.toString()); return bootCloud(bu.toString()); } }
  } catch { /* ignore */ }

  if (d) { await openCloudTab(d); return; }
  const t = activeTab();
  if (t?.cloudId) { await openCloudTab(t.cloudId, true); return; }
  const list = await api.list().catch(() => [] as Summary[]);
  if (list.length && !tabs.list.some(x => x.cloudId)) {
    const placeholder = isFirstVisit() ? t?.key : undefined;  // the example a first visit starts with
    await openCloudTab(list[0].id);
    if (placeholder) await closeTab(placeholder, true);
    return;
  }
  setStatus('local');
}
