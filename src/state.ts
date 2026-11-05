import { adopt, exampleDoc, type Doc } from './model';
import { compute, type Results } from './engine';

export type Selection = { type: 'node' | 'edge'; id: string } | null;

export const state = {
  doc: {} as Doc,
  view: { x: 0, y: 0, k: 1 },
  sel: null as Selection,
  connectMode: false,
  connectFrom: null as string | null,
  results: {} as Results,
};

export const fmt = (v: number) =>
  v === Infinity ? '∞' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : Math.round(v).toString();

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export function current() {
  const s = state.sel;
  if (!s) return null;
  return s.type === 'node' ? state.doc.nodes.find(x => x.id === s.id) ?? null : state.doc.edges.find(x => x.id === s.id) ?? null;
}

export function recompute() { state.results = compute(state.doc); }

const KEY = 'loadmap.doc';
export function persist() { try { localStorage.setItem(KEY, JSON.stringify(state.doc)); } catch { /* storage unavailable */ } }
export function restore(): boolean {
  try {
    const s = localStorage.getItem(KEY);
    if (s) { const d = JSON.parse(s); if (d && Array.isArray(d.nodes) && d.nodes.length) { state.doc = adopt(d); return true; } }
  } catch { /* ignore */ }
  return false;
}
export function loadExample() { state.doc = exampleDoc(); state.sel = null; }

// Simple pub/sub so canvas and sheet re-render on changes without importing each other.
type Listener = () => void;
const listeners: Record<'canvas' | 'sheet', Listener[]> = { canvas: [], sheet: [] };
export function on(evt: 'canvas' | 'sheet', fn: Listener) { listeners[evt].push(fn); }
export function renderCanvas() { recompute(); listeners.canvas.forEach(f => f()); persist(); }
export function renderAll() { renderCanvas(); listeners.sheet.forEach(f => f()); }
