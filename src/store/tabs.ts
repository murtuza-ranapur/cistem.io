/**
 * Diagram tabs. Each tab is one document with its own undo history, view, selection and cloud link.
 * The list of open tabs is remembered per device; each tab's document lives in its own localStorage slot
 * so it opens instantly, and the cloud copy (when signed in) is the source of truth.
 */
import { create } from 'zustand';
import type { DiagramKind } from '../domain/document';
import { fromFile } from '../domain/document';
import type { SeqUses } from '../domain/seq';
import { api, ApiError } from '../lib/api';
import { storage } from '../lib/browser';
import { diagram } from '../diagrams';
import { editor, freshMeta, replace, useEditor, type EditorState, type Meta, type OpenDoc } from './editor';
import * as history from './history';
import { cloud, putSlot, takeSlot, saveNow, saveAsNew, signedIn, adoptStored, setStatus, markSaved, useCloud, type CloudSlot } from './cloud';
import { readFile, readLocal } from './files';
import { fitView } from './commands';
import { hint } from './ui';

export interface Tab { key: string; kind: DiagramKind; title: string; cloudId?: string; version?: number; share?: string }
interface Session { open: OpenDoc; meta: Meta; view: EditorState['view']; selection: EditorState['selection']; hist: history.Stacks; cloud: CloudSlot }

const LIST_KEY = 'cistem.tabs';
const LEGACY_KEYS = ['cistem.doc', 'loadmap.doc'];
export const slot = (key: string) => 'cistem.doc.' + key;
const newKey = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

export const useTabs = create(() => ({ list: [] as Tab[], active: '' }));
export const tabs = () => useTabs.getState();
export const activeTab = () => tabs().list.find(t => t.key === tabs().active);
/** Tabs that are open but not on screen. */
const sessions = new Map<string, Session>();
let firstVisit = false;
export const isFirstVisit = () => firstVisit;

/** Update the tab list (and remember it on this device). */
function setTabs(list: Tab[], active = tabs().active) {
  useTabs.setState({ list, active });
  storage.set(LIST_KEY, JSON.stringify({ tabs: list, active }));
}
const updateTab = (key: string, patch: Partial<Tab>) => setTabs(tabs().list.map(t => (t.key === key ? { ...t, ...patch } : t)));
function insertTab(t: Tab, atEnd = false) {
  const list = [...tabs().list], at = list.findIndex(x => x.key === tabs().active);
  list.splice(atEnd || at < 0 ? list.length : at + 1, 0, t);
  setTabs(list, t.key);
}

// ---------- the open tab ----------

/** Wait for (or force) the open tab's pending save, so switching never drops edits. */
async function flush() {
  const c = cloud();
  if (signedIn() && c.id && !c.readonly && (c.status === 'dirty' || c.status === 'saving')) await saveNow();
}
/** Park the open tab's live state. */
function stash() {
  const t = activeTab(); if (!t) return;
  const s = editor();
  sessions.set(t.key, { open: s.open, meta: s.meta, view: s.view, selection: s.selection, hist: history.takeStacks(), cloud: takeSlot() });
}
function blank(kind: DiagramKind, title?: string): { open: OpenDoc; meta: Meta } {
  const m = diagram(kind);
  return { open: { kind, doc: m.blank() } as OpenDoc, meta: freshMeta(title ?? m.untitled) };
}
function show(open: OpenDoc, meta: Meta) {
  replace(open, meta);
  requestAnimationFrame(() => fitView(false));
}

export async function activate(key: string) {
  if (key === tabs().active) return;
  const t = tabs().list.find(x => x.key === key); if (!t) return;
  await flush(); stash();
  setTabs(tabs().list, key);
  const s = sessions.get(key);
  if (s) {
    sessions.delete(key);
    replace(s.open, s.meta, { view: s.view, selection: s.selection });
    history.putStacks(s.hist); putSlot(s.cloud);
    return;
  }
  await load(t);
}

/** First open of a tab in this page: the local copy right away, then the cloud copy if it's newer. */
async function load(t: Tab, refresh = true) {
  history.reset();
  const local = readLocal(slot(t.key));
  const { open, meta } = local ?? blank(t.kind, t.title === '…' ? undefined : t.title);
  show(open, meta);
  putSlot(t.cloudId ? { id: t.cloudId, version: t.version ?? 0, status: 'saved', readonly: false, lastSaved: '' } : null);
  if (t.cloudId) markSaved();
  if (t.share) { useCloud.setState({ readonly: true }); setStatus('readonly'); }
  if (!refresh || (!signedIn() && !t.share)) return;
  try {
    if (t.share) { const s = await api.shared(t.share); if (tabs().active === t.key) adoptStored(s, true); return; }
    if (!t.cloudId) return;
    const s = await api.get(t.cloudId);
    if (tabs().active !== t.key) return;
    const mine = local && s.version === t.version ? local : null;
    try { adoptStored(s); }
    catch (e) {
      // a document this app can't read (newer version, broken file): never autosave over it
      useCloud.setState({ readonly: true }); history.reset();
      setStatus('readonly', `Can't open this diagram here (${(e as Error).message}) — it hasn't been changed`);
      return;
    }
    const kind = editor().open.kind;
    if (t.kind !== kind) updateTab(t.key, { kind });
    // same version as the copy we kept, but edited since: keep the edits and let autosave send them
    if (mine && mine.open.kind === kind) replace(mine.open, mine.meta);
  } catch (e) {
    if (tabs().active !== t.key) return;
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
      // deleted, or not ours: keep what we have as a local diagram
      updateTab(t.key, { cloudId: undefined, version: undefined }); putSlot(null);
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
  const { open, meta } = file !== undefined ? readFile(file) : blank(kind);
  const t: Tab = { key: newKey(), kind: open.kind, title: meta.title };
  insertTab(t);
  history.reset(); putSlot(null);
  show(open, meta);
  if (save && signedIn()) await saveAsNew();
  return t;
}

/** Open a saved diagram: switch to its tab, or open it in a new one. `refresh` reloads the open tab. */
export async function openCloudTab(id: string, refresh = false) {
  const have = tabs().list.find(t => t.cloudId === id);
  if (have) {
    if (have.key !== tabs().active) await activate(have.key);
    else if (refresh) await load(have);
    return;
  }
  await flush(); stash();
  const t: Tab = { key: newKey(), kind: 'system', title: '…', cloudId: id };
  insertTab(t);
  await load(t);
}
export async function openSharedTab(token: string) {
  const have = tabs().list.find(t => t.share === token);
  if (have) { if (have.key !== tabs().active) await activate(have.key); else await load(have); return; }
  await flush(); stash();
  const t: Tab = { key: newKey(), kind: 'system', title: 'Shared diagram', share: token };
  insertTab(t, true);
  await load(t);
}

/** Close a tab (the diagram itself stays in the account). The last tab closing leaves a blank one. */
export async function closeTab(key: string) {
  const list = tabs().list, i = list.findIndex(t => t.key === key); if (i < 0) return;
  const wasActive = key === tabs().active;
  if (wasActive) await flush();
  sessions.delete(key);
  storage.remove(slot(key));
  const rest = list.filter(t => t.key !== key);
  if (!wasActive) { setTabs(rest); return; }
  setTabs(rest, '');
  if (!rest.length) { await newTab('system', undefined, false); return; }
  await activate(rest[Math.min(i, rest.length - 1)].key);
}
export async function closeCloudTabs(id: string) {
  for (const t of tabs().list.filter(x => x.cloudId === id)) await closeTab(t.key);
}
export function moveTab(key: string, to: number) {
  const list = [...tabs().list], i = list.findIndex(t => t.key === key); if (i < 0) return;
  const [t] = list.splice(i, 1);
  list.splice(Math.max(0, Math.min(to, list.length)), 0, t);
  setTabs(list);
}

// ---------- following the open document ----------

/** The open tab's title, kind and cloud link follow its document. */
function follow() {
  useEditor.subscribe((s, prev) => {
    const t = activeTab(); if (!t) return;
    if (s.meta.title !== prev.meta.title && t.title !== s.meta.title) updateTab(t.key, { title: s.meta.title });
    if (s.open.kind !== t.kind) updateTab(t.key, { kind: s.open.kind });
  });
  useCloud.subscribe(c => {
    const t = activeTab(); if (!t || t.share || !c.id) return;
    if (t.cloudId !== c.id || t.version !== c.version) updateTab(t.key, { cloudId: c.id, version: c.version });
  });
}

/**
 * Another window of the app shares this storage: tabs it opens appear here too (never dropped), and when it
 * changes the diagram open here, this window shows that version rather than overwriting it on the next edit.
 */
function watchOtherWindows() {
  window.addEventListener('storage', ev => {
    if (ev.key === LIST_KEY && ev.newValue) {
      try {
        const theirs = (JSON.parse(ev.newValue) as { tabs?: Tab[] }).tabs ?? [];
        const mine = tabs().list;
        // titles/links of tabs the other window is working on follow along (ours stays ours)
        const merged = mine.map(m => {
          const t = theirs.find(x => x?.key === m.key);
          return t && m.key !== tabs().active && (m.title !== t.title || m.cloudId !== t.cloudId) ? { ...m, title: t.title, cloudId: t.cloudId, version: t.version, kind: t.kind } : m;
        });
        const added = theirs.filter(t => t?.key && !mine.some(x => x.key === t.key));
        if (added.length || merged.some((m, i) => m !== mine[i])) setTabs([...merged, ...added]);
      } catch { /* ignore */ }
      return;
    }
    if (ev.key && ev.key === slot(tabs().active) && ev.newValue) {
      const l = readLocal(ev.key); if (!l) return;
      replace(l.open, l.meta, { selection: editor().selection });
      hint('Updated from another window', 1800);
    }
  });
}

/** Restore this device's tabs (instantly, from local copies). `fallback` fills a first visit. */
export async function bootTabs(fallback: () => unknown) {
  follow();
  watchOtherWindows();
  const saved = storage.getJson<{ tabs?: Tab[]; active?: string }>(LIST_KEY);
  let list = Array.isArray(saved?.tabs) ? saved!.tabs.filter(t => t && t.key) : [];
  let active = saved?.active ?? '';
  if (!list.length) {
    // before tabs there was a single local document; it becomes the first tab
    const t: Tab = { key: newKey(), kind: 'system', title: 'Untitled system' };
    const legacy = LEGACY_KEYS.map(k => storage.get(k)).find(Boolean) ?? null;
    const doc = legacy && readLegacy(legacy);
    if (!doc) firstVisit = true;
    storage.set(slot(t.key), doc || JSON.stringify(fallback()));
    LEGACY_KEYS.forEach(storage.remove);
    const r = readLocal(slot(t.key)); if (r) { t.title = r.meta.title; t.kind = r.open.kind; }
    list = [t]; active = t.key;
  }
  if (!list.some(t => t.key === active)) active = list[0].key;
  setTabs(list, active);
  await load(activeTab()!, false);
}
function readLegacy(s: string): string | null {
  try { return fromFile(JSON.parse(s)).doc.nodes.length ? s : null; } catch { return null; }
}

// ---------- looking at other tabs ----------

/** A tab's document without opening it: the live one, a parked one, or its local copy. */
export function peek(key: string): { open: OpenDoc; title: string } | null {
  if (key === tabs().active) { const s = editor(); return { open: s.open, title: s.meta.title }; }
  const s = sessions.get(key); if (s) return { open: s.open, title: s.meta.title };
  const l = readLocal(slot(key));
  return l && { open: l.open, title: l.meta.title };
}
/** How a sequence refers to a system diagram tab: by cloud id once saved (stable across devices), else by tab. */
export function usesFor(key: string): SeqUses | null {
  const t = tabs().list.find(x => x.key === key); if (!t || t.kind !== 'system') return null;
  return { ...(t.cloudId ? { id: t.cloudId } : { tab: t.key }), title: t.title };
}
/** The open tab a sequence's `uses` points at, if it's open on this device. */
export function tabFor(uses: SeqUses | undefined): Tab | undefined {
  if (!uses) return undefined;
  return tabs().list.find(t => t.kind === 'system' && ((uses.id && t.cloudId === uses.id) || (uses.tab && t.key === uses.tab)));
}
export const systemTabs = () => tabs().list.filter(t => t.kind === 'system');
