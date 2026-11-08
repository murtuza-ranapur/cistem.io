/**
 * The open diagram: its document, title, view and selection. One store for every kind of diagram.
 *
 * Documents are immutable (Immer): `change` produces the next document and records the patches for undo.
 * Views subscribe to the slices they draw, so a pan redraws the transform and a drag redraws the moved items.
 */
import { create } from 'zustand';
import { produceWithPatches, type Draft } from 'immer';
import type { Doc } from '../domain/model';
import type { SeqDoc } from '../domain/seq';
import type { ClassDoc } from '../domain/cls';
import type { DiagramFile, DiagramKind } from '../domain/document';
import * as history from './history';

export type Meta = DiagramFile['meta'];
export interface View { x: number; y: number; k: number }

/** The open document, tagged with its kind. */
export type OpenDoc =
  | { kind: 'system'; doc: Doc }
  | { kind: 'sequence'; doc: SeqDoc }
  | { kind: 'class'; doc: ClassDoc };
export type DocOf<K extends DiagramKind> = Extract<OpenDoc, { kind: K }>['doc'];

/** What's selected. System: nodes, an edge or an environment. Sequence: rows or a lifeline. Class: classes or a relation. Any kind: canvas notes. */
export type SelectionType = 'node' | 'edge' | 'container' | 'row' | 'part' | 'class' | 'rel' | 'note';
/** `ids[0]` is the primary item (the one the panel shows); the rest are selected alongside it. */
export interface Selection { type: SelectionType; ids: string[] }

export interface EditorState {
  open: OpenDoc;
  meta: Meta;
  view: View;
  selection: Selection | null;
}

export const freshMeta = (title: string): Meta => { const now = new Date().toISOString(); return { title, created: now, updated: now }; };

export const useEditor = create<EditorState>(() => ({
  open: { kind: 'system', doc: { nodes: [], edges: [], containers: [], links: [], frames: {}, detail: {} } },
  meta: freshMeta('Untitled system'),
  view: { x: 0, y: 0, k: 1 },
  selection: null,
}));
export const editor = () => useEditor.getState();

// ---------- changing the document (undoable) ----------

interface Editable<D> { doc: D; meta: Meta }

/**
 * Change the open document of `kind` (and/or its title). Every change is an undo step, or part of the
 * transaction in progress. Does nothing if a different kind is open.
 */
export function change<K extends DiagramKind>(kind: K, recipe: (doc: Draft<DocOf<K>>, meta: Draft<Meta>) => void) {
  const s = editor();
  if (s.open.kind !== kind) return;
  const [next, patches, inverse] = produceWithPatches({ doc: s.open.doc, meta: s.meta } as Editable<DocOf<K>>, d => { recipe(d.doc as Draft<DocOf<K>>, d.meta); });
  if (!patches.length) return;
  useEditor.setState({ open: { kind, doc: next.doc } as OpenDoc, meta: next.meta });
  history.record(patches, inverse);
}
/** Change the title (any kind). */
export const changeMeta = (recipe: (meta: Draft<Meta>) => void) => change(editor().open.kind, (_d, m) => recipe(m));

function restore(r: Editable<OpenDoc['doc']> | null) {
  if (!r) return;
  useEditor.setState(s => ({ open: { kind: s.open.kind, doc: r.doc } as OpenDoc, meta: r.meta, selection: keepSelection(s.selection, r.doc) }));
}
export const undo = () => restore(history.undo({ doc: editor().open.doc, meta: editor().meta }));
export const redo = () => restore(history.redo({ doc: editor().open.doc, meta: editor().meta }));

/** Swap in a different document (opening a tab, loading from the cloud). Not an undo step. */
export function replace(open: OpenDoc, meta: Meta, keep: Partial<Pick<EditorState, 'view' | 'selection'>> = {}) {
  useEditor.setState({ open, meta, selection: keepSelection(keep.selection ?? null, open.doc), ...(keep.view ? { view: keep.view } : {}) });
}

// ---------- selection ----------

export function select(sel: Selection | null) { useEditor.setState({ selection: sel && sel.ids.length ? sel : null }); }
export const selectOne = (type: SelectionType, id: string) => select({ type, ids: [id] });
/** Shift/⌘-click: add `id` (making it primary) or take it out if already selected. */
export function toggleSelected(type: SelectionType, id: string) {
  const s = editor().selection;
  if (!s || s.type !== type) return selectOne(type, id);
  select(s.ids.includes(id) ? { type, ids: s.ids.filter(x => x !== id) } : { type, ids: [id, ...s.ids] });
}
/** Make `id` primary within the current selection (keeps the others). */
export function makePrimary(type: SelectionType, id: string) {
  const s = editor().selection;
  if (s?.type === type && s.ids.includes(id)) select({ type, ids: [id, ...s.ids.filter(x => x !== id)] });
  else selectOne(type, id);
}
export const selectedIds = (type: SelectionType): string[] => { const s = editor().selection; return s?.type === type ? s.ids : []; };
export const primary = (type?: SelectionType): string | null => { const s = editor().selection; return s && (!type || s.type === type) ? s.ids[0] : null; };
export const isSelected = (sel: Selection | null, type: SelectionType, id: string) => sel?.type === type && sel.ids.includes(id);

/** After undo/redo or an outside update, keep only selected items that still exist. */
function keepSelection(sel: Selection | null, doc: OpenDoc['doc']): Selection | null {
  if (!sel) return null;
  const exists = idsIn(doc, sel.type);
  const ids = sel.ids.filter(id => exists.has(id));
  return ids.length ? { type: sel.type, ids } : null;
}
function idsIn(doc: OpenDoc['doc'], type: SelectionType): Set<string> {
  const d = doc as Partial<Doc & SeqDoc & ClassDoc>;
  switch (type) {
    case 'node': return new Set(d.nodes?.map(n => n.id));
    case 'edge': return new Set(d.edges?.map(e => e.id));
    case 'container': return new Set(d.containers?.map(c => c.id));
    case 'row': return new Set(d.rows?.map(r => r.id));
    case 'part': return new Set(d.participants?.map(p => p.id));
    case 'class': return new Set(d.classes?.map(c => c.name));
    case 'rel': return new Set(d.relations?.map(r => r.id));
    case 'note': return new Set(d.notes?.map(n => n.id));
  }
}
export { keepSelection };

// ---------- view ----------

export const setView = (view: View) => useEditor.setState({ view });
export const ZOOM = { min: 0.25, max: 3 };
