/**
 * Notes, as the rest of the app sees them. The editor (TipTap and its languages) loads the first time a
 * note is shown; until then a plain-text preview stands in.
 */
import { lazy, Suspense } from 'react';
import { notePreview } from '../domain/notes';
import type { NoteEditorProps } from './NoteEditor';

export type { LinkTarget, NoteEditorProps } from './NoteEditor';

const LazyEditor = lazy(() => import('./NoteEditor'));
/** Start loading the editor early (e.g. when a diagram with notes opens). */
export const preloadNoteEditor = () => { void import('./NoteEditor'); };

export function NoteEditor(p: NoteEditorProps) {
  return (
    <Suspense fallback={<div className="note-editor loading"><p className="note-prose">{notePreview(p.value, 400) || ' '}</p></div>}>
      <LazyEditor {...p} />
    </Suspense>
  );
}
