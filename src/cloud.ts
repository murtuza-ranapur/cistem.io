/**
 * Cloud sync: diagram list drawer, autosave, conflict handling, ?d= / ?s= URLs,
 * and the API settings dialog. Everything here degrades to "offline" when the
 * API is not configured or unreachable.
 */
import { api, enabled, getConfig, setConfig, ConflictError, ApiError, type Summary, type Stored } from './api';
import { toFile } from './document';
import { state, loadFile, loadExample, renderAll, esc } from './state';
import { fit } from './canvas';
import * as history from './history';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Which stored diagram the editor currently holds, if any. */
export const cloud = {
  id: null as string | null,
  version: 0,
  status: 'offline' as 'offline' | 'saved' | 'saving' | 'dirty' | 'conflict' | 'error' | 'readonly',
  readonly: false,
  lastSerialized: '',
};

let onStatus: ((s: typeof cloud.status, detail?: string) => void) | null = null;
export function onSyncStatus(fn: typeof onStatus) { onStatus = fn; }
function setStatus(s: typeof cloud.status, detail?: string) { cloud.status = s; onStatus?.(s, detail); }

// ---------- autosave ----------
let timer = 0;
let inflight: Promise<void> | null = null;
export function scheduleSave() {
  if (!enabled() || !cloud.id || cloud.readonly) return;
  const now = JSON.stringify(toFile(state.doc, state.meta));
  if (now === cloud.lastSerialized) return;
  setStatus('dirty');
  clearTimeout(timer);
  timer = window.setTimeout(saveNow, 900);
}
export async function saveNow() {
  if (!enabled() || !cloud.id || cloud.readonly) return;
  if (inflight) { await inflight; }
  const file = toFile(state.doc, state.meta);
  const serialized = JSON.stringify(file);
  if (serialized === cloud.lastSerialized) { setStatus('saved'); return; }
  setStatus('saving');
  inflight = (async () => {
    try {
      const stored = await api.update(cloud.id!, cloud.version, file);
      cloud.version = stored.version; cloud.lastSerialized = serialized;
      state.meta = { ...state.meta, created: stored.document.meta.created, updated: stored.updatedAt };
      setStatus('saved');
      refreshList();
    } catch (e) {
      if (e instanceof ConflictError) { pendingConflict = e.current; setStatus('conflict'); }
      else setStatus('error', (e as Error).message);
    } finally { inflight = null; }
  })();
  await inflight;
}
window.addEventListener('beforeunload', () => { if (cloud.status === 'dirty') saveNow(); });

// ---------- conflict ----------
let pendingConflict: Stored | null = null;
export function resolveConflict(choice: 'theirs' | 'mine') {
  if (!pendingConflict) return;
  const theirs = pendingConflict; pendingConflict = null;
  if (choice === 'theirs') { adoptStored(theirs); }
  else { cloud.version = theirs.version; cloud.lastSerialized = ''; saveNow(); }
}

// ---------- open / create ----------
function adoptStored(s: Stored, readonly = false) {
  cloud.id = readonly ? null : s.id; cloud.version = s.version; cloud.readonly = readonly;
  loadFile(s.document);
  cloud.lastSerialized = JSON.stringify(toFile(state.doc, state.meta));
  history.reset();
  renderAll(); requestAnimationFrame(() => fit(false));
  setStatus(readonly ? 'readonly' : 'saved');
  syncUrl();
  document.dispatchEvent(new CustomEvent('cistem:opened'));
}
export async function openDiagram(id: string) {
  try { adoptStored(await api.get(id)); closeDrawer(); }
  catch (e) { setStatus('error', (e as Error).message); }
}
export async function openShared(token: string) {
  try { adoptStored(await api.shared(token), true); }
  catch (e) { setStatus('error', 'Share link not found'); }
}
/** Save the current in-memory diagram as a new cloud diagram. */
export async function saveAsNew() {
  if (!enabled()) { openSettings(); return; }
  try {
    const stored = await api.create(toFile(state.doc, state.meta));
    cloud.id = stored.id; cloud.version = stored.version; cloud.readonly = false;
    cloud.lastSerialized = JSON.stringify(toFile(state.doc, state.meta));
    setStatus('saved'); syncUrl(); refreshList();
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
  if (enabled()) await saveAsNew(); else setStatus('offline');
  closeDrawer();
}
export async function deleteDiagram(id: string) {
  try { await api.remove(id); if (cloud.id === id) { cloud.id = null; setStatus('offline'); syncUrl(); } refreshList(); }
  catch (e) { setStatus('error', (e as Error).message); }
}
export async function toggleShare(): Promise<string | null> {
  if (!cloud.id) return null;
  const s = await api.get(cloud.id);
  if (s.shareToken) { await api.unshare(cloud.id); refreshList(); return null; }
  await api.share(cloud.id); const after = await api.get(cloud.id); refreshList();
  return shareUrl(after.shareToken!);
}
export const shareUrl = (token: string) => `${location.origin}${location.pathname}?s=${token}`;

function syncUrl() {
  const u = new URL(location.href);
  u.searchParams.delete('s');
  if (cloud.id) u.searchParams.set('d', cloud.id); else u.searchParams.delete('d');
  history_replace(u);
}
const history_replace = (u: URL) => window.history.replaceState(null, '', u.toString());

// ---------- drawer ----------
const drawer = $('drawer'), listEl = $('drawerList');
export function openDrawer() { drawer.hidden = false; refreshList(); }
export function closeDrawer() { drawer.hidden = true; }
let listCache: Summary[] = [];
export async function refreshList() {
  if (!enabled()) { listEl.innerHTML = `<p class="empty">Not connected. <button class="small" id="drawerConnect">Connect to API</button></p>`; $('drawerConnect')?.addEventListener('click', openSettings); return; }
  try { listCache = await api.list(); }
  catch (e) { listEl.innerHTML = `<p class="empty">Couldn't load diagrams: ${esc((e as Error).message)}</p>`; return; }
  if (!listCache.length) { listEl.innerHTML = '<p class="empty">No diagrams yet. Save this one or start a new one.</p>'; return; }
  listEl.innerHTML = listCache.map(d => `
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

// ---------- settings ----------
const settings = $('settings'), urlIn = $<HTMLInputElement>('apiUrl'), keyIn = $<HTMLInputElement>('apiKey'), msgEl = $('settingsMsg');
export function openSettings() {
  const c = getConfig(); urlIn.value = c?.url ?? (import.meta.env.VITE_API_URL as string ?? ''); keyIn.value = c?.key ?? '';
  msgEl.textContent = ''; settings.hidden = false; (c?.url ? keyIn : urlIn).focus();
}
export function closeSettings() { settings.hidden = true; }
$('settingsSave').onclick = async () => {
  const url = urlIn.value.trim().replace(/\/$/, ''), key = keyIn.value.trim();
  if (!url) { setConfig(null); setStatus('offline'); closeSettings(); refreshList(); return; }
  setConfig({ url, key });
  msgEl.textContent = 'Checking…';
  try { await api.ping(); msgEl.textContent = ''; closeSettings(); setStatus(cloud.id ? 'saved' : 'offline'); refreshList(); if (!cloud.id) openDrawer(); }
  catch (e) { msgEl.textContent = e instanceof ApiError && e.status === 401 ? 'The API rejected that key.' : `Couldn't reach the API: ${(e as Error).message}`; }
};
$('settingsClose').onclick = closeSettings;
settings.addEventListener('click', ev => { if (ev.target === settings) closeSettings(); });

// ---------- boot ----------
export async function bootCloud(): Promise<boolean> {
  const u = new URL(location.href);
  const s = u.searchParams.get('s'), d = u.searchParams.get('d');
  if (s && enabled()) { await openShared(s); return true; }
  if (d && enabled()) { try { adoptStored(await api.get(d)); return true; } catch { /* fall through */ } }
  setStatus(enabled() ? 'offline' : 'offline');
  return false;
}
