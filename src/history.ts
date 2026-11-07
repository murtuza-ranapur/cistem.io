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
  future.length = 0;
  notify();
}
export interface Restored { doc: unknown; meta?: Meta }
function step(from: Entry[], to: Entry[], doc: Doc, meta: Meta): Restored | null {
  const e = from.pop(); if (e === undefined) return null;
  to.push(e.m ? { d: JSON.stringify(doc), m: JSON.stringify(meta) } : { d: JSON.stringify(doc) }); notify();
  return { doc: JSON.parse(e.d), meta: e.m ? JSON.parse(e.m) : undefined };
}
export const undo = (doc: Doc, meta: Meta) => step(past, future, doc, meta);
export const redo = (doc: Doc, meta: Meta) => step(future, past, doc, meta);
export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;
/** Hand over the undo stacks (switching tabs keeps each tab's history). */
export interface Stacks { past: Entry[]; future: Entry[] }
export function takeStacks(): Stacks { const s = { past: past.splice(0), future: future.splice(0) }; notify(); return s; }
export function putStacks(s: Stacks) { past.splice(0, past.length, ...s.past); future.splice(0, future.length, ...s.future); notify(); }
export function reset() { past.length = 0; future.length = 0; notify(); }
