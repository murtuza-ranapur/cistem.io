import { exampleDoc, type Doc, type Node, type Edge } from './model';
import { toFile, fromFile, type DiagramFile } from './document';
import { compute, type Results } from './engine';
import * as history from './history';

export type Selection = { type: 'node' | 'edge'; id: string } | null;

export const state = {
  doc: {} as Doc,
  view: { x: 0, y: 0, k: 1 },
  sel: null as Selection,
  /** extra node ids selected alongside `sel` (multi-select) */
  multi: new Set<string>(),
  results: {} as Results,
  meta: { title: 'Untitled system', created: new Date().toISOString(), updated: new Date().toISOString() } as DiagramFile['meta'],
};

export const fmt = (v: number) =>
  v === Infinity ? '∞' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : Math.round(v).toString();
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export function current(): Node | Edge | null {
  const s = state.sel;
  if (!s) return null;
  return s.type === 'node' ? state.doc.nodes.find(x => x.id === s.id) ?? null : state.doc.edges.find(x => x.id === s.id) ?? null;
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

/** Record an undo point, then mutate. */
export function mutate(fn: () => void) { history.snapshot(state.doc); fn(); }
export function undo() { const d = history.undo(state.doc); if (d) { state.doc = d; state.sel = null; state.multi.clear(); renderAll(); } }
export function redo() { const d = history.redo(state.doc); if (d) { state.doc = d; state.sel = null; state.multi.clear(); renderAll(); } }

const KEY = 'cistem.doc';
const LEGACY_KEY = 'loadmap.doc';
export function serialize(): string { return JSON.stringify(toFile(state.doc, state.meta), null, 2); }
export function persist() { try { localStorage.setItem(KEY, JSON.stringify(toFile(state.doc, state.meta))); } catch { /* storage unavailable */ } }
export function restore(): boolean {
  try {
    const s = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (s) { const { doc, meta } = fromFile(JSON.parse(s)); if (doc.nodes.length) { state.doc = doc; state.meta = meta; return true; } }
  } catch { /* ignore */ }
  return false;
}
export function replaceDoc(d: Doc, meta?: DiagramFile['meta']) {
  history.snapshot(state.doc); state.doc = d; state.sel = null; state.multi.clear();
  const now = new Date().toISOString();
  state.meta = meta ?? { title: 'Untitled system', created: now, updated: now };
}
/** Load any supported file version (migrating as needed). */
export function loadFile(input: unknown) { const { doc, meta } = fromFile(input); replaceDoc(doc, meta); }
export function loadExample() { replaceDoc(exampleDoc(), { title: 'Checkout example', created: new Date().toISOString(), updated: new Date().toISOString() }); }

type Listener = () => void;
const listeners: Record<'canvas' | 'sheet', Listener[]> = { canvas: [], sheet: [] };
export function on(evt: 'canvas' | 'sheet', fn: Listener) { listeners[evt].push(fn); }
const afterRender: Listener[] = [];
export function onAfterRender(fn: Listener) { afterRender.push(fn); }
export function renderCanvas() { recompute(); listeners.canvas.forEach(f => f()); persist(); afterRender.forEach(f => f()); }
export function renderAll() { renderCanvas(); listeners.sheet.forEach(f => f()); }
