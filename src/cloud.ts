/**
 * Account + cloud sync: sign-in state, diagram drawer, autosave, conflict handling,
 * ?d= / ?s= URLs. Signed out, the editor works against localStorage only.
 */
import { api, ConflictError, AuthError, type Summary, type Stored, type Profile } from './api';
import { toFile } from './document';
import { state, loadFile, loadExample, renderAll, esc } from './state';
import { fit } from './canvas';
import * as history from './history';

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

let onStatus: ((s: SyncStatus, detail?: string) => void) | null = null;
let onUser: ((u: Profile | null) => void) | null = null;
export function onSyncStatus(fn: typeof onStatus) { onStatus = fn; }
export function onUserChange(fn: typeof onUser) { onUser = fn; }
function setStatus(s: SyncStatus, detail?: string) { cloud.status = s; onStatus?.(s, detail); }

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
  const now = JSON.stringify(toFile(state.doc, state.meta));
  if (now === cloud.lastSerialized) return;
  setStatus('dirty');
  clearTimeout(timer);
  timer = window.setTimeout(saveNow, 900);
}
export async function saveNow() {
  if (!signedIn()) return;
  if (!cloud.id) { await saveAsNew(); return; }
  if (cloud.readonly) return;
  if (inflight) await inflight;
  const file = toFile(state.doc, state.meta);
  const serialized = JSON.stringify(file);
  if (serialized === cloud.lastSerialized) { setStatus('saved'); return; }
  setStatus('saving');
  inflight = (async () => {
    try {
      const stored = await api.update(cloud.id!, cloud.version, file);
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
function adoptStored(s: Stored, readonly = false) {
  const sameDiagram = cloud.id === s.id;
  cloud.id = readonly ? null : s.id; cloud.version = s.version; cloud.readonly = readonly;
  loadFile(s.document);
  cloud.lastSerialized = JSON.stringify(toFile(state.doc, state.meta));
  history.reset();
  renderAll(); if (!sameDiagram) requestAnimationFrame(() => fit(false));
  setStatus(readonly ? 'readonly' : 'saved');
  syncUrl(readonly ? undefined : s.id);
  document.dispatchEvent(new CustomEvent('cistem:opened'));
}
export async function openDiagram(id: string) {
  try { adoptStored(await api.get(id)); closeDrawer(); }
  catch (e) { setStatus('error', (e as Error).message); }
}
export async function openShared(token: string) {
  try { adoptStored(await api.shared(token), true); }
  catch { setStatus('error', 'That share link no longer works'); }
}
/** Save the current in-memory diagram as a new cloud diagram. */
export async function saveAsNew() {
  if (!signedIn()) { signIn(); return; }
  try {
    setStatus('saving');
    const stored = await api.create(toFile(state.doc, state.meta));
    cloud.id = stored.id; cloud.version = stored.version; cloud.readonly = false;
    cloud.lastSerialized = JSON.stringify(toFile(state.doc, state.meta));
    setStatus('saved'); syncUrl(stored.id); refreshList();
    document.dispatchEvent(new CustomEvent('cistem:opened'));
  } catch (e) { setStatus('error', (e as Error).message); }
}
export async function newDiagram() {
  loadExample();
  state.doc.nodes = state.doc.nodes.filter(n => n.kind === 'entry'); state.doc.edges = [];
  state.meta.title = 'Untitled system';
  cloud.id = null; cloud.version = 0; cloud.readonly = false; cloud.lastSerialized = '';
  history.reset(); renderAll(); requestAnimationFrame(() => fit(false));
  document.dispatchEvent(new CustomEvent('cistem:opened'));
  syncUrl();
  if (signedIn()) await saveAsNew(); else setStatus('local');
  closeDrawer();
}
export async function deleteDiagram(id: string) {
  try { await api.remove(id); if (cloud.id === id) { cloud.id = null; setStatus('local'); syncUrl(); } refreshList(); }
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

function syncUrl(id?: string) {
  const u = new URL(location.href);
  u.searchParams.delete('s'); u.searchParams.delete('login');
  if (id ?? cloud.id) u.searchParams.set('d', (id ?? cloud.id)!); else u.searchParams.delete('d');
  window.history.replaceState(null, '', u.toString());
}

// ---------- drawer ----------
const drawer = $('drawer'), listEl = $('drawerList');
export function openDrawer() { if (!signedIn()) { signIn(); return; } drawer.hidden = false; refreshList(); }
export function closeDrawer() { drawer.hidden = true; }
export async function refreshList() {
  if (!signedIn()) return;
  let list: Summary[];
  try { list = await api.list(); }
  catch (e) { listEl.innerHTML = `<p class="empty">Couldn't load diagrams: ${esc((e as Error).message)}</p>`; return; }
  if (!list.length) { listEl.innerHTML = '<p class="empty">No diagrams yet. Save this one or start a new one.</p>'; return; }
  listEl.innerHTML = list.map(d => `
    <div class="ditem ${d.id === cloud.id ? 'on' : ''}" data-open="${d.id}">
      <div class="dtitle">${esc(d.title)}${d.shared ? ' <span class="tag">shared</span>' : ''}</div>
      <div class="dmeta">${d.kind} · v${d.version} · ${timeAgo(d.updatedAt)}</div>
      <button class="x" data-del="${d.id}" aria-label="Delete">×</button>
    </div>`).join('');
}
listEl.addEventListener('click', ev => {
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
 * Resolve who we are and what to show. Returns true when a cloud diagram was loaded,
 * so main.ts knows not to fall back to localStorage.
 */
export async function bootCloud(hasLocalWork: boolean): Promise<boolean> {
  const u = new URL(location.href);
  const s = u.searchParams.get('s'), d = u.searchParams.get('d');
  try { cloud.user = await api.me(); } catch { cloud.user = null; }
  onUser?.(cloud.user);

  if (s) { await openShared(s); return true; }
  if (!signedIn()) { setStatus('local'); return false; }

  // Just came back from GitHub? restore the URL we left from.
  try {
    const back = sessionStorage.getItem('cistem.returnTo');
    if (back !== null) { sessionStorage.removeItem('cistem.returnTo'); const bu = new URL(location.origin + '/' + back); const bd = bu.searchParams.get('d'); if (bd && !d) { window.history.replaceState(null, '', bu.toString()); return bootCloud(hasLocalWork); } }
  } catch { /* ignore */ }

  if (d) { try { adoptStored(await api.get(d)); return true; } catch { /* fall through: deleted or someone else's */ } }

  // Signed in with nothing open: offer to keep local work, else open the most recent diagram.
  const list = await api.list().catch(() => [] as Summary[]);
  if (hasLocalWork && !list.length) { setStatus('local'); return false; } // first save will create it
  if (list.length) { adoptStored(await api.get(list[0].id)); return true; }
  setStatus('local');
  return false;
}
