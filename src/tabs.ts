/**
 * Diagram tabs. Each tab is one document (a system diagram today; sequence and class diagrams next),
 * with its own undo history, view and cloud link. The list of open tabs is remembered per device;
 * each tab's document lives in its own localStorage slot so it opens instantly, and the cloud copy
 * (when signed in) is the source of truth.
 */
import { state, renderAll, setDocKey, persist, readLocal, loadFile, type Selection } from './state';
import { adopt, makeNode, type Doc } from './model';
import { fromFile, type DiagramFile, type DiagramKind } from './document';
import * as history from './history';
import { api, ApiError } from './api';
import { fit } from './canvas';
import { cloud, takeCloud, putCloud, saveNow, saveAsNew, signedIn, adoptStored, onCloudChange, setStatus, signature, refreshList, type CloudSlot } from './cloud';

export interface Tab { key: string; kind: DiagramKind; title: string; cloudId?: string; version?: number; share?: string }
interface Session { doc: Doc; meta: DiagramFile['meta']; cloud: CloudSlot; hist: history.Stacks; view: typeof state.view; sel: Selection }

const LIST_KEY = 'cistem.tabs';
const LEGACY_KEYS = ['cistem.doc', 'loadmap.doc'];
export const tabs = { list: [] as Tab[], active: '' };
const sessions = new Map<string, Session>();   // tabs that are open but not on screen
const slot = (key: string) => 'cistem.doc.' + key;
const newKey = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
export const activeTab = () => tabs.list.find(t => t.key === tabs.active);
let firstVisit = false;
export const isFirstVisit = () => firstVisit;

const listeners: (() => void)[] = [];
export function onTabsChange(fn: () => void) { listeners.push(fn); }
function changed() {
  try { localStorage.setItem(LIST_KEY, JSON.stringify({ tabs: tabs.list, active: tabs.active })); } catch { /* storage unavailable */ }
  listeners.forEach(f => f());
}

// the open tab follows its document: title, and the cloud id/version once saved
// (registered from bootTabs: cloud.ts and this module import each other)
function followCloud() {
  const t = activeTab(); if (!t || t.share) return;
  if (cloud.id && (t.cloudId !== cloud.id || t.version !== cloud.version)) { t.cloudId = cloud.id; t.version = cloud.version; changed(); }
}
export function syncActiveTitle() {
  const t = activeTab(); if (t && t.title !== state.meta.title) { t.title = state.meta.title; changed(); }
}

function blankDoc(): Doc {
  return adopt({ nodes: [makeNode('entry', 80, 200)], edges: [], containers: [], links: [], frames: {}, detail: {} });
}
const freshMeta = (title = 'Untitled system'): DiagramFile['meta'] => { const now = new Date().toISOString(); return { title, created: now, updated: now }; };
const opened = () => document.dispatchEvent(new CustomEvent('cistem:opened'));

/** Wait for (or force) the open tab's pending save, so switching never drops edits. */
async function flush() { if (signedIn() && cloud.id && !cloud.readonly && (cloud.status === 'dirty' || cloud.status === 'saving')) await saveNow(); }

/** Park the open tab's live state. */
function stash() {
  const t = activeTab(); if (!t) return;
  persist();
  sessions.set(t.key, { doc: state.doc, meta: state.meta, cloud: takeCloud(), hist: history.takeStacks(), view: { ...state.view }, sel: state.sel });
}
function show(key: string) {
  tabs.active = key; setDocKey(slot(key));
  state.sel = null; state.multi.clear();
}

export async function activate(key: string) {
  if (key === tabs.active) return;
  const t = tabs.list.find(x => x.key === key); if (!t) return;
  await flush();
  stash(); show(key);
  const s = sessions.get(key);
  if (s) {
    sessions.delete(key);
    state.doc = s.doc; state.meta = s.meta; state.view = s.view; state.sel = s.sel;
    history.putStacks(s.hist); putCloud(s.cloud);
    changed(); renderAll(); opened();
    return;
  }
  changed();
  await load(t);
}

/** First open of a tab in this page: the local copy right away, then the cloud copy if it's newer. */
async function load(t: Tab, refresh = true) {
  history.reset();
  const local = readLocal(slot(t.key));
  if (local) { state.doc = local.doc; state.meta = local.meta; } else { state.doc = blankDoc(); state.meta = freshMeta(t.title); }
  putCloud(t.cloudId ? { id: t.cloudId, version: t.version ?? 0, status: 'saved', readonly: false, lastSerialized: signature() } : null);
  if (t.share) { cloud.readonly = true; setStatus('readonly'); }
  renderAll(); requestAnimationFrame(() => fit(false)); opened();
  if (!refresh || !signedIn() && !t.share) return;
  try {
    if (t.share) { const s = await api.shared(t.share); if (tabs.active === t.key) adoptStored(s, true); return; }
    if (!t.cloudId) return;
    const s = await api.get(t.cloudId);
    if (tabs.active !== t.key) return;
    const mine = local && s.version === t.version ? { doc: state.doc, meta: state.meta } : null;
    adoptStored(s);
    // same version as the copy we kept, but edited since: keep the edits and let autosave send them
    if (mine) { const theirs = cloud.lastSerialized; state.doc = mine.doc; state.meta = mine.meta; cloud.lastSerialized = theirs; renderAll(); opened(); }
  } catch (e) {
    if (tabs.active !== t.key) return;
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
      // deleted, or not ours: keep what we have as a local diagram
      delete t.cloudId; delete t.version; putCloud(null); changed();
      setStatus('local', t.share ? 'That share link no longer works' : 'That diagram is no longer in your account; kept here as a local copy');
    } else setStatus('error', (e as Error).message);
  }
}

/**
 * Open a new tab. With `file`, that document (example, import); otherwise a blank diagram of `kind`.
 * Signed in, it's saved to the account straight away unless `save` is false.
 */
export async function newTab(kind: DiagramKind = 'system', file?: unknown, save = true) {
  await flush(); stash();
  const t: Tab = { key: newKey(), kind, title: 'Untitled system' };
  const at = tabs.list.findIndex(x => x.key === tabs.active);
  tabs.list.splice(at < 0 ? tabs.list.length : at + 1, 0, t);
  show(t.key);
  if (file !== undefined) loadFile(file); else { state.doc = blankDoc(); state.meta = freshMeta(); }
  t.title = state.meta.title;
  history.reset(); putCloud(null);
  changed(); renderAll(); requestAnimationFrame(() => fit(false)); opened();
  if (save && signedIn()) await saveAsNew();
  return t;
}

/** Open a saved diagram: switch to its tab, or open it in a new one. `refresh` reloads the open tab. */
export async function openCloudTab(id: string, refresh = false) {
  const have = tabs.list.find(t => t.cloudId === id);
  if (have) {
    if (have.key !== tabs.active) await activate(have.key);
    else if (refresh) await load(have);
    return;
  }
  await flush(); stash();
  const t: Tab = { key: newKey(), kind: 'system', title: '…', cloudId: id };
  const at = tabs.list.findIndex(x => x.key === tabs.active);
  tabs.list.splice(at < 0 ? tabs.list.length : at + 1, 0, t);
  show(t.key); changed();
  await load(t);
}
export async function openSharedTab(token: string) {
  const have = tabs.list.find(t => t.share === token);
  if (have) { if (have.key !== tabs.active) await activate(have.key); else await load(have); return; }
  await flush(); stash();
  const t: Tab = { key: newKey(), kind: 'system', title: 'Shared diagram', share: token };
  tabs.list.push(t); show(t.key); changed();
  await load(t);
}

/** Close a tab (the diagram itself stays in the account). The last tab closing leaves a blank one. */
export async function closeTab(key: string, quiet = false) {
  const i = tabs.list.findIndex(t => t.key === key); if (i < 0) return;
  const wasActive = key === tabs.active;
  if (wasActive) await flush();
  tabs.list.splice(i, 1); sessions.delete(key);
  try { localStorage.removeItem(slot(key)); } catch { /* ignore */ }
  if (!wasActive) { changed(); return; }
  tabs.active = ''; setDocKey('');
  if (!tabs.list.length) { await newTab('system', undefined, false); return; }
  await activate(tabs.list[Math.min(i, tabs.list.length - 1)].key);
  if (!quiet) refreshList();
}
export async function closeCloudTabs(id: string) {
  for (const t of tabs.list.filter(x => x.cloudId === id)) await closeTab(t.key, true);
}
export function moveTab(key: string, to: number) {
  const i = tabs.list.findIndex(t => t.key === key); if (i < 0) return;
  const [t] = tabs.list.splice(i, 1); tabs.list.splice(Math.max(0, Math.min(to, tabs.list.length)), 0, t);
  changed();
}

/** Restore this device's tabs (instantly, from local copies). `fallback` fills a first visit. */
export async function bootTabs(fallback: () => unknown) {
  onCloudChange(followCloud);
  try {
    const saved = JSON.parse(localStorage.getItem(LIST_KEY) || 'null');
    if (saved && Array.isArray(saved.tabs)) { tabs.list = saved.tabs.filter((t: Tab) => t && t.key); tabs.active = saved.active; }
  } catch { /* ignore */ }
  if (!tabs.list.length) {
    // before tabs there was a single local document; it becomes the first tab
    const t: Tab = { key: newKey(), kind: 'system', title: 'Untitled system' };
    let legacy: string | null = null;
    try { for (const k of LEGACY_KEYS) { legacy = localStorage.getItem(k); if (legacy) break; } } catch { /* ignore */ }
    const doc = legacy ? readLegacy(legacy) : null;
    if (!doc) firstVisit = true;
    try { localStorage.setItem(slot(t.key), doc ?? JSON.stringify(fallback())); LEGACY_KEYS.forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
    tabs.list = [t];
    const r = readLocal(slot(t.key)); if (r) t.title = r.meta.title;
    tabs.active = t.key;
  }
  if (!tabs.list.some(t => t.key === tabs.active)) tabs.active = tabs.list[0].key;
  show(tabs.active); changed();
  await load(activeTab()!, false);
}
function readLegacy(s: string): string | null {
  try { return fromFile(JSON.parse(s)).doc.nodes.length ? s : null; } catch { return null; }
}
