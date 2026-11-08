/**
 * Canvas notes in the open diagram, whatever its kind: every kind's document has an optional `notes` list.
 * Each function is one undo step (or part of the gesture's transaction).
 */
import { create } from 'zustand';
import type { Draft } from 'immer';
import { change, editor, select, type OpenDoc } from '../store/editor';
import { centre, type Point } from '../store/viewport';
import { NOTE_COLORS, NOTE_SIZE, freshNoteId, sanitizeNotes, noteToFile, type CanvasNote, type NoteColor } from '../domain/notes';

/** Which note is being edited (one at a time), and whether it was just made (an empty new note is removed when left). */
export const useNoteUi = create(() => ({ editing: null as string | null, fresh: null as string | null }));

type WithNotes = { notes?: CanvasNote[] };
const NONE: CanvasNote[] = [];
/** A document's canvas notes (the same empty list every time when it has none, so React selectors stay stable). */
export const notesOf = (doc: OpenDoc['doc']): CanvasNote[] => (doc as WithNotes).notes ?? NONE;
export const openNotes = () => notesOf(editor().open.doc);
export const findNote = (id: string) => openNotes().find(n => n.id === id);

/** Change the open document's notes (any kind). An emptied list is removed, so files without notes stay as they were. */
function changeNotes(fn: (notes: Draft<CanvasNote>[]) => void) {
  change(editor().open.kind, d => {
    const doc = d as Draft<WithNotes>;
    doc.notes ??= [];
    fn(doc.notes);
    if (!doc.notes.length) delete doc.notes;
  });
}

const snap = (v: number) => Math.round(v / 8) * 8;

/** A new note at `at` (default: the middle of the view), selected and open for typing. */
export function addNote(at: Point | null = null, color: NoteColor = 'yellow', text = ''): string {
  const p = at ?? centre();
  const id = freshNoteId(openNotes().map(n => n.id));
  changeNotes(notes => { notes.push({ id, x: snap(p.x - (at ? 0 : NOTE_SIZE.w / 2)), y: snap(p.y - (at ? 0 : 40)), w: NOTE_SIZE.w, color, text }); });
  select({ type: 'note', ids: [id] });
  useNoteUi.setState({ editing: id, fresh: id });
  return id;
}

export function setNoteText(id: string, text: string) {
  changeNotes(notes => { const n = notes.find(x => x.id === id); if (n && n.text !== text) n.text = text; });
}
export function setNoteColor(ids: readonly string[], color: NoteColor) {
  if (!NOTE_COLORS.includes(color)) return;
  changeNotes(notes => { for (const n of notes) if (ids.includes(n.id)) n.color = color; });
}
export function moveNotes(ids: readonly string[], dx: number, dy: number) {
  if (!dx && !dy) return;
  changeNotes(notes => { for (const n of notes) if (ids.includes(n.id)) { n.x += dx; n.y += dy; } });
}
/** Place notes at absolute positions (dragging: from where they started). */
export function placeNotes(at: Record<string, Point>) {
  changeNotes(notes => { for (const n of notes) { const p = at[n.id]; if (p) { n.x = snap(p.x); n.y = snap(p.y); } } });
}
export function resizeNote(id: string, w: number, h: number | null) {
  changeNotes(notes => {
    const n = notes.find(x => x.id === id); if (!n) return;
    n.w = Math.round(Math.min(NOTE_SIZE.maxW, Math.max(NOTE_SIZE.minW, w)));
    if (h === null) delete n.h; else n.h = Math.round(Math.min(NOTE_SIZE.maxH, Math.max(NOTE_SIZE.minH, h)));
  });
}
export function removeNotes(ids: readonly string[]) {
  changeNotes(notes => { for (let i = notes.length - 1; i >= 0; i--) if (ids.includes(notes[i].id)) notes.splice(i, 1); });
  const ui = useNoteUi.getState();
  if (ui.editing && ids.includes(ui.editing)) useNoteUi.setState({ editing: null, fresh: null });
  select(null);
}

/** Leaving a note: a new note left empty is removed (as if it was never made). */
export function finishEditing(id: string) {
  const ui = useNoteUi.getState();
  if (ui.editing === id) useNoteUi.setState({ editing: null, fresh: null });
  const n = findNote(id);
  if (n && ui.fresh === id && !n.text.trim()) removeNotes([id]);
}

// ---------- copy, paste, duplicate (notes travel between tabs of any kind) ----------

const MARK = 'cistem-notes';
export function copyNotes(ids: readonly string[]): string | null {
  const picked = openNotes().filter(n => ids.includes(n.id));
  const f = noteToFile(picked);
  return f ? JSON.stringify({ [MARK]: 1, ...f }, null, 2) : null;
}
/** Paste copied notes: at `at` when given, else stepped `repeat` × 32px from where they were. False if `text` isn't notes. */
export function pasteNotes(text: string, at: Point | null, repeat: number): boolean {
  let raw: { model?: unknown; layout?: unknown } | null = null;
  try { const j = JSON.parse(text); if (j && j[MARK] === 1) raw = j; } catch { return false; }
  if (!raw) return false;
  const incoming = sanitizeNotes(raw.model, raw.layout);
  if (!incoming.length) return false;
  const minX = Math.min(...incoming.map(n => n.x)), minY = Math.min(...incoming.map(n => n.y));
  const dx = at ? snap(at.x - minX) : 32 * repeat, dy = at ? snap(at.y - minY) : 32 * repeat;
  const taken = openNotes().map(n => n.id);
  const ids: string[] = [];
  changeNotes(notes => {
    for (const n of incoming) {
      const id = freshNoteId([...taken, ...ids]);
      ids.push(id);
      notes.push({ ...n, id, x: n.x + dx, y: n.y + dy });
    }
  });
  select({ type: 'note', ids });
  return true;
}
export function duplicateNotes(ids: readonly string[]) {
  const text = copyNotes(ids);
  if (text) pasteNotes(text, null, 1);
}
export const isNotesClip = (text: string) => text.includes(`"${MARK}"`);

/** Keys for selected canvas notes: Enter types in it, arrows nudge (⇧ for bigger steps). */
export function noteKeydown(ev: KeyboardEvent): boolean {
  const sel = editor().selection;
  if (sel?.type !== 'note' || ev.metaKey || ev.ctrlKey || ev.altKey) return false;
  if (ev.key === 'Enter' && sel.ids.length === 1) { useNoteUi.setState({ editing: sel.ids[0], fresh: null }); return true; }
  const step = ev.shiftKey ? 32 : 8;
  const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (d[ev.key]) { moveNotes(sel.ids, ...d[ev.key]); return true; }
  return false;
}
