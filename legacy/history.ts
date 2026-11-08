import type { DiagramFile } from './document';
/** any JSON document (system or sequence) */
type Doc = object;

/**
 * Snapshot-based undo/redo. Documents are small, so whole-doc snapshots are fine.
 * A snapshot may also carry the diagram's meta (title…) — set when the whole document was swapped,
 * so undoing a swap restores the title too, not just the nodes.
 */
type Meta = DiagramFile['meta'];
interface Entry { d: string; m?: string }
const past: Entry[] = [];
const future: Entry[] = [];
const LIMIT = 100;
let listeners: (() => void)[] = [];

export const onHistoryChange = (fn: () => void) => listeners.push(fn);
const notify = () => listeners.forEach(f => f());

/** Call before mutating the doc. Coalesces identical consecutive snapshots. */
export function snapshot(doc: Doc, meta?: Meta) {
  const e: Entry = { d: JSON.stringify(doc) };
  if (meta) e.m = JSON.stringify(meta);
  const last = past[past.length - 1];
  if (last && last.d === e.d && last.m === e.m) return;
  past.push(e);
  if (past.length > LIMIT) past.shift();
  // an undo point taken without a change since the last undo/redo (focusing a field) keeps redo available;
  // redo itself checks that nothing changed before it applies
  if (restored === null || e.d !== restored) { future.length = 0; restored = null; }
  notify();
}
export interface Restored { doc: unknown; meta?: Meta }
/** The state the last undo/redo produced; redo only applies while the document is still exactly that. */
let restored: string | null = null;
function step(from: Entry[], to: Entry[], doc: Doc, meta: Meta): Restored | null {
  // undo points recorded on focus without any edit since equal the current state: skip them, so one press
  // always changes something
  const cur = JSON.stringify(doc), curM = JSON.stringify(meta);
  if (from === future && restored !== null && cur !== restored) { future.length = 0; restored = null; notify(); return null; }
  while (from.length && from[from.length - 1].d === cur && (!from[from.length - 1].m || from[from.length - 1].m === curM)) from.pop();
  const e = from.pop(); if (e === undefined) { notify(); return null; }
  to.push(e.m ? { d: cur, m: curM } : { d: cur }); restored = e.d; notify();
  return { doc: JSON.parse(e.d), meta: e.m ? JSON.parse(e.m) : undefined };
}
export const undo = (doc: Doc, meta: Meta) => step(past, future, doc, meta);
export const redo = (doc: Doc, meta: Meta) => step(future, past, doc, meta);
export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;
/** Hand over the undo stacks (switching tabs keeps each tab's history). */
export interface Stacks { past: Entry[]; future: Entry[] }
export function takeStacks(): Stacks { const s = { past: past.splice(0), future: future.splice(0) }; notify(); return s; }
export function putStacks(s: Stacks) { past.splice(0, past.length, ...s.past); future.splice(0, future.length, ...s.future); restored = null; notify(); }
export function reset() { past.length = 0; future.length = 0; restored = null; notify(); }
