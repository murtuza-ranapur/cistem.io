/**
 * Sequence diagrams: model, text format, imports (Mermaid, PlantUML), layout and timing.
 * Pure — no DOM — so it's unit-tested and mirrored by the server (io.cistem.engine.Seq).
 *
 * The model is a list of participants (lifelines) and a flat list of rows. Blocks (alt/opt/loop/par)
 * are rows too — open, else, close — like the text form, so inserting or moving a message is just
 * moving a row.
 *
 * Text format:
 *   participant merchants, proxy                 plain lifelines, in order
 *   participant ecom "ecom-transaction-payments" service @n3
 *                                               id, display name, component type, linked component
 *   merchants -> proxy: POST /uploads            call       (->)
 *   proxy --> merchants: 202 Accepted            reply      (-->)
 *   ecom ->> items: publish item                 async      (->>)
 *   note over proxy, ecom: text
 *   alt merchant on legacy / else / end          also opt, loop, par (with `and` branches)
 *   # a comment                                  (whole lines starting with # or //)
 */
import { itemNotes, type CanvasNote } from './notes';
import type { Doc } from './model';
import type { Results } from './engine';

export type MsgStyle = 'sync' | 'async' | 'reply';
export type BlockKind = 'alt' | 'opt' | 'loop' | 'par';
export const BLOCK_KINDS: BlockKind[] = ['alt', 'opt', 'loop', 'par'];
export interface Participant { id: string; name: string; type?: string; ref?: string; notes?: string }
export type Row =
  | { t: 'msg'; id: string; from: string; to: string; label: string; style: MsgStyle }
  | { t: 'note'; id: string; over: string[]; text: string }
  | { t: 'open'; id: string; kind: BlockKind; guard: string }
  | { t: 'else'; id: string; guard: string }
  | { t: 'close'; id: string };
/** The system diagram this sequence draws on: its cloud id when saved, else the tab it lives in. */
export interface SeqUses { id?: string; tab?: string; title?: string }
export interface SeqDoc { participants: Participant[]; rows: Row[]; uses?: SeqUses; notes?: CanvasNote[] }
export interface SeqError { line: number; message: string }

export const blankSeq = (): SeqDoc => ({ participants: [], rows: [] });
const ARROW: Record<MsgStyle, string> = { sync: '->', reply: '-->', async: '->>' };
const ID_RE = /^[A-Za-z_$][\w.$-]*$/;

let seq = 0;
export const rowId = () => 'r' + Date.now().toString(36).slice(-4) + (seq++).toString(36);

/** A lifeline id from a display name: lower-case, dashes, unique among `taken`. */
export function slugId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = name.trim().toLowerCase().replace(/[^\w.$-]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'p$1') || 'p';
  if (!/^[A-Za-z_$]/.test(base)) base = 'p' + base;
  let id = base, i = 2;
  while (used.has(id)) id = `${base}${i++}`;
  return id;
}

// ---------- text ----------

export function printSeq(d: SeqDoc): string {
  const out: string[] = [];
  let plain: string[] = [];
  const flush = () => { if (plain.length) out.push('participant ' + plain.join(', ')); plain = []; };
  for (const p of d.participants) {
    const simple = p.name === p.id && !p.type && !p.ref;
    if (simple) { plain.push(p.id); continue; }
    flush();
    out.push(`participant ${p.id}${p.name !== p.id ? ` "${p.name.replace(/"/g, "'")}"` : ''}${p.type ? ' ' + p.type : ''}${p.ref ? ' @' + p.ref : ''}`);
  }
  flush();
  if (d.rows.length && out.length) out.push('');
  let depth = 0;
  const kinds: BlockKind[] = [];
  for (const r of d.rows) {
    if (r.t === 'close' || r.t === 'else') depth = Math.max(0, depth - 1);
    const ind = '  '.repeat(depth);
    if (r.t === 'msg') out.push(`${ind}${r.from} ${ARROW[r.style]} ${r.to}${r.label ? ': ' + r.label : ''}`);
    else if (r.t === 'note') out.push(`${ind}note over ${r.over.join(', ')}${r.text ? ': ' + r.text.replace(/\n/g, ' ') : ''}`);
    else if (r.t === 'open') { out.push(`${ind}${r.kind}${r.guard ? ' ' + r.guard : ''}`); kinds.push(r.kind); depth++; }
    else if (r.t === 'else') { out.push(`${ind}${kinds[kinds.length - 1] === 'par' ? 'and' : 'else'}${r.guard ? ' ' + r.guard : ''}`); depth++; }
    else { out.push(`${ind}end`); kinds.pop(); }
  }
  return out.join('\n') + (out.length ? '\n' : '');
}

interface Builder { d: SeqDoc; errors: SeqError[]; stack: { kind: BlockKind | 'skip'; line: number }[] }
const builder = (): Builder => ({ d: blankSeq(), errors: [], stack: [] });
function ensure(b: Builder, id: string, name = id, type?: string): string {
  if (!b.d.participants.some(p => p.id === id)) b.d.participants.push({ id, name, ...(type ? { type } : {}) });
  return id;
}
function message(b: Builder, from: string, to: string, style: MsgStyle, label: string) {
  ensure(b, from); ensure(b, to);
  b.d.rows.push({ t: 'msg', id: rowId(), from, to, label: label.trim(), style });
}
function open(b: Builder, kind: BlockKind | 'skip', guard: string, line: number) {
  b.stack.push({ kind, line });
  if (kind !== 'skip') b.d.rows.push({ t: 'open', id: rowId(), kind, guard: guard.trim() });
}
function branch(b: Builder, guard: string, line: number) {
  const top = b.stack[b.stack.length - 1];
  if (!top || top.kind === 'skip') { b.errors.push({ line, message: '"else" outside an alt or par block' }); return; }
  if (top.kind !== 'alt' && top.kind !== 'par') { b.errors.push({ line, message: `"else" only belongs in alt or par, not ${top.kind}` }); return; }
  b.d.rows.push({ t: 'else', id: rowId(), guard: guard.trim() });
}
function close(b: Builder, line: number) {
  const top = b.stack.pop();
  if (!top) { b.errors.push({ line, message: '"end" without a block to close' }); return; }
  if (top.kind !== 'skip') b.d.rows.push({ t: 'close', id: rowId() });
}
function finish(b: Builder): { doc: SeqDoc; errors: SeqError[] } {
  for (const s of b.stack.reverse()) {
    if (s.kind === 'skip') continue;
    b.errors.push({ line: s.line, message: `"${s.kind}" is never closed with "end"` });
    b.d.rows.push({ t: 'close', id: rowId() });
  }
  return { doc: b.d, errors: b.errors.sort((x, y) => x.line - y.line) };
}

/** Parse any of the supported texts: this app's format, Mermaid (sequenceDiagram) or PlantUML (@startuml). */
export function parseSeq(text: string): { doc: SeqDoc; errors: SeqError[]; from: 'cistem' | 'mermaid' | 'plantuml' } {
  const first = text.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('%%') && !l.startsWith("'") && !l.startsWith('#') && !l.startsWith('//'));
  if (first && /^sequenceDiagram\b/.test(first)) return { ...parseMermaid(text), from: 'mermaid' };
  if (first && /^@startuml\b/i.test(first)) return { ...parsePlantUml(text), from: 'plantuml' };
  return { ...parseCistem(text), from: 'cistem' };
}

function splitList(s: string) { return s.split(',').map(x => x.trim()).filter(Boolean); }

export function parseCistem(text: string): { doc: SeqDoc; errors: SeqError[] } {
  const b = builder();
  text.split('\n').forEach((raw, line) => {
    // comments are whole lines only: labels may contain # and // ("Order #42", URLs)
    const l = raw.trim();
    if (!l || l.startsWith('#') || l.startsWith('//')) return;
    let m: RegExpExecArray | null;
    if ((m = /^(participant|actor)\s+(.+)$/i.exec(l))) {
      const rest = m[2].trim(), actor = m[1].toLowerCase() === 'actor';
      if (!rest.includes('"') && rest.includes(',')) {
        for (const id of splitList(rest)) { if (!ID_RE.test(id)) { b.errors.push({ line, message: `"${id}" isn't a valid name: use letters, digits, - _ .` }); continue; } ensure(b, id, id, actor ? 'actor' : undefined); }
        return;
      }
      const pm = /^([A-Za-z_$][\w.$-]*)(?:\s+"([^"]*)")?(?:\s+([A-Za-z][\w-]*))?(?:\s+@([\w.$-]+))?\s*$/.exec(rest);
      if (!pm) { b.errors.push({ line, message: 'Expected: participant id "Name" type @component' }); return; }
      const [, id, name, type, ref] = pm;
      if (b.d.participants.some(p => p.id === id)) { b.errors.push({ line, message: `"${id}" is already declared` }); return; }
      b.d.participants.push({ id, name: name ?? id, ...(type || actor ? { type: type ?? 'actor' } : {}), ...(ref ? { ref } : {}) });
      return;
    }
    if ((m = /^note\s+(?:over|left of|right of)\s+([^:]+?)\s*(?::\s*(.*))?$/i.exec(l))) {
      const over = splitList(m[1]);
      for (const id of over) if (!ID_RE.test(id)) { b.errors.push({ line, message: `"${id}" isn't a participant name` }); return; }
      over.forEach(id => ensure(b, id));
      b.d.rows.push({ t: 'note', id: rowId(), over, text: (m[2] ?? '').trim() });
      return;
    }
    if ((m = /^(alt|opt|loop|par)\b\s*(.*)$/i.exec(l))) { open(b, m[1].toLowerCase() as BlockKind, m[2], line); return; }
    if ((m = /^(else|and)\b\s*(.*)$/i.exec(l))) { branch(b, m[2], line); return; }
    if (/^end$/i.test(l)) { close(b, line); return; }
    if ((m = /^(\S+?)\s*(->>|-->|->)\s*(\S+?)\s*(?::\s*(.*))?$/.exec(l))) {
      const [, from, arrow, to, label] = m;
      for (const id of [from, to]) if (!ID_RE.test(id)) { b.errors.push({ line, message: `"${id}" isn't a valid name: use letters, digits, - _ .` }); return; }
      message(b, from, to, arrow === '->>' ? 'async' : arrow === '-->' ? 'reply' : 'sync', label ?? '');
      return;
    }
    b.errors.push({ line, message: 'Not understood. Try  a -> b: label,  note over a: text,  alt / else / end' });
  });
  return finish(b);
}

/** Mermaid ids can be anything without spaces; keep them if valid, else derive one. */
function idFor(b: Builder, alias: Map<string, string>, raw: string, name?: string, type?: string): string {
  raw = raw.trim();
  const have = alias.get(raw); if (have) return have;
  const id = ID_RE.test(raw) && !b.d.participants.some(p => p.id === raw) ? raw : slugId(raw, b.d.participants.map(p => p.id));
  alias.set(raw, id);
  ensure(b, id, name ?? raw, type);
  return id;
}

export function parseMermaid(text: string): { doc: SeqDoc; errors: SeqError[] } {
  const b = builder(), alias = new Map<string, string>();
  text.split('\n').forEach((raw, line) => {
    const l = raw.replace(/%%.*$/, '').trim();
    if (!l || /^sequenceDiagram\b/.test(l) || /^(autonumber|activate|deactivate|title|create|destroy|link|links|properties|details)\b/i.test(l)) return;
    let m: RegExpExecArray | null;
    if ((m = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(l))) { idFor(b, alias, m[2], m[3]?.trim(), m[1].toLowerCase() === 'actor' ? 'actor' : undefined); return; }
    if ((m = /^note\s+(?:over|left of|right of)\s+([^:]+?)\s*:\s*(.*)$/i.exec(l))) {
      b.d.rows.push({ t: 'note', id: rowId(), over: splitList(m[1]).map(x => idFor(b, alias, x)), text: m[2].replace(/<br\s*\/?>/gi, ' ').trim() });
      return;
    }
    if ((m = /^(alt|opt|loop|par|critical|break)\b\s*(.*)$/i.exec(l))) {
      const k = m[1].toLowerCase(); open(b, k === 'critical' || k === 'break' ? 'opt' : k as BlockKind, m[2], line); return;
    }
    if ((m = /^(rect|box)\b/i.exec(l))) { open(b, 'skip', '', line); return; }
    if ((m = /^(else|and|option)\b\s*(.*)$/i.exec(l))) { branch(b, m[2], line); return; }
    if (/^end$/i.test(l)) { close(b, line); return; }
    if ((m = /^([^-\s][^\s]*?)\s*(-->>|->>|-->|->|--x|-x|--\)|-\))\s*[+-]?\s*([^:]+?)\s*(?::\s*(.*))?$/.exec(l))) {
      const [, f, arrow, t, label] = m;
      const style: MsgStyle = arrow.endsWith(')') ? 'async' : arrow.startsWith('--') ? 'reply' : 'sync';
      message(b, idFor(b, alias, f), idFor(b, alias, t), style, label ?? '');
      return;
    }
    b.errors.push({ line, message: 'Mermaid line not understood' });
  });
  return finish(b);
}

const PUML_TYPE: Record<string, string | undefined> = { actor: 'actor', database: 'db', queue: 'queue', participant: undefined, boundary: undefined, control: undefined, entity: undefined, collections: undefined };
export function parsePlantUml(text: string): { doc: SeqDoc; errors: SeqError[] } {
  const b = builder(), alias = new Map<string, string>();
  const lines = text.split('\n');
  for (let line = 0; line < lines.length; line++) {
    const l = lines[line].replace(/^\s*'.*$/, '').trim();
    if (!l || /^@(start|end)uml/i.test(l) || /^(skinparam|title|autonumber|activate|deactivate|hide|show|header|footer|legend|newpage|create|destroy|return\b)/i.test(l) || /^(==.*==|\.\.\..*|\|\|\|?\d*\|?)$/.test(l)) continue;
    let m: RegExpExecArray | null;
    if ((m = /^(participant|actor|database|queue|boundary|control|entity|collections)\s+(?:"([^"]+)"\s+as\s+(\S+)|(\S+)\s+as\s+"([^"]+)"|(\S+?)(?:\s+as\s+(\S+))?)(?:\s+(?:order\s+\d+|#\S+|<<.*>>))*\s*$/i.exec(l))) {
      const type = PUML_TYPE[m[1].toLowerCase()];
      if (m[2]) idFor(b, alias, m[3], m[2], type);
      else if (m[4]) idFor(b, alias, m[4], m[5], type);
      else if (m[7]) idFor(b, alias, m[7], m[6].replace(/"/g, ''), type);
      else idFor(b, alias, m[6].replace(/"/g, ''), undefined, type);
      continue;
    }
    if ((m = /^(?:r|h)?note\s+(?:over|left of|right of)\s+([^:]+?)\s*(?::\s*(.*))?$/i.exec(l))) {
      const over = splitList(m[1]).map(x => idFor(b, alias, x.replace(/"/g, '')));
      let text = m[2] ?? '';
      if (m[2] === undefined) { const body: string[] = []; while (++line < lines.length && !/^\s*end\s*(r|h)?note/i.test(lines[line])) body.push(lines[line].trim()); text = body.join(' '); }
      b.d.rows.push({ t: 'note', id: rowId(), over, text: text.trim() });
      continue;
    }
    if ((m = /^(alt|opt|loop|par|group|break|critical)\b\s*(.*)$/i.exec(l))) {
      const k = m[1].toLowerCase(); open(b, k === 'alt' || k === 'opt' || k === 'loop' || k === 'par' ? k : 'opt', m[2], line); continue;
    }
    if ((m = /^else\b\s*(.*)$/i.exec(l))) { branch(b, m[1], line); continue; }
    if (/^end$/i.test(l)) { close(b, line); continue; }
    const s = l.replace(/\[[^\]]*\]/g, '');   // -[#red]>  →  ->
    if ((m = /^("[^"]+"|[^\s<>-][^\s]*?)\s*(<-->|<->|-->>|->>|-->|->|<--|<<-|<-|-\\\\?|->o|->x)\s*("[^"]+"|[^\s:]+)\s*(?::\s*(.*))?$/.exec(s))) {
      let [, f, arrow, t, label] = m;
      f = f.replace(/"/g, ''); t = t.replace(/"/g, '');
      if (arrow.startsWith('<') && !arrow.endsWith('>')) [f, t] = [t, f];
      const style: MsgStyle = arrow.includes('>>') || arrow.includes('\\') ? 'async' : arrow.includes('--') ? 'reply' : 'sync';
      message(b, idFor(b, alias, f), idFor(b, alias, t), style, label ?? '');
      continue;
    }
    b.errors.push({ line, message: 'PlantUML line not understood' });
  }
  return finish(b);
}

/**
 * Re-use row ids from the previous version where rows line up (same position, same kind), so
 * editing the text doesn't lose what's selected in the drawing.
 */
export function keepIds(prev: SeqDoc, next: SeqDoc): SeqDoc {
  next.rows.forEach((r, i) => { const p = prev.rows[i]; if (p && p.t === r.t) r.id = p.id; });
  // carry links that the text doesn't spell out (uses) over
  if (prev.uses && !next.uses) next.uses = prev.uses;
  return next;
}

/** Blocks must nest: every open has its end, else only inside alt/par. */
export function balanced(rows: Row[]): boolean {
  const st: BlockKind[] = [];
  for (const r of rows) {
    if (r.t === 'open') st.push(r.kind);
    else if (r.t === 'else') { const k = st[st.length - 1]; if (k !== 'alt' && k !== 'par') return false; }
    else if (r.t === 'close') { if (!st.pop()) return false; }
  }
  return st.length === 0;
}
/** Index of the row that closes the block opened at `i`; the else rows in between are its branches. */
export function blockEnd(rows: Row[], i: number): number {
  let depth = 0;
  for (let j = i; j < rows.length; j++) {
    const r = rows[j];
    if (r.t === 'open') depth++;
    else if (r.t === 'close' && --depth === 0) return j;
  }
  return rows.length - 1;
}

// ---------- layout ----------

export const SEQ = { top: 24, headH: 46, firstRow: 98, colGap: 190, headW: 150, msgH: 46, selfH: 66, openH: 40, elseH: 32, closeH: 22, noteLine: 15, x0: 110 };
/** Rough width of label text at 11.5px. Good enough for spacing; the drawing measures nothing. */
export const textW = (s: string) => Math.ceil([...s].reduce((w, c) => w + (/[ il.,:;|!'1]/.test(c) ? 3.6 : /[mwMW@]/.test(c) ? 9.4 : /[A-Z0-9#%&]/.test(c) ? 7.6 : 6.4), 0));

export interface ColGeo { id: string; x: number }
export interface RowGeo { id: string; i: number; y: number; h: number; /** y of the arrow / divider */ ay: number }
export interface BlockGeo { id: string; kind: BlockKind; guard: string; x1: number; x2: number; y1: number; y2: number; elses: { id: string; y: number; guard: string }[]; depth: number }
export interface ActGeo { pid: string; y1: number; y2: number; level: number }
export interface SeqGeo { cols: ColGeo[]; rows: RowGeo[]; blocks: BlockGeo[]; acts: ActGeo[]; width: number; height: number; colX: Record<string, number> }

export function layoutSeq(d: SeqDoc): SeqGeo {
  const n = d.participants.length;
  const idx: Record<string, number> = {}; d.participants.forEach((p, i) => (idx[p.id] = i));
  // gaps between neighbouring lifelines widen for the labels that must fit between them
  const gaps = new Array(Math.max(0, n - 1)).fill(SEQ.colGap);
  d.participants.forEach((p, i) => { if (i < n - 1) gaps[i] = Math.max(gaps[i], (textW(p.name) + textW(d.participants[i + 1].name)) / 2 + 40); });
  let selfRight = 0;
  for (const r of d.rows) {
    if (r.t === 'msg') {
      const a = idx[r.from], b = idx[r.to]; if (a === undefined || b === undefined) continue;
      const w = textW(r.label) + 44;
      if (a === b) { if (a < n - 1) gaps[a] = Math.max(gaps[a], w + 20); else selfRight = Math.max(selfRight, w); continue; }
      const lo = Math.min(a, b), hi = Math.max(a, b), have = gaps.slice(lo, hi).reduce((s, g) => s + g, 0);
      if (have < w) { const extra = (w - have) / (hi - lo); for (let k = lo; k < hi; k++) gaps[k] += extra; }
    } else if (r.t === 'note' && r.over.length === 1) {
      const a = idx[r.over[0]]; if (a === undefined) continue;
      const w = Math.min(260, textW(r.text) + 24);
      if (a < n - 1) gaps[a] = Math.max(gaps[a], w / 2 + 70);
      if (a > 0) gaps[a - 1] = Math.max(gaps[a - 1], w / 2 + 70);
    }
  }
  const cols: ColGeo[] = []; const colX: Record<string, number> = {};
  let x = SEQ.x0;
  d.participants.forEach((p, i) => { cols.push({ id: p.id, x }); colX[p.id] = x; x += gaps[i] ?? 0; });

  // rows, top to bottom
  const rows: RowGeo[] = [];
  let y = SEQ.firstRow;
  d.rows.forEach((r, i) => {
    let h: number, ay: number;
    if (r.t === 'msg') { h = r.from === r.to ? SEQ.selfH : SEQ.msgH; ay = y + (r.from === r.to ? 24 : 30); }
    else if (r.t === 'note') { const lines = Math.max(1, Math.ceil(textW(r.text) / 230)); h = 18 + lines * SEQ.noteLine + 8; ay = y + 8; }
    else if (r.t === 'open') { h = SEQ.openH; ay = y + 8; }
    else if (r.t === 'else') { h = SEQ.elseH; ay = y + 10; }
    else { h = SEQ.closeH; ay = y + 8; }
    rows.push({ id: r.id, i, y, h, ay }); y += h;
  });
  // lifelines run on past the last row so there's always room to drag a new message in below it
  const height = Math.max(y + 130, SEQ.firstRow + 360);

  // blocks: span the lifelines their rows touch, a little wider for each block nested inside
  const blocks: BlockGeo[] = [];
  const stack: { b: BlockGeo; lo: number; hi: number; inner: number; selfR: number }[] = [];
  d.rows.forEach((r, i) => {
    const g = rows[i];
    const touch = (ids: string[], selfW = 0) => {
      for (const s of stack) for (const id of ids) {
        const k = idx[id]; if (k === undefined) continue;
        s.lo = Math.min(s.lo, k); s.hi = Math.max(s.hi, k);
        if (selfW) s.selfR = Math.max(s.selfR, colX[id] + selfW);
      }
    };
    if (r.t === 'open') { const b: BlockGeo = { id: r.id, kind: r.kind, guard: r.guard, x1: 0, x2: 0, y1: g.ay, y2: g.ay, elses: [], depth: stack.length }; stack.push({ b, lo: Infinity, hi: -Infinity, inner: 0, selfR: 0 }); blocks.push(b); }
    else if (r.t === 'else') { const s = stack[stack.length - 1]; if (s) s.b.elses.push({ id: r.id, y: g.ay, guard: r.guard }); }
    else if (r.t === 'close') {
      const s = stack.pop(); if (!s) return;
      if (s.lo === Infinity) { s.lo = 0; s.hi = Math.max(0, n - 1); }
      const pad = 64 + s.inner * 12;
      s.b.x1 = (cols[s.lo]?.x ?? SEQ.x0) - pad; s.b.x2 = Math.max((cols[s.hi]?.x ?? SEQ.x0) + pad, s.selfR + 14 + s.inner * 12);
      s.b.y2 = g.ay;
      const parent = stack[stack.length - 1];
      if (parent) { parent.lo = Math.min(parent.lo, s.lo); parent.hi = Math.max(parent.hi, s.hi); parent.inner = Math.max(parent.inner, s.inner + 1); parent.selfR = Math.max(parent.selfR, s.selfR + 12); }
    }
    else if (r.t === 'msg') touch([r.from, r.to], r.from === r.to ? textW(r.label) + 54 : 0);
    else if (r.t === 'note') touch(r.over);
  });

  const acts = activations(d, rows);
  const right = Math.max(...cols.map(c => c.x + SEQ.headW / 2), ...blocks.map(b => b.x2), (cols[n - 1]?.x ?? 0) + selfRight + 30, 0);
  return { cols, rows, blocks, acts, width: right + 40, height, colX };
}

/**
 * Activation bars: a call opens one on the callee; the callee's reply to that caller closes it (and
 * anything opened above it). Calls never answered stay open until that lifeline's last involvement.
 */
export function activations(d: SeqDoc, rows: RowGeo[]): ActGeo[] {
  const out: ActGeo[] = [];
  const open: { pid: string; caller: string; y1: number; level: number }[] = [];
  const lastSeen: Record<string, number> = {};
  const levelOf = (pid: string) => open.filter(o => o.pid === pid).length;
  d.rows.forEach((r, i) => {
    if (r.t !== 'msg') return;
    const y = rows[i].ay;
    lastSeen[r.from] = y; lastSeen[r.to] = y;
    if (r.style === 'sync') {
      if (r.from === r.to) { out.push({ pid: r.to, y1: y + 8, y2: y + 30, level: levelOf(r.to) + 1 }); return; }
      open.push({ pid: r.to, caller: r.from, y1: y, level: levelOf(r.to) });
    } else if (r.style === 'reply') {
      for (let k = open.length - 1; k >= 0; k--) {
        if (open[k].pid === r.from && open[k].caller === r.to) {
          for (const o of open.splice(k)) out.push({ pid: o.pid, y1: o.y1, y2: Math.max(y, o.y1 + 16), level: o.level });
          break;
        }
      }
    }
  });
  for (const o of open) out.push({ pid: o.pid, y1: o.y1, y2: Math.max((lastSeen[o.pid] ?? o.y1) + 12, o.y1 + 24), level: o.level });
  return out;
}

// ---------- timing from the capacity model ----------

/**
 * Time along the sequence, using the linked system diagram's computed latencies: each call or async
 * hand-off to a linked component adds that component's effective latency (plus any environment
 * crossing on the edge between the two). Replies add nothing. Returns the running total after each
 * row that added time, and the end-to-end total.
 */
export function timing(d: SeqDoc, sys: Doc | null, res: Results | null): { at: Record<string, number>; total: number; linked: number } {
  const at: Record<string, number> = {};
  if (!sys || !res) return { at, total: 0, linked: 0 };
  const refOf: Record<string, string | undefined> = {};
  d.participants.forEach(p => { refOf[p.id] = p.ref && sys.nodes.some(n => n.id === p.ref) ? p.ref : undefined; });
  let t = 0;
  for (const r of d.rows) {
    if (r.t !== 'msg' || r.style === 'reply') continue;
    const to = refOf[r.to], from = refOf[r.from];
    if (!to || r.from === r.to) continue;
    const nr = res.nodes[to]; if (!nr) continue;
    const e = from ? sys.edges.find(x => x.from === from && x.to === to) : undefined;
    t += nr.lat + (e ? res.crossings[e.id] ?? 0 : 0);
    at[r.id] = t;
  }
  return { at, total: t, linked: Object.values(refOf).filter(Boolean).length };
}

// ---------- made from a system diagram ----------

const isAsyncKind = (k: string, asyncKinds: Set<string>) => asyncKinds.has(k);
/**
 * Follow the calls from one component through a system diagram and write them down as a sequence:
 * a call per edge (labelled with the endpoint when the edge names one), the callee's reply after its
 * own calls, and async hand-offs through queues to their consumers.
 */
export function sequenceFromPath(sys: Doc, startId: string, asyncKinds: Set<string>, uses?: SeqUses): SeqDoc {
  const d: SeqDoc = { participants: [], rows: [], ...(uses ? { uses } : {}) };
  const byId = new Map(sys.nodes.map(n => [n.id, n]));
  const pid: Record<string, string> = {};
  const part = (nodeId: string) => {
    if (pid[nodeId]) return pid[nodeId];
    const n = byId.get(nodeId)!;
    const id = slugId(n.name || n.kind, d.participants.map(p => p.id));
    d.participants.push({ id, name: n.name || n.kind, type: n.kind, ref: n.id });
    return (pid[nodeId] = id);
  };
  /** One message per endpoint the connection calls (its first endpoint if it lists none). */
  const labelsFor = (e: { to: string; endpoints?: { i: number }[] }) => {
    const n = byId.get(e.to)!;
    const eps = (e.endpoints?.length ? e.endpoints.map(x => n.endpoints?.[x.i]) : [n.endpoints?.[0]]).filter(Boolean) as { method: string; path: string }[];
    if (eps.length) return eps.map(ep => `${ep.method} ${ep.path}`);
    if (n.tables?.length) return ['query ' + n.tables[0].name];
    return ['request'];
  };
  const visiting = new Set<string>(); let budget = 120;
  const visit = (nodeId: string) => {
    if (visiting.has(nodeId) || budget <= 0) return;
    visiting.add(nodeId);
    for (const e of sys.edges.filter(x => x.from === nodeId)) {
      const to = byId.get(e.to); if (!to || budget-- <= 0) continue;
      const from = part(nodeId), callee = part(e.to);
      if (isAsyncKind(to.kind, asyncKinds)) {
        d.rows.push({ t: 'msg', id: rowId(), from, to: callee, label: 'publish' + (to.name ? ' ' + to.name : ''), style: 'async' });
        for (const c of sys.edges.filter(x => x.from === e.to)) {
          if (!byId.has(c.to) || visiting.has(c.to)) continue;
          d.rows.push({ t: 'msg', id: rowId(), from: callee, to: part(c.to), label: 'consume', style: 'async' });
          visit(c.to);
        }
        continue;
      }
      labelsFor(e).forEach((label, k) => {
        d.rows.push({ t: 'msg', id: rowId(), from, to: callee, label, style: 'sync' });
        if (k === 0) visit(e.to);   // what the callee does next is drawn once
        d.rows.push({ t: 'msg', id: rowId(), from: callee, to: from, label: 'response', style: 'reply' });
      });
    }
    visiting.delete(nodeId);
  };
  part(startId);
  visit(startId);
  return d;
}

// ---------- reading untrusted documents ----------

const STYLES: MsgStyle[] = ['sync', 'async', 'reply'];
const safeId = (v: unknown) => String(v ?? '').replace(/[^\w.$-]/g, '');
const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? '' : String(v));
/**
 * A sequence from a file, the server or MCP, made safe to edit and draw: every enum is one the app knows,
 * ids are plain identifiers and unique, rows reference lifelines that exist, and blocks are balanced.
 */
export function sanitizeSeq(raw: unknown): SeqDoc {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const participants: Participant[] = [], idMap = new Map<string, string>();
  for (const p of Array.isArray(m.participants) ? m.participants : []) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    let id = safeId(o.id);
    if (!ID_RE.test(id) || participants.some(x => x.id === id)) id = slugId(str(o.name) || id || 'p', participants.map(x => x.id));
    if (!idMap.has(str(o.id))) idMap.set(str(o.id), id);
    const type = safeId(o.type).replace(/[.$]/g, '');
    participants.push({ id, name: str(o.name) || id, ...(type ? { type } : {}), ...(o.ref ? { ref: safeId(o.ref) } : {}), ...itemNotes(o.notes) });
  }
  const has = (id: string) => participants.some(p => p.id === id);
  const ref = (v: unknown) => idMap.get(str(v)) ?? safeId(v);   // rows follow lifelines whose ids were cleaned
  const rows: Row[] = [], seen = new Set<string>();
  const freshId = (v: unknown) => { let id = safeId(v); if (!id || seen.has(id)) id = rowId(); seen.add(id); return id; };
  for (const r of Array.isArray(m.rows) ? m.rows : []) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (o.t === 'msg') {
      const from = ref(o.from), to = ref(o.to);
      if (!has(from) || !has(to)) continue;
      rows.push({ t: 'msg', id: freshId(o.id), from, to, label: str(o.label), style: STYLES.includes(o.style as MsgStyle) ? o.style as MsgStyle : 'sync' });
    } else if (o.t === 'note') {
      const over = (Array.isArray(o.over) ? o.over : []).map(ref).filter(has);
      if (!over.length) continue;
      rows.push({ t: 'note', id: freshId(o.id), over, text: str(o.text) });
    } else if (o.t === 'open') rows.push({ t: 'open', id: freshId(o.id), kind: BLOCK_KINDS.includes(o.kind as BlockKind) ? o.kind as BlockKind : 'opt', guard: str(o.guard) });
    else if (o.t === 'else') rows.push({ t: 'else', id: freshId(o.id), guard: str(o.guard) });
    else if (o.t === 'close') rows.push({ t: 'close', id: freshId(o.id) });
  }
  // balance: drop stray else/end, close what's left open
  const out: Row[] = [], st: BlockKind[] = [];
  for (const r of rows) {
    if (r.t === 'open') st.push(r.kind);
    else if (r.t === 'else') { const k = st[st.length - 1]; if (k !== 'alt' && k !== 'par') continue; }
    else if (r.t === 'close') { if (!st.length) continue; st.pop(); }
    out.push(r);
  }
  while (st.pop()) out.push({ t: 'close', id: rowId() });
  const u = m.uses && typeof m.uses === 'object' ? m.uses as Record<string, unknown> : null;
  const uses = u ? { ...(u.id ? { id: safeId(u.id) } : {}), ...(u.tab ? { tab: safeId(u.tab) } : {}), ...(u.title ? { title: str(u.title) } : {}) } : null;
  return { participants, rows: out, ...(uses && (uses.id || uses.tab) ? { uses } : {}) };
}
