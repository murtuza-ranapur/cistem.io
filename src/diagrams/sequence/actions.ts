/** Every change to a sequence diagram: adding lifelines, messages, notes and blocks, moving and removing them. */
import { balanced, blockEnd, rowId, slugId, BLOCK_KINDS, SEQ, type BlockKind, type MsgStyle, type Participant, type Row, type SeqDoc } from '../../domain/seq';
import { change, editor, select, selectOne, setView, type Selection } from '../../store/editor';
import { getSurface } from '../../store/viewport';
import { hint } from '../../store/ui';
import { docOf } from '../shared';
import { geometry } from './geometry';
import { useSeqUi } from './state';
import { startEdit, startEditPart } from './edit';
import { nodeOf, openLinkedSystem } from './linked';

const seq = () => docOf('sequence');
const sel = (): Selection | null => editor().selection;
/** Selected rows (row selection only). */
const selectedRows = (): string[] => (sel()?.type === 'row' ? sel()!.ids : []);
export const nameOf = (d: SeqDoc, pid: string) => d.participants.find(p => p.id === pid)?.name ?? pid;
/** How many rows a row carries when it moves: a block takes its whole body; markers inside can't move alone. */
export const spanOf = (rows: Row[], i: number) => (rows[i]?.t === 'open' ? blockEnd(rows, i) - i + 1 : rows[i]?.t === 'msg' || rows[i]?.t === 'note' ? 1 : 0);
/** Nesting depth before row i. */
export function depthOf(rows: Row[], i: number) { let d = 0; for (let k = 0; k < i; k++) { if (rows[k].t === 'open') d++; else if (rows[k].t === 'close') d--; } return d; }

/** Pan sideways just enough that world x (a lifeline) is in view, clear of the edges. */
export function revealX(x: number | undefined) {
  const svg = getSurface(); if (x === undefined || !svg) return;
  const v = editor().view, w = svg.getBoundingClientRect().width, sx = x * v.k + v.x, pad = SEQ.headW / 2 * v.k + 24;
  const dx = sx > w - pad ? w - pad - sx : sx < pad ? pad - sx : 0;
  if (dx) setView({ ...v, x: v.x + dx });
}

// ---------- lifelines ----------

/** Add a lifeline after the selected one (else at the end) and start naming it. */
export function addParticipant(name?: string): Participant {
  const ps = seq().participants;
  const nm = name ?? `Participant ${ps.length + 1}`;
  const p: Participant = { id: slugId(nm, ps.map(x => x.id)), name: nm };
  const s = sel(), at = s?.type === 'part' ? ps.findIndex(x => x.id === s.ids[0]) + 1 : ps.length;
  change('sequence', d => { d.participants.splice(at || d.participants.length, 0, p); });
  selectOne('part', p.id);
  requestAnimationFrame(() => { revealX(geometry(seq()).colX[p.id]); startEditPart(p.id); });
  return p;
}
/** Move lifeline `pid` to index `to`. */
export function moveParticipant(pid: string, to: number) {
  change('sequence', d => {
    const i = d.participants.findIndex(p => p.id === pid);
    if (i < 0 || to === i || to < 0 || to >= d.participants.length) return;
    const [p] = d.participants.splice(i, 1); d.participants.splice(to, 0, p);
  });
}
/** Change a lifeline's id (the name code uses), carrying its messages and notes with it. */
export function renameId(old: string, id: string, name?: string): boolean {
  const ps = seq().participants;
  if (id === old && !name) return true;
  if (!/^[A-Za-z_$][\w.$-]*$/.test(id) || ps.some(x => x.id === id && x.id !== old)) {
    hint(ps.some(x => x.id === id) ? `"${id}" is taken` : 'Ids are letters, digits, - _ . (no spaces)', 2000);
    return false;
  }
  change('sequence', d => {
    const p = d.participants.find(x => x.id === old); if (!p) return;
    p.id = id; if (name) p.name = name;
    for (const r of d.rows) {
      if (r.t === 'msg') { if (r.from === old) r.from = id; if (r.to === old) r.to = id; }
      else if (r.t === 'note') r.over = r.over.map(o => (o === old ? id : o));
    }
  });
  selectOne('part', id);
  return true;
}
/** Link every unlinked lifeline to the component with its name (or id). */
export function linkByName() {
  const sys = openLinkedSystem(); if (!sys) return;
  change('sequence', d => {
    for (const p of d.participants) {
      if (nodeOf(p, sys)) continue;
      const n = sys.doc.nodes.find(x => x.name.toLowerCase() === p.name.toLowerCase() || x.name.toLowerCase() === p.id.toLowerCase());
      if (n) { p.ref = n.id; p.type = n.kind; }
    }
  });
}

// ---------- rows ----------

/** Insert a message at row index `at`, select it and start typing its label. */
export function insertMessage(from: string, to: string, at: number, style: MsgStyle) {
  const r: Row = { t: 'msg', id: rowId(), from, to, label: '', style: from === to ? 'sync' : style };
  change('sequence', d => { d.rows.splice(at, 0, r); });
  selectOne('row', r.id);
  requestAnimationFrame(() => startEdit(r.id));
}
/** Move `span` rows starting at `id` so they land before what is now at index `to`. Blocks stay well-formed. */
export function moveRows(id: string, span: number, to: number) {
  const rows = seq().rows, from = rows.findIndex(r => r.id === id); if (from < 0) return;
  const next = rows.slice(), chunk = next.splice(from, span);
  const at = to > from ? to - span : to;
  if (at === from) return;
  next.splice(Math.max(0, Math.min(at, next.length)), 0, ...chunk);
  if (!balanced(next)) { hint("Can't move it there: it would break up a block", 1800); return; }
  change('sequence', d => { d.rows = next as typeof d.rows; });
}
/** The selected rows as a range of indexes (a selected block header takes its whole block). */
function selectedRange(): [number, number] | null {
  const rows = seq().rows, ids = new Set(selectedRows());
  const idx = rows.map((r, i) => (ids.has(r.id) ? i : -1)).filter(i => i >= 0);
  if (!idx.length) return null;
  const lo = Math.min(...idx); let hi = Math.max(...idx);
  for (const i of idx) if (rows[i].t === 'open') hi = Math.max(hi, blockEnd(rows, i));
  return [lo, hi];
}
const DEFAULT_GUARD: Record<BlockKind, string> = { loop: 'for each item', opt: 'if needed', par: '', alt: 'condition' };
/** Wrap the selected rows in a block (or add an empty one) and start typing its guard. */
export function wrapInBlock(kind: BlockKind) {
  const range = selectedRange();
  const open: Row = { t: 'open', id: rowId(), kind, guard: DEFAULT_GUARD[kind] };
  const close: Row = { t: 'close', id: rowId() };
  const next = seq().rows.slice();
  if (range) { next.splice(range[1] + 1, 0, close); next.splice(range[0], 0, open); } else next.push(open, close);
  if (!balanced(next)) { hint('Select whole messages or blocks to wrap — a block can\'t start inside another and end outside it', 2600); return; }
  change('sequence', d => { d.rows = next as typeof d.rows; });
  selectOne('row', open.id);
  requestAnimationFrame(() => startEdit(open.id));
}
/** A note after the selected row (over its lifelines), or over the selected lifeline. */
export function addNote() {
  const d = seq(), rows = d.rows, ps = d.participants;
  if (!ps.length) { hint('Add a participant first', 1600); return; }
  const s = sel();
  let over = [ps[0].id], at = rows.length;
  if (s?.type === 'part') over = [s.ids[0]];
  const i = s?.type === 'row' ? rows.findIndex(r => r.id === s.ids[0]) : -1;
  if (i >= 0) {
    const r = rows[i];
    at = r.t === 'open' ? blockEnd(rows, i) + 1 : i + 1;
    if (r.t === 'msg') over = r.from === r.to ? [r.from] : [r.from, r.to];
  }
  const n: Row = { t: 'note', id: rowId(), over, text: '' };
  change('sequence', dd => { dd.rows.splice(at, 0, n); });
  selectOne('row', n.id);
  requestAnimationFrame(() => startEdit(n.id));
}
/** The reply to a call, right after it. */
export function addReply(callId: string) {
  const rows = seq().rows, i = rows.findIndex(x => x.id === callId), r = rows[i]; if (r?.t !== 'msg') return;
  const rep: Row = { t: 'msg', id: rowId(), from: r.to, to: r.from, label: '', style: 'reply' };
  change('sequence', d => { d.rows.splice(i + 1, 0, rep); });
  selectOne('row', rep.id);
  requestAnimationFrame(() => startEdit(rep.id));
}
/** Rows from `rows` without block `openIndex`'s markers (its open, close and own branches); the body stays. */
function unwrapped(rows: Row[], openIndex: number): Row[] {
  const e = blockEnd(rows, openIndex), depth = depthOf(rows, openIndex) + 1;
  return rows.filter((x, k) => k !== openIndex && k !== e && !(k > openIndex && k < e && x.t === 'else' && depthOf(rows, k) === depth));
}
export function unwrap(openId: string) {
  change('sequence', d => { const i = d.rows.findIndex(x => x.id === openId); if (i >= 0) d.rows = unwrapped(d.rows as Row[], i) as typeof d.rows; });
  select(null);
}
export function addBranch(openId: string) {
  change('sequence', d => { const i = d.rows.findIndex(x => x.id === openId); if (i >= 0) d.rows.splice(blockEnd(d.rows as Row[], i), 0, { t: 'else', id: rowId(), guard: '' }); });
}
export const removeRow = (id: string) => change('sequence', d => { d.rows = d.rows.filter(x => x.id !== id); });

// ---------- commands (Delete, ⌘D, ⌘A) ----------

/** Delete the selection. A lifeline goes with its messages; a block is unwrapped, keeping what's inside. */
export function removeSelection() {
  const s = sel(); if (!s) return;
  if (s.type === 'part') {
    const pid = s.ids[0];
    const n = seq().rows.filter(r => r.t === 'msg' && (r.from === pid || r.to === pid)).length;
    change('sequence', d => {
      d.participants = d.participants.filter(p => p.id !== pid);
      d.rows = d.rows
        .filter(r => !(r.t === 'msg' && (r.from === pid || r.to === pid)))
        .map(r => (r.t === 'note' ? { ...r, over: r.over.filter(o => o !== pid) } : r))
        .filter(r => r.t !== 'note' || r.over.length);
    });
    if (n) hint(`Removed with its ${n} message${n === 1 ? '' : 's'}`, 1600);
  } else if (s.type === 'row') {
    change('sequence', d => {
      let next = d.rows.slice() as Row[];
      for (const id of s.ids) {
        const i = next.findIndex(r => r.id === id), r = next[i]; if (!r) continue;
        if (r.t === 'open') next = unwrapped(next, i);
        else if (r.t !== 'close') next.splice(i, 1);
      }
      d.rows = next as typeof d.rows;
    });
  } else return;
  select(null);
}
/** ⌘D: a copy of the selected message or note right below it. */
export function duplicateSelection() {
  const id = selectedRows()[0]; if (!id) return;
  const rows = seq().rows, i = rows.findIndex(r => r.id === id), r = rows[i];
  if (r?.t !== 'msg' && r?.t !== 'note') return;
  const copy = { ...structuredClone(r), id: rowId() } as Row;
  change('sequence', d => { d.rows.splice(i + 1, 0, copy); });
  selectOne('row', copy.id);
}
/** ⌘A: every message and note. */
export function selectAll() {
  const ids = seq().rows.filter(r => r.t === 'msg' || r.t === 'note').map(r => r.id);
  select(ids.length ? { type: 'row', ids } : null);
}

// ---------- the rail's tools ----------

export const TOOL_NAMES = ['participant', 'sync', 'async', 'reply', 'note', ...BLOCK_KINDS] as const;
/** A rail tool (or its key): add a lifeline or note, wrap in a block, or pick the kind of message to draw. */
export function seqTool(name: string) {
  if (name === 'participant') { addParticipant(); return; }
  if (name === 'note') { addNote(); return; }
  if ((BLOCK_KINDS as string[]).includes(name)) { wrapInBlock(name as BlockKind); return; }
  if (name !== 'sync' && name !== 'async' && name !== 'reply') return;
  useSeqUi.setState({ tool: name });
  const id = selectedRows()[0], r = id ? seq().rows.find(x => x.id === id) : undefined;
  if (r?.t === 'msg' && r.style !== name) change('sequence', d => { const m = d.rows.find(x => x.id === id); if (m?.t === 'msg') m.style = name; });
  else hint(`Drag from one lifeline to another to draw a${name === 'async' ? 'n async message' : name === 'reply' ? ' reply' : ' call'}`, 2000);
}
