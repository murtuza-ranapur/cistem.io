/**
 * The open project's tabs. One project is open at a time; each tab is one of its diagrams, with its own undo
 * history, view, selection and account link. Each project remembers its tabs on this device.
 *
 * A diagram's document is kept in this browser (./local) so it opens instantly: for a browser project that
 * copy is the diagram; for an account project it's a cache and the account copy is the source of truth.
 * A shared link opens as a read-only "view" project whose documents are never stored.
 */
import { create } from 'zustand';
import type { DiagramKind } from '../domain/document';
import type { SeqUses } from '../domain/seq';
import type { AnyFile } from '../diagrams/types';
import { api, ApiError } from '../lib/api';
import { diagram } from '../diagrams';
import { editor, freshMeta, replace, useEditor, type EditorState, type Meta, type OpenDoc } from './editor';
import * as history from './history';
import * as local from './local';
import { cloud, putSlot, takeSlot, saveNow, signedIn, adoptStored, setStatus, markSaved, useCloud, lockAddress, type CloudSlot } from './cloud';
import { readFile, signature, stable } from './files';
import { backendFor, type Added, type DiagramInfo } from './backends';
import { fitWhenDrawn } from './commands';
import { hint, toast } from './ui';

export interface Tab { key: string; kind: DiagramKind; title: string; cloudId?: string; version?: number; readonly?: boolean }
export type Scope = 'local' | 'cloud' | 'view';
/** The open project: in this browser, in the account, or a shared link being viewed. */
export interface OpenProject { scope: Scope; id: string; title: string }
interface Session { open: OpenDoc; meta: Meta; view: EditorState['view']; selection: EditorState['selection']; hist: history.Stacks; cloud: CloudSlot }
interface SavedTabs { tabs: Tab[]; active: string }

export const useTabs = create(() => ({ list: [] as Tab[], active: '', project: null as OpenProject | null }));
export const tabs = () => useTabs.getState();
export const activeTab = () => tabs().list.find(t => t.key === tabs().active);
export const openProject = () => tabs().project;
/** Tabs that are open but not on screen. */
const sessions = new Map<string, Session>();
/** What a shared link shows (never stored). */
const viewDocs = new Map<string, AnyFile>();

/** Update the tab list (and remember it for this project on this device). */
function setTabs(list: Tab[], active = tabs().active) {
  useTabs.setState({ list, active });
  const p = tabs().project;
  if (p && p.scope !== 'view') local.setState('tabs:' + p.id, { tabs: list, active } satisfies SavedTabs);
}
const updateTab = (key: string, patch: Partial<Tab>) => setTabs(tabs().list.map(t => (t.key === key ? { ...t, ...patch } : t)));
function insertTab(t: Tab) {
  const list = [...tabs().list], at = list.findIndex(x => x.key === tabs().active);
  list.splice(at < 0 ? list.length : at + 1, 0, t);
  setTabs(list, t.key);
}
/** A project's diagram as a tab. */
export const tabOf = (d: DiagramInfo, scope: Scope): Tab =>
  ({ key: d.id, kind: d.kind, title: d.title, ...(scope === 'cloud' ? { cloudId: d.id } : {}), ...(scope === 'view' ? { readonly: true } : {}) });

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
/** The document kept for a tab (shared view, or this browser's copy), read; null when missing or unreadable. */
function kept(key: string) {
  const f = viewDocs.get(key) ?? local.doc(key)?.file;
  if (!f) return null;
  try { return readFile(f); } catch { return null; }
}
function show(open: OpenDoc, meta: Meta) {
  replace(open, meta);
  fitWhenDrawn();
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

/** First open of a tab in this page: the kept copy right away, then (signed in) the account copy if it's newer. */
async function load(t: Tab, refresh = true) {
  history.reset();
  const mine = kept(t.key);
  const keptVersion = local.doc(t.key)?.version ?? t.version;
  // a browser diagram with no readable copy: gone (deleted in another window) or from a newer app — never overwrite it
  if (!mine && !t.cloudId && !t.readonly) {
    if (!local.doc(t.key)) { await closeTab(t.key, true); return; }
    putSlot({ id: null, version: 0, status: 'readonly', readonly: true, lastSaved: '' });
    show(blank(t.kind).open, freshMeta(t.title));
    setStatus('readonly', 'This diagram can\'t be opened here (made by a newer version?) — it hasn\'t been changed');
    return;
  }
  // the account link first, so writes of what's shown below are filed under this tab's version
  putSlot(t.cloudId ? { id: t.cloudId, version: keptVersion ?? 0, status: 'saved', readonly: false, lastSaved: '' } : null);
  const { open, meta } = mine ?? blank(t.kind, t.title === '…' ? undefined : t.title);
  show(open, meta);
  if (t.readonly) { useCloud.setState({ readonly: true }); setStatus('readonly'); return; }
  if (!t.cloudId) return;
  markSaved();
  if (!refresh || !signedIn()) return;
  try {
    const s = await api.get(t.cloudId);
    if (tabs().active !== t.key) return;
    const unsent = mine && s.version === keptVersion ? mine : null;
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
    if (unsent && unsent.open.kind === kind) replace(unsent.open, unsent.meta);
  } catch (e) {
    if (tabs().active !== t.key) return;
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
      toast('That diagram is no longer in your account', 4000);
      await closeTab(t.key, true);
    } else setStatus('error', (e as Error).message);
  }
}

/** Open a diagram of the open project: switch to its tab, or open it in a new one. */
export async function openTab(t: Tab, refresh = false) {
  const have = tabs().list.find(x => x.key === t.key);
  if (have) {
    if (have.key !== tabs().active) await activate(have.key);
    else if (refresh) await load(have);
    return;
  }
  await flush(); stash();
  insertTab(t);
  await load(t);
}

/** Show a diagram that was just added to the open project. */
async function openAdded(a: Added, kind: DiagramKind, title: string) {
  await flush(); stash();
  const t: Tab = { key: a.key, kind, title, ...(a.cloudId ? { cloudId: a.cloudId, version: a.version } : {}) };
  insertTab(t);
  await load(t, false);
  return t;
}

/**
 * Add a diagram to the open project and open it: `file` (an example, an import, a copy), or a blank one of
 * `kind`. Returns its tab, or null when it couldn't be made (a shared view, or the account refused).
 */
export async function newTab(kind: DiagramKind = 'system', file?: unknown): Promise<Tab | null> {
  const p = tabs().project;
  if (!p || p.scope === 'view') { toast('This is a shared project — make a copy to change it', 3500); return null; }
  const { open, meta } = file !== undefined ? readFile(file) : blank(kind);
  try {
    const added = await backendFor(p.scope).addDiagram(p.id, diagram(open.kind).toFile(open.doc as never, meta));
    return await openAdded(added, open.kind, meta.title);
  } catch (e) { toast((e as Error).message, 4000); return null; }
}

/**
 * Close a tab (the diagram stays in its project). The last tab stays open unless `force` (its diagram was
 * deleted or moved away); then another of the project's diagrams opens, or a new blank one.
 */
export async function closeTab(key: string, force = false) {
  const list = tabs().list, i = list.findIndex(t => t.key === key); if (i < 0) return;
  if (list.length === 1 && !force) return;
  const wasActive = key === tabs().active;
  if (wasActive && !force) await flush();
  sessions.delete(key);
  const rest = list.filter(t => t.key !== key);
  if (!wasActive) { setTabs(rest); return; }
  setTabs(rest, '');
  if (!rest.length) { await fillEmpty(key); return; }
  await activate(rest[Math.min(i, rest.length - 1)].key);
}
export const canClose = () => tabs().list.length > 1;

/** A project with no tabs left opens its most recent other diagram, or a new blank one. */
async function fillEmpty(except: string) {
  const p = tabs().project; if (!p || p.scope === 'view') return;
  const info = (await backendFor(p.scope).list().catch(() => [])).find(x => x.id === p.id);
  const d = info?.diagrams.find(x => x.id !== except);
  if (d) await openTab(tabOf(d, p.scope)); else await newTab('system');
}

export function moveTab(key: string, to: number) {
  const list = [...tabs().list], i = list.findIndex(t => t.key === key); if (i < 0) return;
  const [t] = list.splice(i, 1);
  list.splice(Math.max(0, Math.min(to, list.length)), 0, t);
  setTabs(list);
}

// ---------- switching project ----------

/**
 * Open a project (closing the current one's tabs; they're remembered). Its tabs from last time come back;
 * the first time, its most recent diagrams open. `focus` opens that diagram too. `refresh` checks the account
 * copy of the tab that comes to the front.
 */
export async function switchProject(p: OpenProject, diagrams: DiagramInfo[], focus?: string, refresh = true) {
  await flush();
  sessions.clear();
  lockAddress(p.scope === 'view');
  useTabs.setState({ project: p, list: [], active: '' });
  if (p.scope !== 'view') { local.setState('open:' + p.scope, { id: p.id, title: p.title }); local.setState('scope', p.scope); }
  const saved = p.scope === 'view' ? undefined : local.getState<SavedTabs>('tabs:' + p.id);
  const byId = new Map(diagrams.map(d => [d.id, d]));
  let list: Tab[] = (saved?.tabs ?? []).filter(t => byId.has(t.key)).map(t => ({ ...t, ...tabOf(byId.get(t.key)!, p.scope), version: t.version }));
  if (!list.length) list = diagrams.slice(0, 6).map(d => tabOf(d, p.scope));
  if (focus && !list.some(t => t.key === focus) && byId.has(focus)) list = [...list, tabOf(byId.get(focus)!, p.scope)];
  let active = focus ?? saved?.active ?? '';
  if (!list.some(t => t.key === active)) active = list[0]?.key ?? '';
  setTabs(list, active);
  if (!list.length && p.scope === 'view') {
    putSlot({ id: null, version: 0, status: 'readonly', readonly: true, lastSaved: '' });
    show(blank('system').open, freshMeta('Nothing shared yet'));
    return;
  }
  if (!list.length) { await newTab('system'); return; }
  await load(activeTab()!, refresh);
}

/** Show the project this device had open last, from what's kept here, before the account has answered. */
export async function restoreProject(p: OpenProject): Promise<boolean> {
  const saved = local.getState<SavedTabs>('tabs:' + p.id);
  if (!saved?.tabs?.length) return false;
  useTabs.setState({ project: p });
  setTabs(saved.tabs, saved.tabs.some(t => t.key === saved.active) ? saved.active : saved.tabs[0].key);
  await load(activeTab()!, false);
  return true;
}

/** A shared link's diagrams, as a read-only project. */
export async function showView(title: string, files: { id: string; title: string; kind: DiagramKind; updatedAt: string; file: AnyFile }[]) {
  viewDocs.clear();
  files.forEach(f => viewDocs.set(f.id, f.file));
  await switchProject({ scope: 'view', id: 'view', title }, files, undefined, false);
}
/** The shared link's documents, for making a copy. */
export const viewFiles = () => [...viewDocs.entries()];

export function renameOpenProject(id: string, title: string) {
  const p = tabs().project;
  if (p?.id === id) { useTabs.setState({ project: { ...p, title } }); local.setState('open:' + p.scope, { id, title }); }
}

// ---------- following the open document ----------

/** The open tab's title, kind and account version follow its document. */
function follow() {
  useEditor.subscribe((s, prev) => {
    const t = activeTab(); if (!t) return;
    if (s.meta.title !== prev.meta.title && t.title !== s.meta.title) updateTab(t.key, { title: s.meta.title });
    if (s.open.kind !== t.kind) updateTab(t.key, { kind: s.open.kind });
  });
  useCloud.subscribe(c => {
    const t = activeTab(); if (!t || !t.cloudId || c.id !== t.cloudId) return;
    if (t.version !== c.version) updateTab(t.key, { version: c.version });
  });
}

/**
 * Other windows of the app share this browser's storage: tabs they open in the same project appear here too,
 * and when one changes the diagram open here, this window shows that version rather than overwriting it.
 */
function watchOtherWindows() {
  local.onRemote(m => {
    const p = tabs().project; if (!p || p.scope === 'view') return;
    if (m.type === 'state' && m.key === 'tabs:' + p.id) {
      const theirs = local.getState<SavedTabs>(m.key)?.tabs ?? [];
      const mine = tabs().list;
      const merged = mine.map(t => {
        const o = theirs.find(x => x.key === t.key);
        return o && t.key !== tabs().active && o.title !== t.title ? { ...t, title: o.title, kind: o.kind } : t;
      });
      const added = theirs.filter(t => t?.key && !mine.some(x => x.key === t.key));
      if (added.length || merged.some((t, i) => t !== mine[i])) useTabs.setState({ list: [...merged, ...added] });
      return;
    }
    if (m.type !== 'doc' || !tabs().list.some(t => t.key === m.key)) return;
    // deleted, or moved to another project, in another window: it closes here
    const d = local.doc(m.key);
    if (p.scope === 'local' && (!d || d.project !== p.id)) { void closeTab(m.key, true); return; }
    // a parked tab reopens from the newer copy rather than putting back its old one
    if (m.key !== tabs().active) { sessions.delete(m.key); return; }
    {
      const l = kept(m.key); if (!l) return;
      const theirs = diagram(l.open.kind).toFile(l.open.doc as never, l.meta);
      if (stable({ ...theirs, meta: { ...theirs.meta, updated: '' } }) === signature()) return;
      replace(l.open, l.meta, { selection: editor().selection });
      hint('Updated from another window', 1800);
    }
  });
}

let started = false;
export function startTabs() {
  if (started) return;
  started = true;
  follow();
  watchOtherWindows();
}

// ---------- looking at other tabs ----------

/** A tab's document without opening it: the live one, a parked one, or the kept copy. */
export function peek(key: string): { open: OpenDoc; title: string } | null {
  if (key === tabs().active) { const s = editor(); return { open: s.open, title: s.meta.title }; }
  const s = sessions.get(key); if (s) return { open: s.open, title: s.meta.title };
  const l = kept(key);
  return l && { open: l.open, title: l.meta.title };
}
/** How a sequence refers to a system diagram tab: by account id when it has one (stable across devices), else by key. */
export function usesFor(key: string): SeqUses | null {
  const t = tabs().list.find(x => x.key === key); if (!t || t.kind !== 'system') return null;
  return { ...(t.cloudId ? { id: t.cloudId } : { tab: t.key }), title: t.title };
}
/** The open tab a sequence's `uses` points at, if it's open. */
export function tabFor(uses: SeqUses | undefined): Tab | undefined {
  if (!uses) return undefined;
  return tabs().list.find(t => t.kind === 'system' && ((uses.id && (t.cloudId === uses.id || t.key === uses.id)) || (uses.tab && t.key === uses.tab)));
}
export const systemTabs = () => tabs().list.filter(t => t.kind === 'system');
