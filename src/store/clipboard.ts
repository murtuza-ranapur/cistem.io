/**
 * Copy, cut and paste for every kind of diagram (⌘C / ⌘X / ⌘V and the right-click menu).
 *
 * The open diagram turns its selection into readable text (JSON for systems, the text format for sequence
 * and class diagrams). That goes to the system clipboard and is also kept here (localStorage), so the
 * right-click Paste works without clipboard permission and across tabs and windows.
 */
import { isTyping, storage } from '../lib/browser';
import { editor } from './editor';
import { copySelection, pasteInto, removeSelection } from './commands';
import { isNotesClip } from '../notes/actions';
import * as history from './history';
import { hint } from './ui';
import type { Point } from './viewport';
import type { DiagramKind } from '../domain/document';

const STORE = 'cistem.clip';
interface Clip { kind: DiagramKind; text: string }

let lastText = '';
let repeat = 0;   // pasting the same copy again steps it further away
const kept = (): Clip | null => storage.getJson<Clip>(STORE);
const keep = (text: string) => {
  storage.set(STORE, JSON.stringify({ kind: editor().open.kind, text }));
  lastText = text; repeat = 0;
};

/** Copy the selection; returns its text, or null when nothing copyable is selected. */
export function copy(): string | null {
  const text = copySelection(); if (!text) return null;
  keep(text);
  navigator.clipboard?.writeText(text).catch(() => {});
  return text;
}
export function cut(): boolean {
  const text = copy(); if (!text) return false;
  repeat = -1;   // the first paste lands where it was cut from
  removeSelection();
  return true;
}
/** Paste `text` (default: what this app last copied) — one undo step. */
export function paste(text = kept()?.text ?? '', at: Point | null = null): boolean {
  if (!text.trim()) return false;
  if (text !== lastText) { lastText = text; repeat = 0; }
  repeat++;
  return history.transaction(() => pasteInto(text, at, repeat));
}
/** Notes paste into any kind of diagram; other copies only into the kind they came from. */
export const canPaste = () => { const k = kept(); return !!k && (k.kind === editor().open.kind || isNotesClip(k.text)); };
export const canCopy = () => copySelection() !== null;

/** The browser's own copy / cut / paste events (fired by the shortcuts). */
export function listenForClipboard() {
  const skip = (ev: Event) => isTyping(ev.target) || isTyping(document.activeElement);
  document.addEventListener('copy', ev => {
    if (skip(ev)) return;
    const text = copySelection(); if (!text) return;
    ev.preventDefault(); ev.clipboardData?.setData('text/plain', text); keep(text);
    hint('Copied', 1200);
  });
  document.addEventListener('cut', ev => {
    if (skip(ev)) return;
    const text = copySelection(); if (!text) return;
    ev.preventDefault(); ev.clipboardData?.setData('text/plain', text); keep(text);
    repeat = -1; removeSelection();
  });
  // capture: runs before a diagram's own paste-to-import, which handles code pasted from elsewhere
  document.addEventListener('paste', ev => {
    if (skip(ev)) return;
    const text = ev.clipboardData?.getData('text/plain') ?? '';
    if (paste(text)) { ev.preventDefault(); ev.stopImmediatePropagation(); }
  }, true);
}
