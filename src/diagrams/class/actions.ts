/** Everything that changes a class diagram: adding, renaming, members, relations, importing, organising. */
import { produce } from 'immer';
import {
  boxSize, layoutCls, mergeCls, parseMember, isMethod, relId, renameClass, fromTables, fromAvro,
  type ClassBox, type ClassDoc, type ClassKind, type Member, type RelType, type Vis,
} from '../../domain/cls';
import { change, editor, select, selectOne, selectedIds, primary, useEditor } from '../../store/editor';
import * as history from '../../store/history';
import { centre } from '../../store/viewport';
import { fitView } from '../../store/commands';
import { hint } from '../../store/ui';
import { peek, systemTabs } from '../../store/tabs';
import { animate } from '../../lib/browser';
import { docOf } from '../shared';
import { copyName, findClass, freeName, hasClass, isName, rectOf, snap } from './model';
import { useClsUi } from './ui';

const doc = () => docOf('class');
const taken = (n: string) => hasClass(doc(), n);
/** The selected class names (the primary first). */
export const selectedClasses = () => selectedIds('class').filter(taken);

// ---------- adding ----------
const NEW_NAME: Record<ClassKind, string> = { class: 'NewClass', abstract: 'AbstractThing', interface: 'NewInterface', enum: 'NewEnum', record: 'NewRecord' };

/** The free spot nearest the middle of the view, for a box of w × h. */
function freeSpot(w: number, h: number) {
  const c = centre(), rects = doc().classes.map(x => rectOf(doc(), x));
  const free = (x: number, y: number) => rects.every(o => x + w + 24 <= o.x || o.x + o.w + 24 <= x || y + h + 24 <= o.y || o.y + o.h + 24 <= y);
  for (let ring = 0; ring < 14; ring++) for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
    const x = snap(c.x - w / 2 + dx * (w + 40)), y = snap(c.y - h / 2 + dy * (h + 40));
    if (free(x, y)) return { x, y };
  }
  return { x: snap(c.x), y: snap(c.y) };
}

/** Add a class (at `at`, or the nearest free spot) and start naming it. */
export function addClass(kind: ClassKind, at?: { x: number; y: number }) {
  const name = freeName(taken, NEW_NAME[kind]);
  const c: ClassBox = { name, kind, fields: kind === 'enum' ? [{ vis: '', name: 'FIRST', type: '' }, { vis: '', name: 'SECOND', type: '' }] : [], methods: [] };
  const s = boxSize(c), p = at ?? freeSpot(s.w, s.h);
  change('class', d => { d.classes.push(c); d.pos[name] = p; });
  selectOne('class', name);
  requestAnimationFrame(() => startRename(name));
}

// ---------- renaming and members ----------
export const startRename = (name: string) => useClsUi.setState({ editing: { t: 'rename', name }, picker: null });
export const startEditMember = (name: string, kind: 'f' | 'm', i: number) => useClsUi.setState({ editing: { t: 'member', name, kind, i }, picker: null });

/** Rename a class (members' types and relations follow). False, with a hint, when the name won't do. */
export function tryRename(from: string, to: string): boolean {
  if (from === to) return true;
  if (!isName(to)) { hint('Class names are letters, digits, _ and $ (no spaces)', 2000); return false; }
  if (taken(to)) { hint(`There's already a class ${to}`, 1800); return false; }
  change('class', d => renameClass(d as ClassDoc, from, to));
  selectOne('class', to);
  return true;
}

/** Commit the text typed over member `i` of a class: a member line, or an enum constant. */
export function editMember(name: string, kind: 'f' | 'm', i: number, text: string) {
  const c = findClass(doc(), name); if (!c) return;
  if (c.kind === 'enum') {
    if (isName(text)) change('class', d => { findClass(d as ClassDoc, name)!.fields[i] = { vis: '', name: text, type: '' }; });
    return;
  }
  const m = parseMember(text);
  if (!m) { hint('Not a member. Try  - name: Type  or  + method(arg: Type): Result', 2200); return; }
  change('class', d => {
    const box = findClass(d as ClassDoc, name)!;
    (kind === 'f' ? box.fields : box.methods).splice(i, 1);
    const into = isMethod(m) ? box.methods : box.fields;
    into.splice(isMethod(m) === (kind === 'm') ? i : into.length, 0, m);
  });
}

/** The panel's one-line add: "- fee: Money", "+ retry(n: int): void", or enum constants "A, B". Returns an error hint or null. */
export function addMember(name: string, kind: 'f' | 'm', raw: string): string | null {
  const c = findClass(doc(), name); if (!c || !raw.trim()) return null;
  if (c.kind === 'enum') {
    const names = raw.split(',').map(x => x.trim()).filter(isName);
    if (names.length) change('class', d => { findClass(d as ClassDoc, name)!.fields.push(...names.map(n => ({ vis: '' as Vis, name: n, type: '' }))); });
    return null;
  }
  const text = raw.trim();
  const m = parseMember(kind === 'm' && !text.includes('(') ? text.replace(/^([+\-#~]?\s*[A-Za-z_$][\w$]*)/, '$1()') : text);
  if (!m) return kind === 'm' ? 'Try  + retry(n: int): void' : 'Try  - fee: Money';
  if (!m.vis && !/^[+\-#~]/.test(text)) m.vis = kind === 'm' ? '+' : '-';
  change('class', d => { const box = findClass(d as ClassDoc, name)!; (isMethod(m) ? box.methods : box.fields).push(m); });
  return null;
}

/** Change one member in place (the panel's rows). */
export function updateMember(name: string, kind: 'f' | 'm', i: number, fn: (m: Member) => void) {
  change('class', d => { const box = findClass(d as ClassDoc, name); const m = box && (kind === 'f' ? box.fields : box.methods)[i]; if (m) fn(m); });
}
export function removeMember(name: string, kind: 'f' | 'm', i: number) {
  change('class', d => { const box = findClass(d as ClassDoc, name); if (box) (kind === 'f' ? box.fields : box.methods).splice(i, 1); });
}

// ---------- relations ----------
export function addRelation(from: string, to: string, type: RelType, toMult?: string) {
  const id = relId();
  change('class', d => { d.relations.push({ id, from, to, type, ...(toMult ? { toMult } : {}) }); });
  selectOne('rel', id);
}

// ---------- selection commands (the shell's Delete / ⌘D / ⌘A / arrows) ----------
export function remove() {
  const s = editor().selection; if (!s) return;
  if (s.type === 'rel') change('class', d => { d.relations = d.relations.filter(r => !s.ids.includes(r.id)); });
  else if (s.type === 'class') {
    const names = new Set(s.ids);
    change('class', d => {
      d.classes = d.classes.filter(c => !names.has(c.name));
      d.relations = d.relations.filter(r => !names.has(r.from) && !names.has(r.to));
      for (const n of names) delete d.pos[n];
    });
  } else return;
  select(null);
}
export function duplicate() {
  const name = primary('class'); if (!name) return;
  const c = findClass(doc(), name); if (!c) return;
  const n = copyName(taken, name), p = doc().pos[name] ?? { x: 0, y: 0 };
  change('class', d => { d.classes.push({ ...structuredClone(c), name: n }); d.pos[n] = { x: p.x + 32, y: p.y + 32 }; });
  selectOne('class', n);
}
export const selectAll = () => select({ type: 'class', ids: doc().classes.map(c => c.name) });
export function nudge(dx: number, dy: number) {
  const names = selectedClasses(); if (!names.length) return false;
  change('class', d => { for (const n of names) { const p = d.pos[n]; if (p) d.pos[n] = { x: p.x + dx, y: p.y + dy }; } });
  return true;
}

// ---------- importing and organising ----------
/** Merge classes read from code, Mermaid or a generator into the diagram (new ones are laid out next to the others). */
export function importDoc(incoming: ClassDoc, what: string) {
  let res = { added: [] as string[], updated: [] as string[] };
  change('class', d => {
    const draft = d as ClassDoc;
    res = mergeCls(draft, incoming);
    const fresh = new Set(res.added);
    if (fresh.size) Object.assign(draft.pos, draft.classes.length === fresh.size ? layoutCls(draft) : layoutCls(draft, fresh));
  });
  const first = res.added[0] ?? res.updated[0];
  if (first) selectOne('class', first);
  requestAnimationFrame(() => fitView());
  const n = res.added.length + res.updated.length;
  hint(`Read ${res.added.length} new and ${res.updated.length} updated class${n === 1 ? '' : 'es'} from ${what}`, 2600);
}

/** Lay the classes out again, gliding them to their new places (one undo step). */
export function organise() {
  const d = doc(), target = layoutCls(d), from = d.pos;
  history.begin();
  animate(280, t => change('class', draft => {
    for (const n of Object.keys(target)) { const a = from[n] ?? target[n], b = target[n]; draft.pos[n] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  }), () => { history.end(); fitView(); });
}

/**
 * Classes without a position (a file that didn't have them) get one next to the others. Layout isn't
 * something the user did, so it's not an undo step. Returns whether everything was placed afresh.
 */
export function placeMissing(): boolean {
  const s = editor(); if (s.open.kind !== 'class') return false;
  const d = s.open.doc, missing = new Set(d.classes.filter(c => !d.pos[c.name]).map(c => c.name));
  if (!missing.size) return false;
  const all = missing.size === d.classes.length;
  const pos = all ? layoutCls(d) : { ...d.pos, ...layoutCls(d, missing) };
  useEditor.setState({ open: { kind: 'class', doc: produce(d, draft => { draft.pos = pos; }) } });
  return all;
}

// ---------- generators (from the system diagrams open on this device) ----------
export interface Source { label: string; make: () => ClassDoc }
export function sources(): Source[] {
  const out: Source[] = [];
  for (const t of systemTabs()) {
    const open = peek(t.key)?.open; if (open?.kind !== 'system') continue;
    for (const n of open.doc.nodes) {
      if (n.tables?.length) { const tables = n.tables; out.push({ label: `${n.name} tables`, make: () => fromTables(structuredClone(tables), n.name) }); }
      if (typeof n.schema === 'string' && n.schema.trim().startsWith('{')) { const schema = n.schema; out.push({ label: `${n.name} schema`, make: () => fromAvro(schema) }); }
    }
  }
  return out;
}
