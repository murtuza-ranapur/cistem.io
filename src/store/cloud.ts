/**
 * The open tab's link to the account: autosave, conflicts, live refresh and sharing.
 * Signed out, nothing here runs and the editor works from this browser's storage alone.
 */
import { create } from 'zustand';
import { api, ConflictError, AuthError, type Stored, type Profile } from '../lib/api';
import { editor, replace } from './editor';
import * as history from './history';
import { currentFile, readFile, signature } from './files';
import { fitWhenDrawn } from './commands';
import { toast } from './ui';

export type SyncStatus = 'local' | 'saved' | 'saving' | 'dirty' | 'conflict' | 'error' | 'readonly';

interface CloudState {
  user: Profile | null;
  /** The open tab's saved diagram (null: not saved, or a shared copy). */
  id: string | null;
  version: number;
  status: SyncStatus;
  /** Why the status is what it is (shown as the status' tooltip). */
  detail: string;
  readonly: boolean;
}
export const useCloud = create<CloudState>(() => ({ user: null, id: null, version: 0, status: 'local', detail: '', readonly: false }));
export const cloud = () => useCloud.getState();
export const signedIn = () => !!cloud().user;

/** The document as last saved or loaded; autosave runs when the open document differs from it. */
let lastSaved = '';
export const markSaved = () => { lastSaved = signature(); };

export function setStatus(status: SyncStatus, detail = '') {
  useCloud.setState({ status, detail });
  if (detail && (status === 'error' || status === 'local')) toast(detail, 4000);
}

/** The cloud link of the open tab; tabs swap it in and out when switching. */
export interface CloudSlot { id: string | null; version: number; status: SyncStatus; readonly: boolean; lastSaved: string }
export function takeSlot(): CloudSlot {
  clearTimeout(timer);
  const c = cloud();
  return { id: c.id, version: c.version, status: c.status, readonly: c.readonly, lastSaved };
}
export function putSlot(s: CloudSlot | null) {
  clearTimeout(timer);
  useCloud.setState({ id: s?.id ?? null, version: s?.version ?? 0, readonly: s?.readonly ?? false, status: s?.status ?? 'local', detail: '' });
  lastSaved = s?.lastSaved ?? '';
  syncUrl();
}

// ---------- sign in / out ----------
export function signIn() {
  // keep what the user was looking at so it survives the redirect
  try { sessionStorage.setItem('cistem.returnTo', location.search); } catch { /* ignore */ }
  location.href = api.signInUrl();
}
export async function signOut() {
  try { await api.logout(); } catch { /* already out */ }
  useCloud.setState({ user: null, id: null, version: 0, readonly: false, status: 'local', detail: '' });
  lastSaved = '';
  syncUrl();
}

// ---------- autosave ----------
let timer = 0;
let inflight: Promise<void> | null = null;
/** After every edit: save soon if the document differs from the saved one. */
export function scheduleSave() {
  const c = cloud();
  if (!c.user || !c.id || c.readonly) return;
  if (signature() === lastSaved) return;
  if (c.status !== 'dirty') setStatus('dirty');
  clearTimeout(timer);
  timer = window.setTimeout(saveNow, 900);
}
export async function saveNow() {
  if (!signedIn()) return;
  if (!cloud().id) { await saveAsNew(); return; }
  if (cloud().readonly) return;
  if (inflight) await inflight;
  const file = currentFile(), sig = signature();
  if (sig === lastSaved) { setStatus('saved'); return; }
  setStatus('saving');
  const id = cloud().id!;
  inflight = (async () => {
    try {
      const stored = await api.update(id, cloud().version, file as never);
      if (cloud().id !== id) return;   // switched tabs meanwhile; that tab's slot was taken before the switch
      useCloud.setState({ version: stored.version });
      lastSaved = sig;
      setStatus('saved'); onSaved();
    } catch (e) {
      if (e instanceof ConflictError) { pendingConflict = e.current; setStatus('conflict'); }
      else if (e instanceof AuthError) { useCloud.setState({ user: null }); setStatus('local', 'Session expired; sign in again to keep saving'); }
      else setStatus('error', (e as Error).message);
    } finally { inflight = null; }
  })();
  await inflight;
}
/** Save the open document as a new diagram in the account. */
export async function saveAsNew() {
  if (!signedIn()) { signIn(); return; }
  try {
    setStatus('saving');
    const stored = await api.create(currentFile() as never);
    useCloud.setState({ id: stored.id, version: stored.version, readonly: false });
    lastSaved = signature();
    setStatus('saved'); syncUrl(stored.id); onSaved();
  } catch (e) { setStatus('error', (e as Error).message); }
}
/** Something wants to know about saves (the drawer's list). */
let onSaved = () => {};
export const whenSaved = (fn: () => void) => { onSaved = fn; };
window.addEventListener('beforeunload', () => { if (cloud().status === 'dirty') void saveNow(); });

// ---------- conflict ----------
let pendingConflict: Stored | null = null;
export function resolveConflict(choice: 'theirs' | 'mine') {
  if (!pendingConflict) return;
  const theirs = pendingConflict; pendingConflict = null;
  if (choice === 'theirs') adoptStored(theirs);
  else { useCloud.setState({ version: theirs.version }); lastSaved = ''; void saveNow(); }
}

// ---------- loading ----------
/** Show a saved (or shared) diagram in the open tab. Throws when the document can't be read. */
export function adoptStored(s: Stored, readonly = false) {
  const same = cloud().id === s.id;
  const { open, meta } = readFile(s.document);
  const sel = editor().selection;
  replace(open, meta, same ? { selection: sel } : {});
  useCloud.setState({ id: readonly ? null : s.id, version: s.version, readonly });
  lastSaved = signature();
  history.reset();
  if (!same) fitWhenDrawn();
  setStatus(readonly ? 'readonly' : 'saved');
  syncUrl(readonly ? undefined : s.id);
}

// ---------- live refresh ----------
// While a saved diagram is open and nothing is pending, ask every few seconds whether someone else
// (another window, an MCP client) saved a newer version, and show it if so.
async function pollOnce() {
  const c = cloud();
  if (!c.user || !c.id || c.readonly || c.status !== 'saved' || document.hidden) return;
  try {
    const mine = (await api.list()).find(d => d.id === c.id);
    if (!mine || mine.version <= cloud().version || cloud().status !== 'saved') return;
    adoptStored(await api.get(c.id));
    toast('Updated from another session');
  } catch { /* transient */ }
}
let pollTimer = 0;
export function startPolling() {
  clearInterval(pollTimer);
  pollTimer = window.setInterval(pollOnce, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void pollOnce(); });
}

// ---------- sharing ----------
export const shareUrl = (token: string) => `${location.origin}/?s=${token}`;
/** Turn the open diagram's share link on (returns it) or off (returns null). */
export async function toggleShare(): Promise<string | null> {
  const id = cloud().id; if (!id) return null;
  const s = await api.get(id);
  if (s.shareToken) { await api.unshare(id); onSaved(); return null; }
  const after = await api.share(id); onSaved();
  return shareUrl(after.shareToken!);
}

/** Keep ?d= in the address bar pointing at the open diagram. */
export function syncUrl(id?: string) {
  const u = new URL(location.href);
  u.searchParams.delete('s'); u.searchParams.delete('login');
  const d = id ?? cloud().id;
  if (d) u.searchParams.set('d', d); else u.searchParams.delete('d');
  window.history.replaceState(null, '', u.toString());
}
