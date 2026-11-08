/**
 * Canvas notes: an HTML layer over whichever canvas is open, moved and scaled with the view.
 * Click to select, drag to move, double-click (or Enter) to type, drag the corner to resize,
 * tick checkboxes without entering edit mode.
 */
import { memo, useEffect, useRef } from 'react';
import { useEditor, isSelected, selectOne, toggleSelected, editor } from '../store/editor';
import { wheelPanZoom } from '../store/viewport';
import { holdPanel, releasePanel } from '../store/ui';
import * as history from '../store/history';
import { useDoubleTap } from '../diagrams/shared';
import { NOTE_COLORS, type CanvasNote, type NoteColor } from '../domain/notes';
import { NoteEditor, preloadNoteEditor } from './index';
import { notesOf, useNoteUi, setNoteText, setNoteColor, placeNotes, resizeNote, finishEditing } from './actions';
import { linkTargets, openItem } from './links';

export function NotesLayer() {
  const notes = useEditor(s => notesOf(s.open.doc));
  const { x, y, k } = useEditor(s => s.view);
  const layer = useRef<HTMLDivElement>(null);
  const any = notes.length > 0;
  useEffect(() => { if (any) preloadNoteEditor(); }, [any]);

  // the wheel pans and zooms the canvas over notes too (except inside the note being typed in)
  useEffect(() => {
    const el = layer.current; if (!el) return;
    const wheel = (ev: WheelEvent) => {
      if ((ev.target as Element).closest('.cnote.editing')) return;
      ev.preventDefault(); wheelPanZoom(ev);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [any]);

  if (!any) return null;
  return (
    <div className="notes-layer" ref={layer}>
      <div className="notes-world" style={{ transform: `translate(${x}px, ${y}px) scale(${k})` }}>
        {notes.map(n => <NoteBox key={n.id} note={n} />)}
      </div>
    </div>
  );
}

const NoteBox = memo(function NoteBox({ note }: { note: CanvasNote }) {
  const selected = useEditor(s => isSelected(s.selection, 'note', note.id));
  const only = useEditor(s => s.selection?.type === 'note' && s.selection.ids.length === 1);
  const editing = useNoteUi(s => s.editing === note.id);
  const el = useRef<HTMLDivElement>(null);
  const doubleTap = useDoubleTap();
  const typing = useRef(false);

  // ---- move (the whole selection) ----
  const drag = useRef<{ x0: number; y0: number; start: Record<string, { x: number; y: number }>; moved: boolean } | null>(null);
  const onPointerDown = (ev: React.PointerEvent) => {
    if (editing || ev.button !== 0) return;
    const t = ev.target as HTMLElement;
    if (t.closest('input, label, a, [data-resize], .cnote-colours')) return;   // ticking, following a link, resizing, recolouring
    ev.preventDefault();
    ev.stopPropagation();
    if (doubleTap('note:' + note.id, ev)) { selectOne('note', note.id); useNoteUi.setState({ editing: note.id, fresh: null }); return; }
    if (ev.shiftKey || ev.metaKey || ev.ctrlKey) { toggleSelected('note', note.id); return; }
    if (!selected) selectOne('note', note.id);
    const ids = editor().selection?.type === 'note' ? editor().selection!.ids : [note.id];
    const start = Object.fromEntries(notesOf(editor().open.doc).filter(n => ids.includes(n.id)).map(n => [n.id, { x: n.x, y: n.y }]));
    drag.current = { x0: ev.clientX, y0: ev.clientY, start, moved: false };
    el.current!.setPointerCapture(ev.pointerId);
    holdPanel();
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const k = editor().view.k, dx = (ev.clientX - d.x0) / k, dy = (ev.clientY - d.y0) / k;
    if (!d.moved && Math.hypot(dx * k, dy * k) < 3) return;
    if (!d.moved) { d.moved = true; history.begin(); }
    placeNotes(Object.fromEntries(Object.entries(d.start).map(([id, p]) => [id, { x: p.x + dx, y: p.y + dy }])));
  };
  const onPointerUp = () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.moved) history.end();
    releasePanel(!d.moved, 'note:' + note.id);
  };

  // ---- resize from the corner ----
  const size = useRef<{ x0: number; y0: number; w: number; h: number } | null>(null);
  const resizeDown = (ev: React.PointerEvent) => {
    ev.preventDefault(); ev.stopPropagation();
    size.current = { x0: ev.clientX, y0: ev.clientY, w: note.w, h: el.current!.offsetHeight };
    (ev.target as Element).setPointerCapture(ev.pointerId);
    history.begin();
  };
  const resizeMove = (ev: React.PointerEvent) => {
    const s = size.current; if (!s) return;
    const k = editor().view.k;
    resizeNote(note.id, s.w + (ev.clientX - s.x0) / k, s.h + (ev.clientY - s.y0) / k);
  };
  const resizeUp = () => { if (size.current) { size.current = null; history.end(); } };

  // ---- typing: one undo step from focus to leaving the note ----
  const onFocus = () => { if (!typing.current) { typing.current = true; history.begin(); } };
  const onBlur = () => {
    // focus moving into the note's own toolbar (a colour or link box) isn't leaving the note
    setTimeout(() => {
      if (document.activeElement?.closest('.note-toolbar, .note-pop, .note-suggest')) return;
      if (el.current?.contains(document.activeElement)) return;
      if (typing.current) { typing.current = false; history.end(); }
      finishEditing(note.id);
    }, 0);
  };
  useEffect(() => () => { if (typing.current) { typing.current = false; history.end(); } }, []);

  return (
    <div ref={el} className={'cnote' + (selected ? ' sel' : '') + (editing ? ' editing' : '')} data-note={note.id} data-color={note.color}
      style={{ left: note.x, top: note.y, width: note.w, ...(note.h ? { height: note.h } : {}) }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {selected && only && !drag.current?.moved && <ColourRow id={note.id} color={note.color} />}
      <NoteEditor value={note.text} editable={editing} toolbar="floating" autoFocus={editing}
        placeholder="Type a note… ( / for blocks, @ to link )"
        onChange={md => setNoteText(note.id, md)} onFocus={onFocus} onBlur={onBlur}
        linkTargets={linkTargets} onOpenItem={openItem} />
      {selected && <div className="cnote-resize" data-resize aria-hidden="true" onPointerDown={resizeDown} onPointerMove={resizeMove} onPointerUp={resizeUp} onPointerCancel={resizeUp} />}
    </div>
  );
});

const COLOUR_NAMES: Record<NoteColor, string> = { yellow: 'Yellow', blue: 'Blue', green: 'Green', pink: 'Pink', grey: 'Grey', none: 'No fill' };
function ColourRow({ id, color }: { id: string; color: NoteColor }) {
  return (
    <div className="cnote-colours" role="group" aria-label="Note colour" onPointerDown={e => e.stopPropagation()}>
      {NOTE_COLORS.map(c => (
        <button type="button" key={c} data-note-color={c} aria-label={COLOUR_NAMES[c]} title={COLOUR_NAMES[c]} aria-pressed={c === color}
          className={c === color ? 'on' : ''} onClick={() => setNoteColor([id], c)} />
      ))}
    </div>
  );
}
