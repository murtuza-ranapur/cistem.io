import type { Doc } from './model';

/** Snapshot-based undo/redo. Documents are small, so whole-doc snapshots are fine. */
const past: string[] = [];
const future: string[] = [];
const LIMIT = 100;
let listeners: (() => void)[] = [];

export const onHistoryChange = (fn: () => void) => listeners.push(fn);
const notify = () => listeners.forEach(f => f());

/** Call before mutating the doc. Coalesces identical consecutive snapshots. */
export function snapshot(doc: Doc) {
  const s = JSON.stringify(doc);
  if (past[past.length - 1] === s) return;
  past.push(s);
  if (past.length > LIMIT) past.shift();
  future.length = 0;
  notify();
}
export function undo(doc: Doc): Doc | null {
  const s = past.pop(); if (s === undefined) return null;
  future.push(JSON.stringify(doc)); notify();
  return JSON.parse(s);
}
export function redo(doc: Doc): Doc | null {
  const s = future.pop(); if (s === undefined) return null;
  past.push(JSON.stringify(doc)); notify();
  return JSON.parse(s);
}
export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;
export function reset() { past.length = 0; future.length = 0; notify(); }
