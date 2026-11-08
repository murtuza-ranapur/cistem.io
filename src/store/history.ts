/**
 * Undo / redo as Immer patches. Each change records the patches that made it and the inverse patches
 * that take it back, so a step costs the size of the change, not of the document.
 *
 * A transaction groups the changes of one gesture (a drag, typing in a field while it has focus) into a
 * single step. A transaction with no changes leaves no step, so focusing a field never costs an undo press.
 */
import { applyPatches, enablePatches, type Patch } from 'immer';
import { create } from 'zustand';

enablePatches();

export interface Step { patches: Patch[]; inverse: Patch[] }
export interface Stacks { past: Step[]; future: Step[] }

const LIMIT = 200;
let past: Step[] = [];
let future: Step[] = [];
let open: Step | null = null;   // the transaction being recorded
let depth = 0;

/** For the toolbar: whether there's anything to undo / redo. */
export const useHistory = create(() => ({ canUndo: false, canRedo: false }));
const notify = () => useHistory.setState({ canUndo: past.length > 0 || !!open?.patches.length, canRedo: future.length > 0 });

/** Record a change (called by the store for every document change). */
export function record(patches: Patch[], inverse: Patch[]) {
  if (!patches.length) return;
  if (open) { open.patches.push(...patches); open.inverse.unshift(...inverse); }
  else push({ patches, inverse });
}
function push(step: Step) {
  past.push(step);
  if (past.length > LIMIT) past.shift();
  future = [];
  notify();
}

/** Start grouping changes into one step; nested calls join the outer one. */
export function begin() {
  if (depth++ === 0) open = { patches: [], inverse: [] };
}
/** Finish the group; it becomes one undo step if anything changed. */
export function end() {
  if (depth === 0) return;
  if (--depth > 0) return;
  const step = open; open = null;
  if (step?.patches.length) push(step); else notify();
}
/** Run `fn` as one undo step. */
export function transaction<T>(fn: () => T): T {
  begin();
  try { return fn(); } finally { end(); }
}
export const inTransaction = () => depth > 0;

/** Undo the last step against `state`; returns the restored state, or null when there's nothing to undo. */
export function undo<S extends object>(state: S): S | null {
  if (open) end();   // an unfinished gesture is committed first, then undone like any other step
  const step = past.pop(); if (!step) return null;
  future.push(step); notify();
  return applyPatches(state, step.inverse);
}
export function redo<S extends object>(state: S): S | null {
  const step = future.pop(); if (!step) return null;
  past.push(step); notify();
  return applyPatches(state, step.patches);
}

/** Each tab keeps its own history: hand the stacks over when switching. */
export function takeStacks(): Stacks {
  if (open) { depth = 1; end(); }
  const s = { past, future };
  past = []; future = []; notify();
  return s;
}
export function putStacks(s: Stacks) { past = s.past; future = s.future; open = null; depth = 0; notify(); }
export function reset() { putStacks({ past: [], future: [] }); }
