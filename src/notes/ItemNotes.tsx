/** Notes on an item (a component, connection, environment, class, relation or lifeline), edited in the details panel. */
import { useEffect, useRef } from 'react';
import type { Draft } from 'immer';
import { change, editor, type OpenDoc, type SelectionType } from '../store/editor';
import * as history from '../store/history';
import { taskProgress } from '../domain/notes';
import { NoteEditor } from './index';
import { linkTargets, openItem } from './links';

type Item = { notes?: string };

/** The item `type`/`id` in a document (draft or not). */
function itemIn(doc: Draft<OpenDoc['doc']> | OpenDoc['doc'], type: SelectionType, id: string): Item | undefined {
  const d = doc as unknown as Partial<Record<string, Array<Record<string, unknown>>>>;
  const list = { node: d.nodes, edge: d.edges, container: d.containers, class: d.classes, rel: d.relations, part: d.participants, row: undefined, note: undefined }[type];
  const key = type === 'class' ? 'name' : 'id';
  return list?.find(x => x[key] === id) as Item | undefined;
}
export const itemNotesOf = (type: SelectionType, id: string) => itemIn(editor().open.doc, type, id)?.notes ?? '';

/** Set an item's notes; empty text removes the field. */
export function setItemNotes(type: SelectionType, id: string, md: string) {
  change(editor().open.kind, d => {
    const it = itemIn(d, type, id); if (!it) return;
    if (md.trim()) { if (it.notes !== md) it.notes = md; } else delete it.notes;
  });
}

/** The panel's notes editor for one item: typing is one undo step from focus to leaving it. */
export function ItemNotes({ type, id, value }: { type: SelectionType; id: string; value: string }) {
  const typing = useRef(false);
  const stop = () => { if (typing.current) { typing.current = false; history.end(); } };
  useEffect(() => stop, [type, id]);
  return (
    <div className="item-notes" data-item-notes={`${type}:${id}`}>
      <NoteEditor key={type + ':' + id} value={value} editable toolbar="fixed" placeholder="Add notes… ( / for blocks, @ to link an item )"
        onChange={md => setItemNotes(type, id, md)}
        onFocus={() => { if (!typing.current) { typing.current = true; history.begin(); } }}
        onBlur={() => setTimeout(() => { if (!document.activeElement?.closest('.note-toolbar, .note-pop, .note-suggest')) stop(); }, 0)}
        linkTargets={linkTargets} onOpenItem={openItem} />
    </div>
  );
}

/** "Notes" with a checklist count, for a tab or a section heading. */
export function NotesLabel({ value }: { value: string }) {
  const p = taskProgress(value);
  return <>Notes{p.total > 0 && <span className="notes-count">{p.done}/{p.total}</span>}</>;
}

/** A Notes section at the bottom of a panel. */
export function NotesSection({ type, id, value }: { type: SelectionType; id: string; value: string }) {
  return (
    <section className="notes-section">
      <h4><NotesLabel value={value} /></h4>
      <ItemNotes type={type} id={id} value={value} />
    </section>
  );
}
