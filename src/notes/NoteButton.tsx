/** The rail's "Sticky" button, the same on every kind of diagram. */
import { addNote } from './actions';

export function NoteButton() {
  return (
    <button type="button" className="rail-note" id="addNote" data-add-note title="Sticky (N): a free note with rich text, anywhere on the canvas" aria-label="Add a sticky note" onClick={() => addNote()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v11l-5 5H4z" /><path d="M15 20v-5h5" /><path d="M8 9h8M8 13h5" /></svg>
      <span>Sticky</span>
    </button>
  );
}
