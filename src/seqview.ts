/**
 * The sequence diagram editor: drawing, direct manipulation, the left-rail tools and the details panel.
 *
 * Drawing is derived entirely from the model (layoutSeq) — nothing is positioned by hand — so the
 * gestures are about order: drag from one lifeline to another to insert a message where you let go,
 * drag a message up or down to move it, drag a lifeline's head sideways to reorder.
 */
import { state, esc, on, renderCanvas, renderAll, mutate, select, onAfterRender } from './state';
import { layoutSeq, timing, printSeq, parseSeq, keepIds, balanced, blockEnd, rowId, slugId, textW, SEQ, BLOCK_KINDS, type SeqDoc, type Row, type MsgStyle, type BlockKind, type Participant, type SeqGeo } from './seq';
import { typeDef, TYPES, type Doc } from './model';
import { compute, type Results } from './engine';
import { setSequenceView, applyView, hint, fmtMs } from './canvas';
import * as history from './history';
import { tabs, peek, tabFor, systemTabs, usesFor } from './tabs';
import { api } from './api';
import { signedIn } from './cloud';
import { setSequencePanel } from './sheet';

const $ = <T extends Element>(id: string) => document.getElementById(id) as unknown as T;
const svg = $<SVGSVGElement>('seqSvg'), world = $<SVGGElement>('seqWorld');
const stage = $<HTMLElement>('stage'), emptyEl = $<HTMLElement>('seqEmpty'), editBox = $<HTMLInputElement>('seqEdit');
const gridPattern = $<SVGPatternElement>('grid');
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const seq = () => state.seq;
const isSeq = () => state.kind === 'sequence';

// ---------- the linked system diagram ----------
const fetched = new Map<string, Doc>();   // system diagrams not open on this device, fetched once
const fetching = new Set<string>();
/** The system diagram this sequence uses, with its capacity results; null when unlinked or unavailable. */
export function linkedSystem(): { doc: Doc; res: Results; title: string; key?: string } | null {
  const u = seq().uses; if (!u) return null;
  const t = tabFor(u);
  if (t) { const p = peek(t.key); if (p?.doc) return { doc: p.doc, res: compute(p.doc), title: p.title, key: t.key }; }
  if (u.id) {
    const d = fetched.get(u.id);
    if (d) return { doc: d, res: compute(d), title: u.title ?? 'system' };
    if (signedIn() && !fetching.has(u.id)) {
      fetching.add(u.id);
      api.get(u.id).then(s => { if ((s.document as any).kind !== 'sequence') { import('./document').then(m => { fetched.set(u.id!, m.fromFile(s.document).doc); if (isSeq()) renderAll(); }); } }).catch(() => {});
    }
  }
  return null;
}
const nodeOf = (p: Participant | undefined, sys: { doc: Doc } | null) => p?.ref && sys ? sys.doc.nodes.find(n => n.id === p.ref) : undefined;

// ---------- view ----------
let geo: SeqGeo = layoutSeq({ participants: [], rows: [] });
function apply() {
  world.setAttribute('transform', `translate(${state.view.x} ${state.view.y}) scale(${state.view.k})`);
  let step = 24 * state.view.k; while (step < 12) step *= 2;
  gridPattern.setAttribute('width', String(step)); gridPattern.setAttribute('height', String(step));
  gridPattern.setAttribute('x', String(state.view.x)); gridPattern.setAttribute('y', String(state.view.y));
  const dot = gridPattern.querySelector('circle')!; dot.setAttribute('cx', String(step / 2)); dot.setAttribute('cy', String(step / 2));
}
function fit(animated = true) {
  const r = stage.getBoundingClientRect(); if (!r.width) return;
  const w = Math.max(geo.width, 400), h = Math.max(geo.height, 300);
  const k = Math.min(1, Math.max(0.4, Math.min((r.width - 60) / w, (r.height - 40) / h)));
  // sequences read top-down: pin the heads near the top rather than centring vertically
  const target = { k, x: Math.max(20, (r.width - w * k) / 2), y: 14 };
  if (!animated || reduceMotion()) { Object.assign(state.view, target); applyView(); return; }
  const from = { ...state.view }, t0 = performance.now();
  const tick = (now: number) => { const t = Math.min(1, (now - t0) / 220), e = 1 - Math.pow(1 - t, 3); state.view.k = from.k + (target.k - from.k) * e; state.view.x = from.x + (target.x - from.x) * e; state.view.y = from.y + (target.y - from.y) * e; applyView(); if (t < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
setSequenceView({ apply, fit });
const toWorld = (cx: number, cy: number) => { const r = svg.getBoundingClientRect(); return { x: (cx - r.left - state.view.x) / state.view.k, y: (cy - r.top - state.view.y) / state.view.k }; };
const toScreen = (x: number, y: number) => { const r = stage.getBoundingClientRect(); return { x: x * state.view.k + state.view.x, y: y * state.view.k + state.view.y, r }; };

// ---------- drawing ----------
const colorOf = (p: Participant) => p.type === 'actor' ? 'var(--c-entry)' : p.type && TYPES[p.type] ? `var(--c-${p.type}, ${typeDef(p.type).color})` : 'var(--muted)';
const typeLabel = (p: Participant) => p.type === 'actor' ? 'Actor' : p.type && TYPES[p.type] ? typeDef(p.type).label : 'Participant';
const trunc = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s;
function wrapText(s: string, width: number): string[] {
  const words = s.split(/\s+/), out: string[] = []; let line = '';
  for (const w of words) { const next = line ? line + ' ' + w : w; if (textW(next) > width && line) { out.push(line); line = w; } else line = next; }
  if (line) out.push(line);
  return out.length ? out : [''];
}
let drag: Drag | null = null;
type Drag =
  | { t: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { t: 'msg'; from: string; x: number; y: number; to: string | null; at: number; moved: boolean }
  | { t: 'move'; rowId: string; span: number; y0: number; y: number; at: number; moved: boolean }
  | { t: 'head'; pid: string; x0: number; x: number; at: number; moved: boolean };

export function drawSeq() {
  if (!isSeq()) { svg.setAttribute('hidden', ''); emptyEl.hidden = true; return; }
  svg.removeAttribute('hidden');
  const d = seq();
  geo = layoutSeq(d);
  const sys = linkedSystem();
  const tm = timing(d, sys?.doc ?? null, sys?.res ?? null);
  const selRows = new Set<string>([...state.multi, ...(state.sel?.type === 'row' ? [state.sel.id] : [])]);
  const selPart = state.sel?.type === 'part' ? state.sel.id : '';
  const partOf = (id: string) => d.participants.find(p => p.id === id);
  const X = (id: string) => geo.colX[id] ?? 0;
  const bottom = geo.height - 12;
  let h = '', blockLabels = '';

  // blocks (behind everything)
  for (const b of geo.blocks) {
    const on = selRows.has(b.id);
    const lab = b.kind, gw = b.guard ? textW(`[${b.guard}]`) + 12 : 0;
    h += `<g class="sq-block ${on ? 'on' : ''}" data-row="${b.id}">`;
    h += `<rect class="sq-bbox" x="${b.x1}" y="${b.y1}" width="${b.x2 - b.x1}" height="${Math.max(10, b.y2 - b.y1)}" rx="6"/>`;
    for (const e of b.elses) h += `<line class="sq-else" x1="${b.x1}" x2="${b.x2}" y1="${e.y}" y2="${e.y}" data-row="${e.id}"/>`;
    h += '</g>';
    // labels go on a later layer so lifelines and activation bars never cover them
    const tw = textW(lab) * 1.15 + 18;
    blockLabels += `<g class="sq-block ${on ? 'on' : ''}" data-row="${b.id}"><path class="sq-btab" data-grip="${b.id}" d="M${b.x1} ${b.y1 + 6}a6 6 0 0 1 6 -6h${tw}v14l-8 8h-${tw - 2}z"/>`;
    blockLabels += `<text class="sq-bkind" x="${b.x1 + 9}" y="${b.y1 + 15}" data-grip="${b.id}">${lab}</text>`;
    if (b.guard) blockLabels += `<text class="sq-guard sq-halo" x="${b.x1 + tw + 14}" y="${b.y1 + 15}" data-edit="${b.id}">[${esc(b.guard)}]</text>`;
    void gw;
    for (const e of b.elses) blockLabels += `<text class="sq-guard sq-halo ${selRows.has(e.id) ? 'on' : ''}" x="${b.x1 + 10}" y="${e.y + 15}" data-row="${e.id}" data-edit="${e.id}">[${esc(e.guard || (b.kind === 'par' ? 'and' : 'else'))}]</text>`;
    blockLabels += '</g>';
  }
  // lifelines + heads
  for (const p of d.participants) {
    const x = X(p.id), on = selPart === p.id;
    const top = SEQ.top + SEQ.headH;
    h += `<g class="sq-life ${on ? 'on' : ''}" data-life="${esc(p.id)}"><rect class="sq-lhit" x="${x - 14}" y="${top}" width="28" height="${Math.max(40, bottom - top)}"/><line class="sq-lline" x1="${x}" x2="${x}" y1="${top}" y2="${bottom}"/></g>`;
  }
  // activations
  for (const a of geo.acts) {
    const x = X(a.pid) - 5 + a.level * 6;
    h += `<rect class="sq-act" data-life="${esc(a.pid)}" x="${x}" y="${a.y1}" width="10" height="${Math.max(8, a.y2 - a.y1)}" rx="2"/>`;
  }
  // rows
  const levelAt = (pid: string, y: number) => geo.acts.filter(a => a.pid === pid && a.y1 <= y + 0.5 && a.y2 >= y - 0.5).reduce((m, a) => Math.max(m, a.level + 1), 0);
  const edgeX = (pid: string, y: number, toward: number) => { const lv = levelAt(pid, y); const c = X(pid) + Math.max(0, lv - 1) * 6; return lv ? (toward > c ? c + 5 : c - 5) : c; };
  d.rows.forEach((r, i) => {
    const g = geo.rows[i];
    const on = selRows.has(r.id);
    if (r.t === 'msg') {
      const cls = `sq-msg sq-${r.style} ${on ? 'on' : ''}`;
      const lab = esc(r.label);
      if (r.from === r.to) {
        const x = edgeX(r.from, g.ay, Infinity), y = g.ay, w = 40;
        h += `<g class="${cls}" data-row="${r.id}"><path class="sq-hit" d="M${x} ${y}h${w}v22h-${w - 4}"/><path class="sq-line" d="M${x} ${y}h${w}v22h-${w - 2}" marker-end="url(#sq-${r.style === 'sync' ? 'solid' : 'open'}${on ? '-on' : ''})"/>`;
        h += `<text class="sq-label" x="${x + w + 8}" y="${y + 15}" data-edit="${r.id}">${lab || '<tspan class="sq-ph">label</tspan>'}</text></g>`;
      } else {
        const xa0 = X(r.from), xb0 = X(r.to);
        const xa = edgeX(r.from, g.ay, xb0), xb = edgeX(r.to, g.ay + 1, xa0);
        const dir = xb > xa ? 1 : -1;
        h += `<g class="${cls}" data-row="${r.id}"><line class="sq-hit" x1="${xa}" x2="${xb}" y1="${g.ay}" y2="${g.ay}"/><line class="sq-line" x1="${xa}" x2="${xb - dir * 1.5}" y1="${g.ay}" y2="${g.ay}" marker-end="url(#sq-${r.style === 'sync' ? 'solid' : 'open'}${on ? '-on' : ''})"/>`;
        h += `<text class="sq-label" x="${(xa + xb) / 2}" y="${g.ay - 8}" text-anchor="middle" data-edit="${r.id}">${lab || '<tspan class="sq-ph">label</tspan>'}</text></g>`;
      }
      if (tm.at[r.id] !== undefined) h += `<text class="sq-time" x="${geo.width - 4}" y="${g.ay + 4}" text-anchor="end">${fmtMs(tm.at[r.id])}</text>`;
    } else if (r.t === 'note') {
      const xs = r.over.map(X).filter(x => x !== undefined);
      const lines = wrapText(r.text || ' ', 230);
      const wText = Math.max(...lines.map(textW)) + 20;
      const x1 = Math.min(...xs) - 30, x2 = Math.max(...xs) + 30, w = Math.max(x2 - x1, wText), cx = (x1 + x2) / 2;
      h += `<g class="sq-note ${on ? 'on' : ''}" data-row="${r.id}"><path d="M${cx - w / 2} ${g.y + 6}h${w - 10}l10 10v${g.h - 18}h-${w}z"/>`;
      lines.forEach((l, k) => { h += `<text x="${cx - w / 2 + 10}" y="${g.y + 22 + k * SEQ.noteLine}" data-edit="${r.id}">${esc(l) || '<tspan class="sq-ph">note</tspan>'}</text>`; });
      h += '</g>';
    }
  });
  h += blockLabels;
  // heads on top of everything so long lifelines never cover them
  for (const p of d.participants) {
    const x = X(p.id), on = selPart === p.id;
    const n = nodeOf(p, sys);
    h += `<g class="sq-head ${on ? 'on' : ''} ${drag?.t === 'head' && drag.pid === p.id && drag.moved ? 'dragging' : ''}" data-head="${esc(p.id)}" style="--kc:${colorOf(p)}" ${drag?.t === 'head' && drag.pid === p.id && drag.moved ? `transform="translate(${drag.x - drag.x0} 0)"` : ''}>`;
    h += `<rect x="${x - SEQ.headW / 2}" y="${SEQ.top}" width="${SEQ.headW}" height="${SEQ.headH}" rx="7"/><path class="sq-hbar" d="M${x - SEQ.headW / 2 + 1} ${SEQ.top + 4}a6 6 0 0 1 6 -4h${SEQ.headW - 14}a6 6 0 0 1 6 4z"/>`;
    h += `<text class="sq-htype" x="${x}" y="${SEQ.top + 17}" text-anchor="middle">${esc(typeLabel(p))}${p.ref && !n && linkedSystem() ? ' · link missing' : ''}</text>`;
    h += `<text class="sq-hname" x="${x}" y="${SEQ.top + 35}" text-anchor="middle" data-edit-part="${esc(p.id)}">${esc(trunc(p.name, 22))}</text></g>`;
  }
  // gesture feedback
  if (drag?.t === 'msg' && drag.moved) {
    const iy = insertY(drag.at), xa = X(drag.from), xb = drag.to ? X(drag.to) : drag.x;
    h += `<line class="sq-ins" x1="${Math.min(...geo.cols.map(c => c.x)) - 60}" x2="${Math.max(...geo.cols.map(c => c.x)) + 60}" y1="${iy}" y2="${iy}"/>`;
    if (drag.to === drag.from) h += `<path class="sq-ghost" d="M${xa} ${iy + 14}h40v22h-38" marker-end="url(#sq-solid-on)"/>`;
    else h += `<line class="sq-ghost" x1="${xa}" x2="${xb}" y1="${iy + 18}" y2="${iy + 18}" marker-end="url(#sq-solid-on)"/>`;
  }
  if (drag?.t === 'move' && drag.moved) { const iy = insertY(drag.at); h += `<line class="sq-ins" x1="${Math.min(...geo.cols.map(c => c.x)) - 60}" x2="${Math.max(...geo.cols.map(c => c.x)) + 60}" y1="${iy}" y2="${iy}"/>`; }
  if (drag?.t === 'head' && drag.moved) { const xs = geo.cols.map(c => c.x); const ix = drag.at >= xs.length ? xs[xs.length - 1] + 95 : xs[drag.at] - 95; h += `<line class="sq-ins" x1="${ix}" x2="${ix}" y1="${SEQ.top - 6}" y2="${SEQ.top + SEQ.headH + 6}"/>`; }
  world.innerHTML = h;
  emptyEl.hidden = d.participants.length > 0;

  // top bar: end-to-end time instead of the capacity verdict
  const wrap = document.getElementById('verdictWrap') as HTMLElement;
  if (sys && tm.linked) {
    // colour by the worst linked component, so an overloaded system shows here too
    const rank = { ok: 0, warn: 1, crit: 2 } as const;
    let worst: 'ok' | 'warn' | 'crit' = 'ok', worstName = '';
    for (const p of d.participants) { const n = nodeOf(p, sys); const r = n && sys.res.nodes[n.id]; if (r && rank[r.status] > rank[worst]) { worst = r.status; worstName = n!.name; } }
    wrap.className = `verdict ${worst} seqtime`;
    (document.getElementById('verdict') as HTMLElement).textContent = `End to end ~${fmtMs(tm.total)}`;
    (document.getElementById('lat') as HTMLElement).textContent = worst === 'ok' ? `from ${sys.title}` : `${worstName} ${worst === 'crit' ? 'overloaded' : 'running hot'}`;
  } else {
    wrap.className = 'verdict seqtime muted';
    (document.getElementById('verdict') as HTMLElement).textContent = d.uses ? 'Link lifelines to components for timings' : 'Sequence';
    (document.getElementById('lat') as HTMLElement).textContent = '';
  }
  apply();
}
on('canvas', () => { if (isSeq()) drawSeq(); else if (!svg.hasAttribute('hidden')) { svg.setAttribute('hidden', ''); emptyEl.hidden = true; } });

/**
 * Clicks redraw the diagram, which replaces the elements under the pointer, so the browser doesn't
 * always pair two clicks into a dblclick. Pair them here: a second tap on the same thing within 400 ms.
 */
let lastTap = { key: '', at: 0 };
function secondTap(key: string) {
  const now = performance.now(), hit = lastTap.key === key && now - lastTap.at < 400;
  lastTap = hit ? { key: '', at: 0 } : { key, at: now };
  return hit;
}
/** Pan sideways just enough that world x (a lifeline) is in view, clear of the edges. */
function revealX(x: number | undefined) {
  if (x === undefined) return;
  const w = svg.getBoundingClientRect().width, sx = x * state.view.k + state.view.x, pad = SEQ.headW / 2 * state.view.k + 24;
  const dx = sx > w - pad ? w - pad - sx : sx < pad ? pad - sx : 0;
  if (dx) { state.view.x += dx; apply(); }
}
/** y of the gap before row `i` (rows.length = after the last). */
function insertY(i: number) {
  if (!geo.rows.length) return SEQ.firstRow + 6;
  if (i >= geo.rows.length) { const last = geo.rows[geo.rows.length - 1]; return last.y + last.h; }
  return geo.rows[i].y;
}
/** Index where something dropped at world y lands. */
function indexAt(y: number, skip?: { from: number; span: number }) {
  for (let i = 0; i < geo.rows.length; i++) {
    if (skip && i >= skip.from && i < skip.from + skip.span) continue;
    const g = geo.rows[i]; if (y < g.y + g.h / 2) return i;
  }
  return geo.rows.length;
}
function nearestLife(x: number): string | null {
  let best: string | null = null, bd = 90;
  for (const c of geo.cols) { const dd = Math.abs(c.x - x); if (dd < bd) { bd = dd; best = c.id; } }
  return best;
}

// ---------- gestures ----------
svg.addEventListener('pointerdown', ev => {
  if (!isSeq() || ev.button !== 0) return;
  closeEdit(true);
  const t = ev.target as Element;
  const p = toWorld(ev.clientX, ev.clientY);
  const head = t.closest('[data-head]') as SVGGElement | null;
  const life = t.closest('[data-life]') as SVGElement | null;
  const row = t.closest('[data-row]') as SVGElement | null;
  const grip = t.closest('[data-grip]') as SVGElement | null;
  svg.setPointerCapture(ev.pointerId);
  if (head) { drag = { t: 'head', pid: head.dataset.head!, x0: p.x, x: p.x, at: 0, moved: false }; return; }
  if (row || grip) {
    const id = (grip ?? row)!.dataset.grip ?? row!.dataset.row!;
    const i = seq().rows.findIndex(r => r.id === id); const r = seq().rows[i];
    if (!r) return;
    if (ev.shiftKey) { // build a range for wrapping in a block
      if (state.sel?.type === 'row') state.multi.add(state.sel.id);
      if (state.multi.has(id)) state.multi.delete(id); else state.multi.add(id);
      state.sel = { type: 'row', id }; renderAll(); drag = null; return;
    }
    select({ type: 'row', id });
    const span = r.t === 'open' ? blockEnd(seq().rows, i) - i + 1 : r.t === 'msg' || r.t === 'note' ? 1 : 0;
    drag = span ? { t: 'move', rowId: id, span, y0: p.y, y: p.y, at: i, moved: false } : null;
    renderAll(); return;
  }
  if (life) { drag = { t: 'msg', from: life.dataset.life!, x: p.x, y: p.y, to: null, at: indexAt(p.y), moved: false }; return; }
  drag = { t: 'pan', sx: ev.clientX, sy: ev.clientY, vx: state.view.x, vy: state.view.y, moved: false };
});
svg.addEventListener('pointermove', ev => {
  if (!drag || !isSeq()) return;
  const p = toWorld(ev.clientX, ev.clientY);
  if (drag.t === 'pan') {
    const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true; state.view.x = drag.vx + dx; state.view.y = drag.vy + dy; apply(); return;
  }
  if (drag.t === 'msg') {
    if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) < 6 / state.view.k) return;
    drag.moved = true; drag.x = p.x; drag.to = nearestLife(p.x); drag.at = indexAt(drag.y);
    hint(drag.to ? (drag.to === drag.from ? 'Release to add a message to itself' : `Release to add a message ${nameOf(drag.from)} → ${nameOf(drag.to)}`) : 'Release on a lifeline');
    drawSeq(); return;
  }
  if (drag.t === 'move') {
    if (!drag.moved && Math.abs(p.y - drag.y0) < 6 / state.view.k) return;
    drag.moved = true; drag.y = p.y;
    const from = seq().rows.findIndex(r => r.id === (drag as any).rowId);
    drag.at = indexAt(p.y, { from, span: drag.span });
    drawSeq(); return;
  }
  if (drag.t === 'head') {
    if (!drag.moved && Math.abs(p.x - drag.x0) < 6 / state.view.k) return;
    drag.moved = true; drag.x = p.x;
    const xs = geo.cols.map(c => c.x); drag.at = xs.findIndex(x => p.x < x); if (drag.at < 0) drag.at = xs.length;
    drawSeq(); return;
  }
});
svg.addEventListener('pointerup', ev => {
  const d = drag; drag = null; hint(null);
  if (!d || !isSeq()) return;
  if (d.t === 'pan') { if (!d.moved) { select(null); renderAll(); } return; }
  if (d.t === 'msg') {
    if (!d.moved) { select({ type: 'part', id: d.from }); renderAll(); return; }
    if (!d.to || !seq().participants.some(p => p.id === d.from) || !seq().participants.some(p => p.id === d.to)) { drawSeq(); return; }
    const r: Row = { t: 'msg', id: rowId(), from: d.from, to: d.to, label: '', style: d.from === d.to ? 'sync' : tool };
    mutate(() => { seq().rows.splice(d.at, 0, r); });
    select({ type: 'row', id: r.id }); renderAll();
    requestAnimationFrame(() => startEdit(r.id));
    return;
  }
  if (d.t === 'move') {
    if (!d.moved) { if (secondTap('row:' + d.rowId)) { startEdit(d.rowId); return; } drawSeq(); return; }
    moveRows(d.rowId, d.span, d.at); return;
  }
  if (d.t === 'head') {
    if (!d.moved) { if (secondTap('part:' + d.pid)) { startEditPart(d.pid); return; } select({ type: 'part', id: d.pid }); renderAll(); return; }
    const ps = seq().participants, i = ps.findIndex(p => p.id === d.pid);
    let to = d.at; if (to > i) to--;
    if (to === i) { drawSeq(); return; }
    mutate(() => { const [p] = ps.splice(i, 1); ps.splice(to, 0, p); });
    renderAll(); return;
  }
});
svg.addEventListener('dblclick', ev => {
  if (!isSeq()) return;
  const t = (document.elementFromPoint(ev.clientX, ev.clientY) ?? ev.target) as Element;
  const part = t.closest('[data-head]') as SVGElement | null;
  if (part) { startEditPart(part.dataset.head!); return; }
  const r = t.closest('[data-edit],[data-row],[data-grip]') as SVGElement | null;
  const id = r?.dataset.edit ?? r?.dataset.row ?? r?.dataset.grip;
  if (id) startEdit(id);
  else if (!seq().participants.length) addParticipant();
});
svg.addEventListener('wheel', ev => {
  if (!isSeq()) return;
  ev.preventDefault();
  const r = svg.getBoundingClientRect();
  if (ev.ctrlKey || ev.metaKey) {
    const f = Math.exp(-ev.deltaY * 0.01), k = Math.min(2.5, Math.max(0.3, state.view.k * f)), cx = ev.clientX - r.left, cy = ev.clientY - r.top;
    state.view.x = cx - (cx - state.view.x) * (k / state.view.k); state.view.y = cy - (cy - state.view.y) * (k / state.view.k); state.view.k = k; applyView(); return;
  }
  state.view.x -= ev.deltaX; state.view.y -= ev.deltaY; apply();
}, { passive: false });

const nameOf = (pid: string) => seq().participants.find(p => p.id === pid)?.name ?? pid;

/** Move `span` rows starting at `id` so they land before what is now at index `to`. Blocks stay well-formed. */
function moveRows(id: string, span: number, to: number) {
  const rows = seq().rows, from = rows.findIndex(r => r.id === id);
  if (from < 0) return;
  const next = rows.slice(); const chunk = next.splice(from, span);
  const at = to > from ? to - span : to;
  if (at === from) { drawSeq(); return; }
  next.splice(Math.max(0, Math.min(at, next.length)), 0, ...chunk);
  if (!balanced(next)) { hint("Can't move it there: it would break up a block", 1800); drawSeq(); return; }
  mutate(() => { seq().rows = next; }); renderAll();
}

// ---------- inline editing on the drawing ----------
let editing: { id: string; part: boolean } | null = null;
function placeEdit(x: number, y: number, w: number, value: string) {
  const s = toScreen(x, y);
  editBox.style.left = s.x + 'px'; editBox.style.top = s.y + 'px'; editBox.style.width = Math.max(140, w * state.view.k) + 'px';
  editBox.value = value; editBox.hidden = false; editBox.focus({ preventScroll: true }); editBox.select();
}
export function startEdit(id: string) {
  const i = seq().rows.findIndex(r => r.id === id), r = seq().rows[i]; if (!r) return;
  const g = layoutSeq(seq()).rows[i]; geo = layoutSeq(seq());
  editing = { id, part: false };
  if (r.t === 'msg') {
    const xa = geo.colX[r.from], xb = geo.colX[r.to];
    const w = r.from === r.to ? 220 : Math.max(160, Math.abs(xb - xa) - 20);
    const cx = r.from === r.to ? xa + 48 : (xa + xb) / 2 - w / 2;
    placeEdit(cx, g.ay - 26, w, r.label);
    labelOptions(r);
  } else if (r.t === 'note') {
    const xs = r.over.map(p => geo.colX[p]); placeEdit(Math.min(...xs) - 30, g.y + 8, Math.max(200, Math.max(...xs) - Math.min(...xs) + 60), r.text);
  } else if (r.t === 'open' || r.t === 'else') {
    const b = r.t === 'open' ? geo.blocks.find(x => x.id === id) : geo.blocks.find(x => x.elses.some(e => e.id === id));
    placeEdit((b?.x1 ?? 0) + (r.t === 'open' ? textW(r.kind) + 30 : 8), g.ay - 2, 220, r.guard);
  } else { editing = null; }
}
function startEditPart(pid: string) {
  const p = seq().participants.find(x => x.id === pid); if (!p) return;
  editing = { id: pid, part: true };
  placeEdit(geo.colX[pid] - SEQ.headW / 2 + 6, SEQ.top + 20, SEQ.headW - 12, p.name);
  editBox.removeAttribute('list');
}
function closeEdit(commit: boolean) {
  if (!editing || editBox.hidden) { editing = null; return; }
  const e = editing; editing = null; editBox.hidden = true;
  if (!commit) { drawSeq(); return; }
  const v = editBox.value.trim();
  if (e.part) {
    const p = seq().participants.find(x => x.id === e.id);
    if (p && v && v !== p.name) {
      // a lifeline still carrying its placeholder id takes one from its new name
      if (/^participant-\d+$/.test(p.id)) { const id = slugId(v, seq().participants.filter(x => x !== p).map(x => x.id)); renameId(p, id, v); return; }
      mutate(() => { p.name = v; });
    }
  } else {
    const r = seq().rows.find(x => x.id === e.id);
    if (r && (r.t === 'msg' ? r.label : r.t === 'note' ? r.text : r.t === 'close' ? '' : r.guard) !== v) {
      mutate(() => { if (r.t === 'msg') r.label = v; else if (r.t === 'note') r.text = v; else if (r.t !== 'close') r.guard = v; });
    }
  }
  settle();
}
/** After an inline edit: redraw, but if focus has just moved into the panel, don't rebuild the panel under it. */
function settle() {
  const panel = document.getElementById('sheetBody')!, a = document.activeElement as HTMLInputElement | null;
  if (a && panel.contains(a)) {
    renderCanvas();
    const r = state.sel?.type === 'row' ? seq().rows.find(x => x.id === state.sel!.id) : undefined;
    if (r?.t === 'msg' && a.dataset.sqf === 'label' && !a.value) a.value = r.label;
    return;
  }
  renderAll();
}
editBox.addEventListener('keydown', ev => {
  if (ev.key === 'Enter') { ev.preventDefault(); closeEdit(true); svg.focus?.(); }
  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeEdit(false); }
  ev.stopPropagation();
});
editBox.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== editBox) closeEdit(true); }, 0));

/** What a message to `to` is likely to say: its endpoints, topic actions, table queries. */
export function labelSuggestions(to: string): string[] {
  const sys = linkedSystem(); const n = nodeOf(seq().participants.find(p => p.id === to), sys);
  if (!n) return [];
  const out: string[] = [];
  (n.endpoints ?? []).forEach(e => out.push(`${e.method} ${e.path}`));
  (n.tables ?? []).forEach(t => out.push(`query ${t.name}`, `insert ${t.name}`));
  const beh = typeDef(n.kind).behaviour;
  if (beh === 'async') out.push(`publish ${n.name}`, 'consume');
  if (beh === 'cache') out.push('get', 'set');
  return out;
}
const dl = $<HTMLDataListElement>('seqLabels');
function labelOptions(r: Extract<Row, { t: 'msg' }>) {
  const opts = r.style === 'reply' ? ['200 OK', '201 Created', '202 Accepted', '204 No Content', '400 Bad Request', '404 Not Found', 'response'] : labelSuggestions(r.to);
  dl.innerHTML = opts.map(o => `<option value="${esc(o)}">`).join('');
  editBox.setAttribute('list', 'seqLabels');
}

// ---------- rail tools ----------
let tool: MsgStyle = 'sync';
const rail = $<HTMLElement>('railSeq');
function syncTool() { rail.querySelectorAll<HTMLElement>('[data-seqtool]').forEach(b => b.classList.toggle('active', b.dataset.seqtool === tool)); }
rail.addEventListener('click', ev => {
  const b = (ev.target as Element).closest<HTMLElement>('[data-seqtool]'); if (!b || !isSeq()) return;
  seqTool(b.dataset.seqtool!);
});
export function seqTool(name: string) {
  const sel = state.sel?.type === 'row' ? seq().rows.find(r => r.id === state.sel!.id) : undefined;
  if (name === 'participant') { addParticipant(); return; }
  if (name === 'sync' || name === 'async' || name === 'reply') {
    tool = name; syncTool();
    if (sel?.t === 'msg' && sel.style !== name) { mutate(() => { sel.style = name; }); renderAll(); }
    else hint(`Drag from one lifeline to another to draw a${name === 'async' ? 'n async message' : name === 'reply' ? ' reply' : ' call'}`, 2000);
    return;
  }
  if (name === 'note') { addNote(); return; }
  if ((BLOCK_KINDS as string[]).includes(name)) { wrapInBlock(name as BlockKind); return; }
}
export function addParticipant(name?: string) {
  const ps = seq().participants;
  const nm = name ?? `Participant ${ps.length + 1}`;
  const p: Participant = { id: slugId(nm, ps.map(x => x.id)), name: nm };
  // after the selected lifeline, else at the end
  const at = state.sel?.type === 'part' ? ps.findIndex(x => x.id === state.sel!.id) + 1 : ps.length;
  mutate(() => { ps.splice(at || ps.length, 0, p); });
  select({ type: 'part', id: p.id }); renderAll();
  requestAnimationFrame(() => { geo = layoutSeq(seq()); revealX(geo.colX[p.id]); startEditPart(p.id); });
  return p;
}
function selectedRange(): [number, number] | null {
  const rows = seq().rows;
  const ids = new Set([...state.multi, ...(state.sel?.type === 'row' ? [state.sel.id] : [])]);
  const idx = rows.map((r, i) => (ids.has(r.id) ? i : -1)).filter(i => i >= 0);
  if (!idx.length) return null;
  let lo = Math.min(...idx), hi = Math.max(...idx);
  // a selected block header takes its whole block
  for (const i of idx) if (rows[i].t === 'open') hi = Math.max(hi, blockEnd(rows, i));
  return [lo, hi];
}
function wrapInBlock(kind: BlockKind) {
  const rows = seq().rows;
  const range = selectedRange();
  const open: Row = { t: 'open', id: rowId(), kind, guard: kind === 'loop' ? 'for each item' : kind === 'opt' ? 'if needed' : kind === 'par' ? '' : 'condition' };
  const close: Row = { t: 'close', id: rowId() };
  const next = rows.slice();
  if (range) { next.splice(range[1] + 1, 0, close); next.splice(range[0], 0, open); }
  else next.push(open, close);
  if (!balanced(next)) { hint('Select whole messages or blocks to wrap — a block can\'t start inside another and end outside it', 2600); return; }
  mutate(() => { seq().rows = next; });
  state.multi.clear(); select({ type: 'row', id: open.id }); renderAll();
  requestAnimationFrame(() => startEdit(open.id));
}
function addNote() {
  const rows = seq().rows, ps = seq().participants;
  if (!ps.length) { hint('Add a participant first', 1600); return; }
  let over = [ps[0].id], at = rows.length;
  if (state.sel?.type === 'part') over = [state.sel.id];
  const i = state.sel?.type === 'row' ? rows.findIndex(r => r.id === state.sel!.id) : -1;
  if (i >= 0) { const r = rows[i]; at = r.t === 'open' ? blockEnd(rows, i) + 1 : i + 1; if (r.t === 'msg') over = r.from === r.to ? [r.from] : [r.from, r.to]; }
  const n: Row = { t: 'note', id: rowId(), over, text: '' };
  mutate(() => { rows.splice(at, 0, n); });
  select({ type: 'row', id: n.id }); renderAll();
  requestAnimationFrame(() => startEdit(n.id));
}

// ---------- keyboard (main routes keys here when a sequence is open) ----------
export function seqKey(ev: KeyboardEvent): boolean {
  const mod = ev.metaKey || ev.ctrlKey;
  const rows = seq().rows;
  if (ev.key === 'Delete' || ev.key === 'Backspace') { deleteSelection(); return true; }
  if (ev.key === 'Enter' && state.sel) { if (state.sel.type === 'row') startEdit(state.sel.id); else startEditPart(state.sel.id); return true; }
  if (mod && ev.key.toLowerCase() === 'd' && state.sel?.type === 'row') {
    const i = rows.findIndex(r => r.id === state.sel!.id), r = rows[i];
    if (r?.t === 'msg' || r?.t === 'note') { const c = { ...JSON.parse(JSON.stringify(r)), id: rowId() }; mutate(() => rows.splice(i + 1, 0, c)); select({ type: 'row', id: c.id }); renderAll(); }
    return true;
  }
  if ((ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && state.sel?.type === 'row') {
    const i = rows.findIndex(r => r.id === state.sel!.id), r = rows[i]; if (!r) return true;
    const span = r.t === 'open' ? blockEnd(rows, i) - i + 1 : r.t === 'msg' || r.t === 'note' ? 1 : 0; if (!span) return true;
    const up = ev.key === 'ArrowUp';
    const to = up ? i - 1 : i + span + 1;
    if (to < 0 || to > rows.length) return true;
    // step over a neighbouring block marker one row at a time: moving in/out of blocks is allowed when it stays balanced
    moveRows(r.id, span, to); return true;
  }
  if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && state.sel?.type === 'part') {
    const ps = seq().participants, i = ps.findIndex(p => p.id === state.sel!.id), j = i + (ev.key === 'ArrowLeft' ? -1 : 1);
    if (j < 0 || j >= ps.length) return true;
    mutate(() => { [ps[i], ps[j]] = [ps[j], ps[i]]; }); renderAll(); return true;
  }
  const k = ev.key.toLowerCase();
  if (!mod && !ev.altKey) {
    const map: Record<string, string> = { p: 'participant', c: 'sync', a: 'async', r: 'reply', n: 'note', l: 'loop' };
    if (map[k]) { seqTool(map[k]); return true; }
  }
  return false;
}
export function deleteSelection() {
  const s = state.sel; if (!s) return;
  const rows = seq().rows;
  if (s.type === 'part') {
    const n = rows.filter(r => r.t === 'msg' && (r.from === s.id || r.to === s.id)).length;
    mutate(() => {
      seq().participants = seq().participants.filter(p => p.id !== s.id);
      seq().rows = rows.filter(r => !(r.t === 'msg' && (r.from === s.id || r.to === s.id))).map(r => r.t === 'note' ? { ...r, over: r.over.filter(o => o !== s.id) } : r).filter(r => r.t !== 'note' || r.over.length);
    });
    if (n) hint(`Removed with its ${n} message${n === 1 ? '' : 's'}`, 1600);
  } else if (s.type === 'row') {
    const ids = new Set([...state.multi, s.id]);
    mutate(() => {
      let next = rows.slice();
      for (const id of ids) {
        const i = next.findIndex(r => r.id === id), r = next[i]; if (!r) continue;
        if (r.t === 'open') { const e = blockEnd(next, i); next = next.filter((_, k) => k !== i && k !== e && !(k > i && k < e && next[k].t === 'else' && depthOf(next, k) === depthOf(next, i) + 1)); }
        else if (r.t === 'else') next.splice(i, 1);
        else if (r.t !== 'close') next.splice(i, 1);
      }
      seq().rows = next;
    });
  } else return;
  state.multi.clear(); select(null); renderAll();
}
function depthOf(rows: Row[], i: number) { let d = 0; for (let k = 0; k < i; k++) { if (rows[k].t === 'open') d++; else if (rows[k].t === 'close') d--; } return d; }

// ---------- the details panel ----------
type PanelTab = 'item' | 'code';
let ptab: PanelTab = 'item';
let codeView: import('@codemirror/view').EditorView | null = null;
let draft: string | null = null;   // text that doesn't parse (kept so redraws don't lose it)

/** Renders the sequence panel into `body`; sheet.ts calls this instead of its own when a sequence is open. */
export function seqPanel(body: HTMLElement) {
  codeView?.destroy(); codeView = null;
  const d = seq(), s = state.sel;
  const row = s?.type === 'row' ? d.rows.find(r => r.id === s.id) : undefined;
  const part = s?.type === 'part' ? d.participants.find(p => p.id === s.id) : undefined;
  const itemName = row ? ({ msg: 'Message', note: 'Note', open: 'Block', else: 'Branch', close: 'Block' } as const)[row.t] : part ? 'Participant' : 'Diagram';
  let h = `<div class="head"><span class="k">${itemName === 'Diagram' ? 'Sequence' : itemName}</span><strong>${esc(row?.t === 'msg' ? (row.label || `${nameOf(row.from)} → ${nameOf(row.to)}`) : part ? part.name : state.meta.title)}</strong><span class="spacer"></span>${row || part ? '<button class="icon danger" data-sq="delete" title="Delete" aria-label="Delete"><svg><use href="#ic-trash"/></svg></button>' : ''}</div>`;
  h += `<div class="tabs"><button data-sqtab="item" class="${ptab === 'item' ? 'on' : ''}">${itemName}</button><button data-sqtab="code" class="${ptab === 'code' ? 'on' : ''}">Code</button></div>`;
  if (ptab === 'code') {
    const text = draft ?? printSeq(d);
    h += `<div class="sq-code"><div class="cm-host sq-cm"><pre class="cm-pre">${esc(text) || '&nbsp;'}</pre></div><p class="sq-status">${statusLine()}</p>`;
    h += `<p class="sq-help">Code and drawing are the same thing: edit either. <code>-&gt;</code> call, <code>--&gt;</code> reply, <code>-&gt;&gt;</code> async, <code>note over a: …</code>, <code>alt</code> / <code>else</code> / <code>end</code> (also <code>opt</code>, <code>loop</code>, <code>par</code>). Paste Mermaid or PlantUML to convert it.</p></div>`;
    body.innerHTML = h;
    const host = body.querySelector<HTMLElement>('.sq-cm')!;
    import('./code').then(m => {
      if (!host.isConnected) return;
      codeView = m.mountSeq(host, { doc: text, onChange: onCodeChange, participants: () => seq().participants.map(p => p.id), labels: labelSuggestions });
    });
    return;
  }
  if (row?.t === 'msg') h += msgPanel(row);
  else if (row?.t === 'note') h += notePanel(row);
  else if (row && (row.t === 'open' || row.t === 'else' || row.t === 'close')) h += blockPanel(row);
  else if (part) h += partPanel(part);
  else h += diagramPanel();
  body.innerHTML = h;
}
const opt = (v: string, label: string, cur: string) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
const partOptions = (cur: string) => seq().participants.map(p => opt(p.id, p.name, cur)).join('');
function msgPanel(r: Extract<Row, { t: 'msg' }>) {
  const sugg = r.style === 'reply' ? ['200 OK', '201 Created', '202 Accepted', '204 No Content', '400 Bad Request', '404 Not Found'] : labelSuggestions(r.to);
  let h = '<div class="tab"><div class="props">';
  h += `<label>From<select data-sqf="from">${partOptions(r.from)}</select></label><label>To<select data-sqf="to">${partOptions(r.to)}</select></label>`;
  h += `<label class="wide">Label<input data-sqf="label" value="${esc(r.label)}" list="sqLabelList" placeholder="${r.style === 'reply' ? '200 OK' : 'POST /payments'}"></label><datalist id="sqLabelList">${sugg.map(o => `<option value="${esc(o)}">`).join('')}</datalist>`;
  h += `<div class="wide seg" role="group" aria-label="Kind">${(['sync', 'reply', 'async'] as MsgStyle[]).map(st => `<button data-sqstyle="${st}" class="${r.style === st ? 'on' : ''}">${st === 'sync' ? 'Call' : st === 'reply' ? 'Reply' : 'Async'}</button>`).join('')}</div>`;
  h += '</div>';
  const hasReply = r.style === 'sync' && r.from !== r.to && (() => { const rows = seq().rows, i = rows.indexOf(r); return rows.slice(i + 1).some(x => x.t === 'msg' && x.style === 'reply' && x.from === r.to && x.to === r.from); })();
  if (r.style === 'sync' && r.from !== r.to && !hasReply) h += `<p><button class="small" data-sq="add-reply">+ Add the reply</button></p>`;
  if (sugg.length && r.style !== 'reply') h += `<p class="hint-line">Suggestions come from ${esc(nameOf(r.to))}'s ${linkedSystem() ? 'linked component' : 'component'}.</p>`;
  else if (r.style !== 'reply' && !nodeOf(seq().participants.find(p => p.id === r.to), linkedSystem())) h += `<p class="hint-line">Link ${esc(nameOf(r.to))} to a component to get its endpoints here.</p>`;
  return h + '</div>';
}
function notePanel(r: Extract<Row, { t: 'note' }>) {
  let h = `<div class="tab"><div class="props"><label class="wide">Text<textarea data-sqf="text" rows="3">${esc(r.text)}</textarea></label></div>`;
  h += `<div class="sq-over"><span>Over</span>${seq().participants.map(p => `<label class="check"><input type="checkbox" data-sqover="${esc(p.id)}" ${r.over.includes(p.id) ? 'checked' : ''}>${esc(p.name)}</label>`).join('')}</div>`;
  return h + '</div>';
}
function blockPanel(r: Row) {
  const rows = seq().rows;
  let i = rows.indexOf(r);
  if (r.t !== 'open') { let depth = 0; for (let k = i; k >= 0; k--) { const x = rows[k]; if (x.t === 'close' && k !== i) depth++; else if (x.t === 'open') { if (depth === 0) { i = k; break; } depth--; } } }
  const open = rows[i] as Extract<Row, { t: 'open' }>; if (!open || open.t !== 'open') return '';
  const end = blockEnd(rows, i);
  const branches = rows.slice(i + 1, end).map((x, k) => ({ x, k: i + 1 + k })).filter(({ x, k }) => x.t === 'else' && depthOf(rows, k) === depthOf(rows, i) + 1);
  let h = '<div class="tab"><div class="props">';
  h += `<label>Kind<select data-sqb="kind" data-id="${open.id}">${BLOCK_KINDS.map(k => opt(k, k, open.kind)).join('')}</select></label>`;
  h += `<label>${open.kind === 'loop' ? 'Repeats' : 'Condition'}<input data-sqb="guard" data-id="${open.id}" value="${esc(open.guard)}" placeholder="${open.kind === 'loop' ? 'for each item' : 'condition'}"></label>`;
  h += '</div>';
  if (open.kind === 'alt' || open.kind === 'par') {
    h += `<div class="sq-branches"><span>${open.kind === 'alt' ? 'Other branches' : 'In parallel with'}</span>`;
    branches.forEach(({ x }) => { h += `<div class="sq-branch"><input data-sqb="guard" data-id="${x.id}" value="${esc((x as any).guard)}" placeholder="${open.kind === 'alt' ? 'else' : 'and'}"><button class="x" data-sq="rm-branch:${x.id}" aria-label="Remove branch">×</button></div>`; });
    h += `<button class="small" data-sq="add-branch:${open.id}">+ ${open.kind === 'alt' ? 'Else branch' : 'Parallel branch'}</button></div>`;
  }
  h += `<p class="sq-actions"><button class="small" data-sq="unwrap:${open.id}">Unwrap — keep the messages</button></p>`;
  return h + '</div>';
}
function partPanel(p: Participant) {
  const sys = linkedSystem();
  const types = [['', 'Participant'], ['actor', 'Actor'], ...Object.keys(TYPES).map(k => [k, typeDef(k).label])];
  let h = '<div class="tab"><div class="props">';
  h += `<label class="wide">Name<input data-sqp="name" value="${esc(p.name)}"></label>`;
  h += `<label>Id (used in code)<input data-sqp="id" value="${esc(p.id)}" spellcheck="false"></label>`;
  h += `<label>Type<select data-sqp="type">${types.map(([v, l]) => opt(v, l, p.type ?? '')).join('')}</select></label>`;
  h += '</div>';
  if (sys) {
    h += `<div class="props"><label class="wide">Linked component in ${esc(sys.title)}<select data-sqp="ref"><option value="">Not linked</option>${sys.doc.nodes.map(n => opt(n.id, `${n.name} · ${typeDef(n.kind).label}`, p.ref ?? '')).join('')}</select></label></div>`;
    const n = nodeOf(p, sys);
    if (n) { const r = sys.res.nodes[n.id]; if (r) h += `<p class="hint-line">${esc(n.name)}: ~${fmtMs(r.lat)} at ${Math.round(r.util * 100)}% load in the capacity model.</p>`; }
    if (sys.key) h += `<p><button class="small" data-sq="goto-system">Open ${esc(sys.title)}</button></p>`;
  } else if (!seq().uses) h += `<p class="hint-line">Pick a system diagram for this sequence (with nothing selected) to link lifelines to its components.</p>`;
  const n = seq().rows.filter(r => r.t === 'msg' && (r.from === p.id || r.to === p.id)).length;
  h += `<p class="hint-line">${n} message${n === 1 ? '' : 's'}. ←/→ move the lifeline; drag its head to reorder.</p>`;
  return h + '</div>';
}
function diagramPanel() {
  const d = seq(), sys = linkedSystem();
  const sysTabs = systemTabs();
  const cur = d.uses ? (tabFor(d.uses)?.key ?? '__other') : '';
  let h = '<div class="tab"><div class="props">';
  h += `<label class="wide">Draws on<select data-sqd="uses"><option value="">No system diagram</option>${sysTabs.map(t => opt(t.key, t.title, cur)).join('')}${cur === '__other' ? opt('__other', (d.uses?.title ?? 'a diagram') + ' (not open)', cur) : ''}</select></label>`;
  h += '</div>';
  if (sys) {
    const tm = timing(d, sys.doc, sys.res);
    const unlinked = d.participants.filter(p => !nodeOf(p, sys));
    h += `<p class="hint-line">${tm.linked} of ${d.participants.length} lifelines linked. ${tm.linked ? `End to end ~${fmtMs(tm.total)} from the capacity model.` : ''}</p>`;
    if (unlinked.some(p => sys.doc.nodes.some(n => n.name.toLowerCase() === p.name.toLowerCase() || n.name.toLowerCase() === p.id.toLowerCase()))) h += `<p><button class="small" data-sq="link-by-name">Link lifelines to components with the same name</button></p>`;
  }
  h += `<div class="sq-tips"><strong>Drawing</strong><ul>
    <li>Drag from one lifeline to another to add a message where you let go; onto the same lifeline for a self-call.</li>
    <li>Drag a message up or down to move it; drag a head sideways to reorder lifelines.</li>
    <li>Double-click anything to edit its text. Shift-click messages, then Alt / Loop… to wrap them.</li>
    <li>Keys: P participant · C call · A async · R reply · N note · L loop · ↑/↓ move · Enter edit · Delete.</li></ul></div>`;
  return h + '</div>';
}
function statusLine() {
  if (draft !== null) { const e = parseSeq(draft).errors.length; return `<span class="bad">●</span> ${e} problem${e === 1 ? '' : 's'} — the drawing keeps the last valid version`; }
  const d = seq();
  return `<span class="good">●</span> ${d.participants.length} lifeline${d.participants.length === 1 ? '' : 's'} · ${d.rows.filter(r => r.t === 'msg').length} messages`;
}
let codeSnap = false;
function onCodeChange(text: string) {
  const p = parseSeq(text);
  const status = document.querySelector('.sq-status');
  if (p.errors.length) { draft = text; if (status) status.innerHTML = statusLine(); return; }
  draft = null;
  if (!codeSnap) { history.snapshot(seq()); codeSnap = true; setTimeout(() => (codeSnap = false), 1200); }
  const prev = seq();
  const next = keepIds(prev, p.doc);
  if (!prev.participants.length && next.participants.length) requestAnimationFrame(() => fit());
  // links (@ref) live in the text; keep the system link
  state.seq = next;
  if (state.sel?.type === 'row' && !next.rows.some(r => r.id === state.sel!.id)) state.sel = null;
  if (state.sel?.type === 'part' && !next.participants.some(x => x.id === state.sel!.id)) state.sel = null;
  if (status) status.innerHTML = statusLine();
  renderCanvas();
}
// panel events
const body = document.getElementById('sheetBody') as HTMLElement;
let panelSnap: HTMLElement | null = null;
body.addEventListener('focusin', ev => { if (!isSeq()) return; const f = ev.target as HTMLElement; if ((f.dataset.sqf || f.dataset.sqp || f.dataset.sqb) && f !== panelSnap) { panelSnap = f; history.snapshot(seq()); } });
body.addEventListener('focusout', () => { panelSnap = null; });
body.addEventListener('input', ev => {
  if (!isSeq()) return;
  const f = ev.target as HTMLInputElement;
  const r = state.sel?.type === 'row' ? seq().rows.find(x => x.id === state.sel!.id) : undefined;
  if (f.dataset.sqf && r && f.tagName !== 'SELECT') { (r as any)[f.dataset.sqf] = f.value; renderCanvas(); return; }
  if (f.dataset.sqb && f.tagName !== 'SELECT') { const x = seq().rows.find(y => y.id === f.dataset.id) as any; if (x) { x.guard = f.value; renderCanvas(); } return; }
  if (f.dataset.sqp === 'name') { const p = seq().participants.find(x => x.id === state.sel?.id); if (p) { p.name = f.value || p.id; renderCanvas(); } return; }
});
body.addEventListener('change', ev => {
  if (!isSeq()) return;
  const f = ev.target as HTMLInputElement | HTMLSelectElement;
  const r = state.sel?.type === 'row' ? seq().rows.find(x => x.id === state.sel!.id) : undefined;
  if (f.dataset.sqf && f.tagName === 'SELECT' && r) { mutate(() => { (r as any)[f.dataset.sqf!] = f.value; }); renderAll(); return; }
  if (f.dataset.sqb === 'kind') { const x = seq().rows.find(y => y.id === f.dataset.id) as any; if (x) { const next = seq().rows.map(y => y === x ? { ...x, kind: f.value } : y); if (!balanced(next)) { hint('Only alt and par can have branches; remove them first', 2200); renderAll(); return; } mutate(() => { x.kind = f.value; }); renderAll(); } return; }
  if ((f as HTMLInputElement).dataset.sqover && r?.t === 'note') {
    const id = (f as HTMLInputElement).dataset.sqover!, on = (f as HTMLInputElement).checked;
    mutate(() => { r.over = on ? seq().participants.map(p => p.id).filter(p => p === id || r.over.includes(p)) : r.over.filter(o => o !== id); if (!r.over.length) r.over = [id]; });
    renderAll(); return;
  }
  const p = state.sel?.type === 'part' ? seq().participants.find(x => x.id === state.sel!.id) : undefined;
  if (p && f.dataset.sqp === 'type') { mutate(() => { if (f.value) p.type = f.value; else delete p.type; }); renderAll(); return; }
  if (p && f.dataset.sqp === 'ref') {
    const sys = linkedSystem(); const n = sys?.doc.nodes.find(x => x.id === f.value);
    mutate(() => {
      if (!f.value) { delete p.ref; return; }
      p.ref = f.value;
      if (n) { p.type = n.kind; if (/^Participant \d+$/.test(p.name)) p.name = n.name; }
    });
    renderAll(); return;
  }
  if (p && f.dataset.sqp === 'id') { renameId(p, f.value.trim()); return; }
  if (f.dataset.sqd === 'uses') {
    if (f.value === '__other') return;
    mutate(() => { if (!f.value) delete seq().uses; else seq().uses = usesFor(f.value) ?? undefined; });
    renderAll(); return;
  }
});
function renameId(p: Participant, id: string, name?: string) {
  if (id === p.id && !name) return;
  if (!/^[A-Za-z_$][\w.$-]*$/.test(id) || seq().participants.some(x => x.id === id && x !== p)) { hint(seq().participants.some(x => x.id === id) ? `"${id}" is taken` : 'Ids are letters, digits, - _ . (no spaces)', 2000); renderAll(); return; }
  const old = p.id;
  mutate(() => {
    p.id = id; if (name) p.name = name;
    for (const r of seq().rows) { if (r.t === 'msg') { if (r.from === old) r.from = id; if (r.to === old) r.to = id; } else if (r.t === 'note') r.over = r.over.map(o => o === old ? id : o); }
  });
  select({ type: 'part', id }); renderAll();
}
body.addEventListener('click', ev => {
  if (!isSeq()) return;
  const tb = (ev.target as Element).closest<HTMLElement>('[data-sqtab]');
  if (tb) { ptab = tb.dataset.sqtab as PanelTab; draft = null; renderAll(); return; }
  const st = (ev.target as Element).closest<HTMLElement>('[data-sqstyle]');
  if (st) { const r = seq().rows.find(x => x.id === state.sel?.id); if (r?.t === 'msg') { mutate(() => { r.style = st.dataset.sqstyle as MsgStyle; }); renderAll(); } return; }
  const b = (ev.target as Element).closest<HTMLElement>('[data-sq]'); if (!b) return;
  const [act, arg] = b.dataset.sq!.split(':');
  const rows = seq().rows;
  if (act === 'delete') { deleteSelection(); return; }
  if (act === 'add-reply') {
    const i = rows.findIndex(x => x.id === state.sel?.id), r = rows[i]; if (r?.t !== 'msg') return;
    const rep: Row = { t: 'msg', id: rowId(), from: r.to, to: r.from, label: '', style: 'reply' };
    mutate(() => rows.splice(i + 1, 0, rep)); select({ type: 'row', id: rep.id }); renderAll(); requestAnimationFrame(() => startEdit(rep.id)); return;
  }
  if (act === 'add-branch') { const i = rows.findIndex(x => x.id === arg), e = blockEnd(rows, i); const br: Row = { t: 'else', id: rowId(), guard: '' }; mutate(() => rows.splice(e, 0, br)); renderAll(); return; }
  if (act === 'rm-branch') { mutate(() => { seq().rows = rows.filter(x => x.id !== arg); }); renderAll(); return; }
  if (act === 'unwrap') {
    const i = rows.findIndex(x => x.id === arg), e = blockEnd(rows, i);
    mutate(() => { seq().rows = rows.filter((x, k) => k !== i && k !== e && !(k > i && k < e && x.t === 'else' && depthOf(rows, k) === depthOf(rows, i) + 1)); });
    select(null); renderAll(); return;
  }
  if (act === 'link-by-name') {
    const sys = linkedSystem(); if (!sys) return;
    mutate(() => { for (const p of seq().participants) { if (nodeOf(p, sys)) continue; const n = sys.doc.nodes.find(x => x.name.toLowerCase() === p.name.toLowerCase() || x.name.toLowerCase() === p.id.toLowerCase()); if (n) { p.ref = n.id; p.type = n.kind; } } });
    renderAll(); return;
  }
  if (act === 'goto-system') { const sys = linkedSystem(); if (sys?.key) import('./tabs').then(m => m.activate(sys.key!)); return; }
});

// ---------- "appears in": which open sequences use a system component ----------
export function appearsIn(nodeId: string): { key: string; title: string }[] {
  const me = tabs.list.find(t => t.key === tabs.active); if (!me || me.kind !== 'system') return [];
  const out: { key: string; title: string }[] = [];
  for (const t of tabs.list) {
    if (t.kind !== 'sequence') continue;
    const p = peek(t.key); const u = p?.seq?.uses; if (!u) continue;
    if (!((u.id && u.id === me.cloudId) || (u.tab && u.tab === me.key))) continue;
    if (p!.seq!.participants.some(x => x.ref === nodeId)) out.push({ key: t.key, title: p!.title });
  }
  return out;
}

setSequencePanel(seqPanel, appearsIn, key => import('./tabs').then(m => m.activate(key)));
$<HTMLButtonElement>('seqStart').onclick = () => addParticipant();
syncTool();
export const seqToolNames = ['participant', 'sync', 'async', 'reply', 'note', 'alt', 'opt', 'loop', 'par'];
void BLOCK_KINDS;
