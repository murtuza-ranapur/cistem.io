/**
 * This browser's storage: projects and diagrams made while signed out, a cache of account diagrams (so they
 * open instantly and keep edits that haven't reached the server), and small bits of state (which project is
 * open, its tabs). Kept in IndexedDB but read from memory: everything is loaded once at start, and writes go to
 * memory first, then to disk. Other windows of the app hear about every write and follow along.
 */
import type { AnyFile } from '../diagrams/types';
import { openStores, type KvStore } from '../lib/idb';
import { storage } from '../lib/browser';

/** A diagram kept here. `project` is the browser project it belongs to; null for a cached account diagram. */
export interface LocalDoc { project: string | null; file: AnyFile; cloudId?: string; version?: number }
export interface LocalProject { id: string; title: string; created: string; updated: string }

type Message =
  | { type: 'doc'; key: string; value: LocalDoc | null }
  | { type: 'project'; key: string; value: LocalProject | null }
  | { type: 'state'; key: string; value: unknown };
/** What another window changed (already applied here when listeners hear of it). */
export type Remote = Pick<Message, 'type' | 'key'>;

const docs = new Map<string, LocalDoc>();
const projects = new Map<string, LocalProject>();
const state = new Map<string, unknown>();
const maps = { doc: docs, project: projects, state } as Record<Message['type'], Map<string, unknown>>;
let disk: Record<'docs' | 'projects' | 'state', KvStore<unknown>> | null = null;
let persistent = false;

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('cistem') : null;
const listeners = new Set<(m: Remote) => void>();
let failed: (e: unknown) => void = () => {};

/** Called after another window changes something. */
export function onRemote(fn: (m: Remote) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
/** Called when the browser refuses a write (storage full, blocked). */
export function onWriteError(fn: (e: unknown) => void) { failed = fn; }
/** False when this browser keeps nothing between visits (IndexedDB unavailable). */
export const isPersistent = () => persistent;

channel?.addEventListener('message', ev => {
  const m = ev.data as Message;
  if (!m || !maps[m.type]) return;
  if (m.value == null) maps[m.type].delete(m.key); else maps[m.type].set(m.key, m.value);
  listeners.forEach(fn => fn({ type: m.type, key: m.key }));
});

const STORE = { doc: 'docs', project: 'projects', state: 'state' } as const;
/** Memory now, disk soon (the promise says when, and whether it worked), and tell the other windows. */
function write(type: Message['type'], key: string, value: unknown): Promise<boolean> {
  if (value == null) maps[type].delete(key); else maps[type].set(key, value);
  const store = disk?.[STORE[type]];
  channel?.postMessage({ type, key, value: value ?? null });
  if (!store) return Promise.resolve(false);
  return (value == null ? store.del(key) : store.put(key, value)).then(() => true, e => { failed(e); return false; });
}

// ---------- diagrams ----------
export const doc = (key: string) => docs.get(key);
export const putDoc = (key: string, d: LocalDoc) => write('doc', key, d);
export const dropDoc = (key: string) => write('doc', key, null);
/** The diagrams in a browser project, newest first. */
export const docsOf = (project: string) =>
  [...docs].filter(([, d]) => d.project === project).sort((a, b) => updated(b[1]).localeCompare(updated(a[1])));
const updated = (d: LocalDoc) => String((d.file as { meta?: { updated?: string } }).meta?.updated ?? '');

// ---------- projects ----------
/** Browser projects, most recently changed first. */
export const localProjects = () => [...projects.values()].sort((a, b) => b.updated.localeCompare(a.updated));
export const localProject = (id: string) => projects.get(id);
export const putProject = (p: LocalProject) => write('project', p.id, p);
/** Remove a browser project and every diagram in it. */
export function dropProject(id: string) {
  for (const [key] of docsOf(id)) dropDoc(key);
  write('project', id, null);
  write('state', 'tabs:' + id, null);
}
export const touchProject = (id: string) => { const p = projects.get(id); if (p) putProject({ ...p, updated: new Date().toISOString() }); };

// ---------- small state ----------
export const getState = <T>(key: string): T | undefined => state.get(key) as T | undefined;
export const setState = (key: string, value: unknown) => write('state', key, value ?? null);

export const freshKey = (prefix: string) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Load everything into memory (once, before anything reads), moving older localStorage data over. */
export async function bootLocal() {
  const opened = await openStores('cistem', ['docs', 'projects', 'state'] as const);
  disk = opened.stores; persistent = opened.persistent;
  const [d, p, s] = await Promise.all([disk.docs.all(), disk.projects.all(), disk.state.all()]);
  d.forEach(([k, v]) => docs.set(k, v as LocalDoc));
  p.forEach(([k, v]) => projects.set(k, v as LocalProject));
  s.forEach(([k, v]) => state.set(k, v));
  // only once the data is safely on disk does it leave localStorage (a browser without IndexedDB keeps it there)
  if (persistent && !getState('migrated') && await migrateLocalStorage()) await setState('migrated', 1);
}

/** Before projects, tabs lived in localStorage: they become the browser's "My diagrams" project. */
async function migrateLocalStorage(): Promise<boolean> {
  interface OldTab { key: string; kind?: string; title?: string; cloudId?: string; version?: number }
  const saved = storage.getJson<{ tabs?: OldTab[]; active?: string }>('cistem.tabs');
  const oldTabs = (Array.isArray(saved?.tabs) ? saved!.tabs : []).filter(t => t?.key);
  const found: { tab: OldTab; file: AnyFile }[] = [];
  for (const t of oldTabs) {
    const file = storage.getJson<AnyFile>('cistem.doc.' + t.key);
    if (file) found.push({ tab: t, file });
  }
  // older still: a single document
  for (const k of ['cistem.doc', 'loadmap.doc']) {
    const file = storage.getJson<AnyFile>(k);
    if (file && !found.length) found.push({ tab: { key: freshKey('l') }, file });
  }
  if (found.length) {
    const now = new Date().toISOString();
    const pid = freshKey('p');
    const writes = [putProject({ id: pid, title: 'My diagrams', created: now, updated: now })];
    const tabs: { key: string; kind: string; title: string }[] = [];
    for (const { tab, file } of found) {
      if (tab.cloudId) { writes.push(putDoc(tab.cloudId, { project: null, file, cloudId: tab.cloudId, version: tab.version })); continue; }
      writes.push(putDoc(tab.key, { project: pid, file }));
      tabs.push({ key: tab.key, kind: String((file as { kind?: string }).kind ?? 'system'), title: String(file.meta?.title ?? 'Untitled') });
    }
    if (tabs.length) writes.push(setState('tabs:' + pid, { tabs, active: tabs.some(t => t.key === saved?.active) ? saved!.active : tabs[0].key }));
    writes.push(setState('open:local', pid));
    if (!(await Promise.all(writes)).every(Boolean)) return false;
  }
  for (const t of oldTabs) storage.remove('cistem.doc.' + t.key);
  ['cistem.tabs', 'cistem.doc', 'loadmap.doc'].forEach(k => storage.remove(k));
  return true;
}
