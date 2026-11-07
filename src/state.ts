import { exampleDoc, adopt, type Doc, type Node, type Edge, type Container } from './model';
import { toFile, seqToFile, clsToFile, readAny, type DiagramFile, type DiagramKind, type Loaded } from './document';
import { blankSeq, type SeqDoc } from './seq';
import { blankCls, type ClassDoc } from './cls';
import { compute, type Results } from './engine';
import * as history from './history';

/** System: node / edge / container. Sequence: a row (message, note, block) or a participant (lifeline). */
export type Selection = { type: 'node' | 'edge' | 'container' | 'row' | 'part' | 'class' | 'rel'; id: string } | null;

export const state = {
  /** what the open tab is; `doc` is the system diagram, `seq` the sequence (the other one sits empty) */
  kind: 'system' as DiagramKind,
  doc: {} as Doc,
  seq: blankSeq() as SeqDoc,
  cls: blankCls() as ClassDoc,
  view: { x: 0, y: 0, k: 1 },
  sel: null as Selection,
  /** extra node ids selected alongside `sel` (multi-select) */
  multi: new Set<string>(),
  results: {} as Results,
  meta: { title: 'Untitled system', created: new Date().toISOString(), updated: new Date().toISOString() } as DiagramFile['meta'],
};

/** Compact number: 950, 1.2k, 12k, 3.4M, 5.0G, 2.0T; beyond that, scientific. */
export const fmt = (v: number) => {
  if (v === Infinity) return '∞';
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v), sign = v < 0 ? '−' : '';
  const u = (d: number, s: string) => sign + (a / d).toFixed(a / d >= 10 ? 0 : 1) + s;
  return a >= 1e15 ? sign + a.toExponential(1) : a >= 1e12 ? u(1e12, 'T') : a >= 1e9 ? u(1e9, 'G') : a >= 1e6 ? u(1e6, 'M') : a >= 1000 ? u(1000, 'k') : sign + Math.round(a).toString();
};
/** 4.2ms, 31ms, 420ms, 2.5s, 3.1min, then hours; anything not finite shows as a dash. */
export const fmtMs = (ms: number) => !Number.isFinite(ms) ? '—' : ms >= 3.6e6 ? (ms / 3.6e6 >= 1e4 ? (ms / 3.6e6).toExponential(1) : fmt(ms / 3.6e6)) + 'h' : ms >= 60000 ? (ms / 60000).toFixed(1) + 'min' : ms >= 10000 ? (ms / 1000).toFixed(0) + 's' : ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms >= 100 ? Math.round(ms) + 'ms' : ms >= 10 ? ms.toFixed(0) + 'ms' : ms.toFixed(1) + 'ms';
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export function current(): Node | Edge | Container | null {
  const s = state.sel;
  if (!s) return null;
  if (s.type === 'node') return state.doc.nodes.find(x => x.id === s.id) ?? null;
  if (s.type === 'edge') return state.doc.edges.find(x => x.id === s.id) ?? null;
  return state.doc.containers.find(x => x.id === s.id) ?? null;
}
export function selectedNodeIds(): string[] {
  const ids = new Set(state.multi);
  if (state.sel?.type === 'node') ids.add(state.sel.id);
  return [...ids].filter(id => state.doc.nodes.some(n => n.id === id));
}
export function select(sel: Selection, additive = false) {
  if (!additive) state.multi.clear();
  else if (state.sel?.type === 'node') state.multi.add(state.sel.id);
  state.sel = sel;
}

export function recompute() { state.results = compute(state.doc); }

/** The document being edited, whichever kind it is. */
export const live = (): Doc | SeqDoc | ClassDoc => (state.kind === 'sequence' ? state.seq : state.kind === 'class' ? state.cls : state.doc);
export const emptySystem = (): Doc => adopt({ nodes: [], edges: [], containers: [], links: [], frames: {}, detail: {} });
/** Record an undo point, then mutate. */
export function mutate(fn: () => void) { history.snapshot(live()); fn(); }
function restoreStep(r: history.Restored | null) {
  if (!r) return;
  if (state.kind === 'sequence') state.seq = r.doc as SeqDoc; else if (state.kind === 'class') state.cls = r.doc as ClassDoc; else state.doc = r.doc as Doc;
  if (r.meta) state.meta = r.meta; state.sel = null; state.multi.clear(); renderAll();
}
export function undo() { restoreStep(history.undo(live(), state.meta)); }
export function redo() { restoreStep(history.redo(live(), state.meta)); }

/** Each open tab keeps its document in its own localStorage slot; this is the active tab's. */
let docKey = '';
export function setDocKey(k: string) { docKey = k; }
/** The open document as a file, whichever kind it is. */
export function currentFile() { return state.kind === 'sequence' ? seqToFile(state.seq, state.meta) : state.kind === 'class' ? clsToFile(state.cls, state.meta) : toFile(state.doc, state.meta); }
export function serialize(): string { return JSON.stringify(currentFile(), null, 2); }
let lastPersisted = { key: '', body: '' };
/** Write the open document to its slot — only when it changed (another window listens to these writes). */
export function persist() {
  if (!docKey) return;
  const f = currentFile(), updated = f.meta.updated; f.meta.updated = '';
  const body = JSON.stringify(f);
  if (lastPersisted.key === docKey && lastPersisted.body === body) return;
  f.meta.updated = updated;
  try { localStorage.setItem(docKey, JSON.stringify(f)); lastPersisted = { key: docKey, body }; }
  catch (e) { if ((e as Error)?.name === 'QuotaExceededError') storageFull?.(); }
}
let storageFull: (() => void) | null = null;
/** Called when this browser's storage is full and the diagram couldn't be kept locally. */
export function onStorageFull(fn: () => void) { storageFull = fn; }
/** Read a stored document (any kind or version); null when absent or unreadable. */
export function readLocal(key: string): Loaded | null {
  try { const s = localStorage.getItem(key); if (s) return readAny(JSON.parse(s)); } catch { /* ignore */ }
  return null;
}
/** Make a loaded document the open one. */
export function adoptLoaded(l: Loaded) {
  state.kind = l.kind; state.meta = l.meta; state.sel = null; state.multi.clear();
  state.seq = l.kind === 'sequence' ? l.seq : blankSeq();
  state.cls = l.kind === 'class' ? l.cls : blankCls();
  state.doc = l.kind === 'system' ? l.doc : emptySystem();
}
export function replaceDoc(d: Doc, meta?: DiagramFile['meta']) {
  history.snapshot(live(), state.meta); state.kind = 'system'; state.doc = d; state.sel = null; state.multi.clear();
  const now = new Date().toISOString();
  state.meta = meta ?? { title: 'Untitled system', created: now, updated: now };
}
/** Load any supported file (kind and version, migrating as needed). */
export function loadFile(input: unknown) { adoptLoaded(readAny(input)); }
export function loadExample() { replaceDoc(exampleDoc(), { title: 'Checkout example', created: new Date().toISOString(), updated: new Date().toISOString() }); }

type Listener = () => void;
const listeners: Record<'canvas' | 'sheet', Listener[]> = { canvas: [], sheet: [] };
export function on(evt: 'canvas' | 'sheet', fn: Listener) { listeners[evt].push(fn); }
const afterRender: Listener[] = [];
export function onAfterRender(fn: Listener) { afterRender.push(fn); }
export function renderCanvas() { recompute(); listeners.canvas.forEach(f => f()); persist(); afterRender.forEach(f => f()); }
export function renderAll() { renderCanvas(); listeners.sheet.forEach(f => f()); }
/** Something outside the drawing changed (the title): keep it and sync it, without redrawing the canvas. */
export function renderMeta() { persist(); afterRender.forEach(f => f()); }
