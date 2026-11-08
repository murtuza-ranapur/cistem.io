/** Commands that act on whichever diagram is open, through its module. Used by the toolbar, keys and menus. */
import { diagram } from '../diagrams';
import { editor, selectedIds } from './editor';
import { bounds, fitTo, reveal, whenDrawn, type Point } from './viewport';
import { notesBounds } from '../domain/notes';
import { copyNotes, duplicateNotes, isNotesClip, notesOf, pasteNotes, removeNotes } from '../notes/actions';

export const active = () => diagram(editor().open.kind);

/** Fit everything into view. */
export function fitView(animated = true) {
  const { open } = editor(), m = active();
  if (m.fit) { m.fit(animated); return; }
  const drawn = m.bounds(open.doc as never);
  fitTo(bounds([...(drawn ? [drawn] : []), ...notesBounds(notesOf(open.doc))]), { animated });
}
/** Fit once the newly opened document is drawn (opening a tab, loading from the cloud). */
export const fitWhenDrawn = () => whenDrawn(() => fitView(false));
/** Keep the selected item clear of the panel and the canvas edges. */
export function revealSelection() {
  const { open, selection } = editor();
  if (!selection) return;
  reveal(active().selectionBox?.(open.doc as never, selection) ?? null);
}
/** Canvas notes are selectable in every kind, so the commands below try them before the diagram itself. */
const notesSelected = () => selectedIds('note');

export const removeSelection = () => (notesSelected().length ? removeNotes(notesSelected()) : active().remove());
export const duplicateSelection = () => (notesSelected().length ? duplicateNotes(notesSelected()) : active().duplicate());
/** The selection as clipboard text (null: nothing copyable selected). */
export const copySelection = (): string | null => (notesSelected().length ? copyNotes(notesSelected()) : active().copy());
/** Paste clipboard text into the open diagram: notes into any kind, everything else through the diagram. */
export const pasteInto = (text: string, at: Point | null, repeat: number): boolean =>
  (isNotesClip(text) ? pasteNotes(text, at, repeat) : active().paste(text, at, repeat));
export const selectAll = () => active().selectAll();
export const organise = () => active().organise?.();
