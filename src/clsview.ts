/**
 * The class diagram editor: boxes you drag, member rows, relations drawn by dragging from one class
 * onto another (then picking what kind), a details panel with Members and Code, and paste-to-import
 * (Java, Kotlin, Mermaid) anywhere on the canvas.
 */
import { state, esc, on, renderCanvas, renderAll, mutate, select } from './state';
import { blankCls, parseClsAny, printCls, parseMember, memberText, isMethod, mergeCls, renameClass, layoutCls, boxSize, clipRect, fromTables, fromAvro, relId, typeRefs, CLASS_KINDS, REL_TYPES, REL_LABEL, CLS, type ClassDoc, type ClassBox, type Relation, type RelType, type ClassKind, type Member, type Vis } from './cls';
import { setKindView, applyView, hint } from './canvas';
import { setKindPanel } from './sheet';
import { tabs, peek, systemTabs } from './tabs';
import { detailOf } from './model';
import * as history from './history';

const $ = <T extends Element>(id: string) => document.getElementById(id) as unknown as T;
const svg = $<SVGSVGElement>('clsSvg'), world = $<SVGGElement>('clsWorld');
const stage = $<HTMLElement>('stage'), emptyEl = $<HTMLElement>('clsEmpty'), editBox = $<HTMLInputElement>('clsEdit'), picker = $<HTMLElement>('clsRelPick');
const gridPattern = $<SVGPatternElement>('grid');
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const cls = () => state.cls;
const isCls = () => state.kind === 'class';
const snap = (v: number) => Math.round(v / 8) * 8;
const KIND_COLOR: Record<ClassKind, string> = { class: '#2f8a55', abstract: '#2f8a55', interface: '#7c3aed', enum: '#a16207', record: '#2f6fa8' };
const KIND_LABEL: Record<ClassKind, string> = { class: 'Class', abstract: 'Abstract class', interface: 'Interface', enum: 'Enum', record: 'Record' };

// ---------- view ----------
function apply() {
  world.setAttribute('transform', `translate(${state.view.x} ${state.view.y}) scale(${state.view.k})`);
  let step = 24 * state.view.k; while (step < 12) step *= 2;
  gridPattern.setAttribute('width', String(step)); gridPattern.setAttribute('height', String(step));
  gridPattern.setAttribute('x', String(state.view.x)); gridPattern.setAttribute('y', String(state.view.y));
  const dot = gridPattern.querySelector('circle')!; dot.setAttribute('cx', String(step / 2)); dot.setAttribute('cy', String(step / 2));
}
function bounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cls().classes) { const p = cls().pos[c.name]; if (!p) continue; const s = boxSize(c); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + s.w); y1 = Math.max(y1, p.y + s.h); }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}
function fit(animated = true) {
  const r = stage.getBoundingClientRect(), b = bounds(); if (!r.width || !b) return;
  const pad = 60;
  const k = Math.min(1.2, Math.max(0.3, Math.min((r.width - pad * 2) / (b.x1 - b.x0), (r.height - pad * 2) / (b.y1 - b.y0))));
  const target = { k, x: (r.width - (b.x1 - b.x0) * k) / 2 - b.x0 * k, y: (r.height - (b.y1 - b.y0) * k) / 2 - b.y0 * k };
  if (!animated || reduceMotion()) { Object.assign(state.view, target); applyView(); return; }
  const from = { ...state.view }, t0 = performance.now();
  const tick = (now: number) => { const t = Math.min(1, (now - t0) / 220), e = 1 - Math.pow(1 - t, 3); state.view.k = from.k + (target.k - from.k) * e; state.view.x = from.x + (target.x - from.x) * e; state.view.y = from.y + (target.y - from.y) * e; applyView(); if (t < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
setKindView('class', { apply, fit });
const toWorld = (cx: number, cy: number) => { const r = svg.getBoundingClientRect(); return { x: (cx - r.left - state.view.x) / state.view.k, y: (cy - r.top - state.view.y) / state.view.k }; };
const toScreen = (x: number, y: number) => ({ x: x * state.view.k + state.view.x, y: y * state.view.k + state.view.y });

/** Classes without a position (new from code or paste) get one next to the others. */
function placeMissing() {
  const d = cls();
  const missing = new Set(d.classes.filter(c => !d.pos[c.name]).map(c => c.name));
  if (!missing.size) return false;
  const all = missing.size === d.classes.length;
  Object.assign(d.pos, all ? layoutCls(d) : layoutCls(d, missing));
  for (const n of Object.keys(d.pos)) if (!d.classes.some(c => c.name === n)) delete d.pos[n];
  return all;
}

// ---------- drawing ----------
const selected = () => { const s = new Set(state.multi); if (state.sel?.type === 'class') s.add(state.sel.id); return s; };
const rectOf = (c: ClassBox) => { const p = cls().pos[c.name] ?? { x: 0, y: 0 }, s = boxSize(c); return { x: p.x, y: p.y, w: s.w, h: s.h }; };
const has = (n: string) => cls().classes.some(c => c.name === n);
type Drag =
  | { t: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { t: 'move'; ids: string[]; sx: number; sy: number; from: Record<string, { x: number; y: number }>; moved: boolean; snap: boolean }
  | { t: 'rel'; from: string; x: number; y: number; over: string | null };
let drag: Drag | null = null;

function memberRow(m: Member, enumConst: boolean, x: number, y: number, w: number, cname: string, i: number, kind: 'f' | 'm') {
  if (enumConst) return `<text class="cl-mem" x="${x}" y="${y}" data-mem="${esc(cname)}:${kind}:${i}">${esc(m.name)}</text>`;
  const vis = m.vis ? `<tspan class="cl-vis">${esc(m.vis)}</tspan> ` : '';
  const sig = isMethod(m) ? `${esc(m.name)}(<tspan class="cl-params">${esc(m.params)}</tspan>)` : esc(m.name);
  const refs = typeRefs(m.type).filter(r => has(r.name) && r.name !== cname);
  const typ = m.type ? `<tspan class="cl-type ${refs.length ? 'ref' : ''}">: ${esc(m.type)}</tspan>` : '';
  void w;
  return `<text class="cl-mem ${m.static ? 'static' : ''} ${m.abstract ? 'abstract' : ''}" x="${x}" y="${y}" data-mem="${esc(cname)}:${kind}:${i}">${vis}${sig}${typ}</text>`;
}
export function drawCls() {
  if (!isCls()) { svg.setAttribute('hidden', ''); emptyEl.hidden = true; picker.hidden = true; return; }
  svg.removeAttribute('hidden');
  const d = cls();
  if (placeMissing()) requestAnimationFrame(() => fit(false));
  const sel = selected(), selRel = state.sel?.type === 'rel' ? state.sel.id : '';
  const rects: Record<string, ReturnType<typeof rectOf>> = {};
  for (const c of d.classes) rects[c.name] = rectOf(c);
  let h = '';
  // relations under the boxes; pairs with several relations fan out a little
  const pairCount: Record<string, number> = {};
  for (const r of d.relations) {
    const a = rects[r.from], b = rects[r.to]; if (!a || !b) continue;
    const key = [r.from, r.to].sort().join('|'); const k = pairCount[key] = (pairCount[key] ?? 0) + 1;
    const off = (k - 1) * 14 * (k % 2 ? 1 : -1);
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1, nx = -(cb.y - ca.y) / len * off, ny = (cb.x - ca.x) / len * off;
    let p1: { x: number; y: number }, p2: { x: number; y: number };
    if (r.from === r.to) {
      const x = a.x + a.w, y = a.y + 14;
      h += `<g class="cl-rel ${r.type} ${selRel === r.id ? 'on' : ''}" data-rel="${r.id}"><path class="cl-rhit" d="M${x} ${y}h30v30h-30"/><path class="cl-rline" d="M${x} ${y}h30v30h-28" marker-end="url(#cl-${endMarker(r.type)}${selRel === r.id ? '-on' : ''})"/>${r.label ? `<text class="cl-rlabel" x="${x + 36}" y="${y + 19}">${esc(r.label)}</text>` : ''}</g>`;
      continue;
    }
    p1 = clipRect(a, { x: cb.x + nx, y: cb.y + ny }); p2 = clipRect(b, { x: ca.x + nx, y: ca.y + ny });
    p1 = { x: p1.x + nx, y: p1.y + ny }; p2 = { x: p2.x + nx, y: p2.y + ny };
    const on = selRel === r.id ? '-on' : '';
    const start = startMarker(r.type), end = endMarker(r.type);
    h += `<g class="cl-rel ${r.type} ${on ? 'on' : ''}" data-rel="${r.id}"><line class="cl-rhit" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}"/>`;
    h += `<line class="cl-rline" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" ${start ? `marker-start="url(#cl-${start}${on})"` : ''} ${end ? `marker-end="url(#cl-${end}${on})"` : ''}/>`;
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    if (r.label) h += `<text class="cl-rlabel" x="${mx}" y="${my - 6}" text-anchor="middle">${esc(r.label)}</text>`;
    const along = (p: { x: number; y: number }, q: { x: number; y: number }, d0: number) => { const L = Math.hypot(q.x - p.x, q.y - p.y) || 1; return { x: p.x + (q.x - p.x) / L * d0, y: p.y + (q.y - p.y) / L * d0 }; };
    if (r.fromMult) { const m = along(p1, p2, 26); h += `<text class="cl-mult" x="${m.x + (ny ? 0 : 0) + 8}" y="${m.y - 6}">${esc(r.fromMult)}</text>`; }
    if (r.toMult) { const m = along(p2, p1, 26); h += `<text class="cl-mult" x="${m.x + 8}" y="${m.y - 6}">${esc(r.toMult)}</text>`; }
    h += '</g>';
  }
  // boxes
  for (const c of d.classes) {
    const r = rects[c.name], s = boxSize(c), on = sel.has(c.name);
    const color = KIND_COLOR[c.kind];
    const stereo = c.stereo ? `«${c.stereo}»` : c.kind === 'class' ? '' : `«${c.kind === 'abstract' ? 'abstract' : c.kind}»`;
    h += `<g class="cl-box ${on ? 'on' : ''} k-${c.kind}" data-class="${esc(c.name)}" style="--kc:${color}">`;
    h += `<rect class="cl-body" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="8"/>`;
    h += `<path class="cl-bar" d="M${r.x + 1} ${r.y + 5}a6 6 0 0 1 6 -5h${r.w - 14}a6 6 0 0 1 6 5z"/>`;
    let y = r.y + 10;
    if (stereo) { h += `<text class="cl-stereo" x="${r.x + r.w / 2}" y="${y + 9}" text-anchor="middle">${esc(stereo)}</text>`; y += CLS.stereoH; }
    h += `<text class="cl-name ${c.kind === 'abstract' ? 'abstract' : ''}" x="${r.x + r.w / 2}" y="${y + 15}" text-anchor="middle" data-rename="${esc(c.name)}">${esc(c.name)}</text>`;
    const fy = r.y + s.headH;
    h += `<line class="cl-div" x1="${r.x}" x2="${r.x + r.w}" y1="${fy}" y2="${fy}"/>`;
    c.fields.forEach((f, i) => { h += memberRow(f, c.kind === 'enum', r.x + 10, fy + 15 + i * CLS.row, r.w, c.name, i, 'f'); });
    const showMethods = !(c.kind === 'enum' || c.kind === 'record' && !c.methods.length);
    if (showMethods) {
      const my = fy + s.fieldsH;
      h += `<line class="cl-div" x1="${r.x}" x2="${r.x + r.w}" y1="${my}" y2="${my}"/>`;
      c.methods.forEach((m, i) => { h += memberRow(m, false, r.x + 10, my + 15 + i * CLS.row, r.w, c.name, i, 'm'); });
    }
    h += `<circle class="cl-port" cx="${r.x + r.w}" cy="${r.y + Math.min(r.h / 2, 40)}" r="6" data-port="${esc(c.name)}"><title>Drag onto another class to relate them</title></circle>`;
    h += '</g>';
  }
  if (drag?.t === 'rel') {
    const a = rects[drag.from]; const target = drag.over ? rects[drag.over] : null;
    const p = target ? clipRect(target, { x: a.x + a.w / 2, y: a.y + a.h / 2 }) : { x: drag.x, y: drag.y };
    const s = clipRect(a, p);
    h += `<line class="cl-ghost" x1="${s.x}" y1="${s.y}" x2="${p.x}" y2="${p.y}" marker-end="url(#cl-open-on)"/>`;
  }
  world.innerHTML = h;
  emptyEl.hidden = d.classes.length > 0;
  // top bar
  const wrap = document.getElementById('verdictWrap') as HTMLElement;
  wrap.className = 'verdict seqtime muted';
  (document.getElementById('verdict') as HTMLElement).textContent = `${d.classes.length} class${d.classes.length === 1 ? '' : 'es'} · ${d.relations.length} relation${d.relations.length === 1 ? '' : 's'}`;
  (document.getElementById('lat') as HTMLElement).textContent = '';
  apply();
}
const endMarker = (t: RelType) => t === 'inherit' || t === 'implement' ? 'tri' : t === 'assoc' || t === 'depend' ? 'open' : '';
const startMarker = (t: RelType) => t === 'composition' ? 'dfill' : t === 'aggregation' ? 'dhollow' : '';
on('canvas', () => { if (isCls()) drawCls(); else if (!svg.hasAttribute('hidden')) { svg.setAttribute('hidden', ''); emptyEl.hidden = true; picker.hidden = true; } });

// ---------- gestures ----------
svg.addEventListener('pointerdown', ev => {
  if (!isCls() || ev.button !== 0) return;
  closeEdit(true); picker.hidden = true;
  const t = ev.target as Element, p = toWorld(ev.clientX, ev.clientY);
  const port = t.closest('[data-port]') as SVGElement | null;
  if (port) { svg.setPointerCapture(ev.pointerId); drag = { t: 'rel', from: port.dataset.port!, x: p.x, y: p.y, over: null }; return; }
  const box = t.closest('[data-class]') as SVGElement | null;
  if (box) {
    const name = box.dataset.class!;
    if (ev.shiftKey) { const s = selected(); if (s.has(name)) { s.delete(name); } else s.add(name); state.multi = new Set([...s].filter(x => x !== name)); state.sel = s.has(name) ? { type: 'class', id: name } : (s.size ? { type: 'class', id: [...s][0] } : null); renderAll(); return; }
    const fresh = !selected().has(name) || state.sel?.id !== name;
    if (!selected().has(name)) select({ type: 'class', id: name }); else state.sel = { type: 'class', id: name };
    const ids = [...selected()];
    svg.setPointerCapture(ev.pointerId);
    drag = { t: 'move', ids, sx: p.x, sy: p.y, from: Object.fromEntries(ids.map(n => [n, { ...(cls().pos[n] ?? { x: 0, y: 0 }) }])), moved: false, snap: false };
    if (fresh) renderAll();   // re-rendering replaces the elements, which would swallow a double-click
    return;
  }
  const rel = t.closest('[data-rel]') as SVGElement | null;
  if (rel) { select({ type: 'rel', id: rel.dataset.rel! }); renderAll(); return; }
  svg.setPointerCapture(ev.pointerId);
  drag = { t: 'pan', sx: ev.clientX, sy: ev.clientY, vx: state.view.x, vy: state.view.y, moved: false };
});
svg.addEventListener('pointermove', ev => {
  if (!drag || !isCls()) return;
  const p = toWorld(ev.clientX, ev.clientY);
  if (drag.t === 'pan') {
    const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true; state.view.x = drag.vx + dx; state.view.y = drag.vy + dy; apply(); return;
  }
  if (drag.t === 'move') {
    const dx = p.x - drag.sx, dy = p.y - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 4 / state.view.k) return;
    if (!drag.moved) { history.snapshot(cls()); drag.moved = true; }
    for (const n of drag.ids) cls().pos[n] = { x: snap(drag.from[n].x + dx), y: snap(drag.from[n].y + dy) };
    renderCanvas(); return;
  }
  if (drag.t === 'rel') {
    drag.x = p.x; drag.y = p.y;
    const over = (document.elementFromPoint(ev.clientX, ev.clientY) as Element | null)?.closest('[data-class]') as SVGElement | null;
    drag.over = over?.dataset.class ?? null;
    hint(drag.over ? `${drag.from} → ${drag.over}: release to choose how they relate` : 'Drop on another class');
    drawCls(); return;
  }
});
svg.addEventListener('pointerup', ev => {
  const d = drag; drag = null; hint(null);
  if (!d || !isCls()) return;
  if (d.t === 'pan') { if (!d.moved) { select(null); renderAll(); } return; }
  if (d.t === 'move') { if (d.moved) renderAll(); return; }
  if (d.t === 'rel') { drawCls(); if (d.over) openPicker(d.from, d.over, ev.clientX, ev.clientY); return; }
});
svg.addEventListener('dblclick', ev => {
  if (!isCls()) return;
  // the first click may have redrawn the boxes; look at what's under the pointer now
  const t = (document.elementFromPoint(ev.clientX, ev.clientY) ?? ev.target) as Element;
  const mem = t.closest('[data-mem]') as SVGElement | null;
  if (mem) { const [n, k, i] = mem.dataset.mem!.split(':'); startEditMember(n, k as 'f' | 'm', +i); return; }
  const box = t.closest('[data-class]') as SVGElement | null;
  if (box) { startRename(box.dataset.class!); return; }
  const rel = t.closest('[data-rel]') as SVGElement | null;
  if (rel) return;
  const p = toWorld(ev.clientX, ev.clientY);
  addClass('class', { x: snap(p.x - 80), y: snap(p.y - 30) });
});
svg.addEventListener('wheel', ev => {
  if (!isCls()) return;
  ev.preventDefault();
  const r = svg.getBoundingClientRect();
  if (ev.ctrlKey || ev.metaKey) {
    const f = Math.exp(-ev.deltaY * 0.01), k = Math.min(2.5, Math.max(0.25, state.view.k * f)), cx = ev.clientX - r.left, cy = ev.clientY - r.top;
    state.view.x = cx - (cx - state.view.x) * (k / state.view.k); state.view.y = cy - (cy - state.view.y) * (k / state.view.k); state.view.k = k; applyView(); return;
  }
  state.view.x -= ev.deltaX; state.view.y -= ev.deltaY; apply();
}, { passive: false });

// ---------- the relation picker ----------
const PICKS: { type: RelType; label: string; toMult?: string }[] = [
  { type: 'composition', label: 'has many ◆', toMult: '*' }, { type: 'aggregation', label: 'has ◇' }, { type: 'assoc', label: 'uses →' },
  { type: 'inherit', label: 'extends ▷' }, { type: 'implement', label: 'implements ⇢▷' }, { type: 'depend', label: 'depends ⇢' },
];
function suggested(from: string, to: string): RelType {
  const a = cls().classes.find(c => c.name === from), b = cls().classes.find(c => c.name === to);
  if (b?.kind === 'interface') return a?.kind === 'interface' ? 'inherit' : 'implement';
  if (b?.kind === 'abstract') return 'inherit';
  if (b?.kind === 'enum' || b?.kind === 'record') return 'assoc';
  return 'assoc';
}
function openPicker(from: string, to: string, cx: number, cy: number) {
  const sug = suggested(from, to);
  picker.innerHTML = `<div class="cl-pick-head">${esc(from)} → ${esc(to)}</div>` + PICKS.map((p, i) => `<button class="chip ${p.type === sug ? 'sug' : ''}" data-pick="${i}">${p.label}</button>`).join('');
  const r = stage.getBoundingClientRect();
  picker.style.left = Math.min(cx - r.left + 8, r.width - 300) + 'px'; picker.style.top = Math.min(cy - r.top + 8, r.height - 120) + 'px';
  picker.hidden = false; picker.dataset.from = from; picker.dataset.to = to;
  picker.querySelector<HTMLButtonElement>('.sug')?.focus();
}
picker.addEventListener('click', ev => {
  const b = (ev.target as Element).closest<HTMLElement>('[data-pick]'); if (!b) return;
  const p = PICKS[+b.dataset.pick!];
  const r: Relation = { id: relId(), from: picker.dataset.from!, to: picker.dataset.to!, type: p.type, ...(p.toMult ? { toMult: p.toMult } : {}) };
  picker.hidden = true;
  mutate(() => cls().relations.push(r));
  select({ type: 'rel', id: r.id }); renderAll();
});
picker.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') { ev.stopPropagation(); picker.hidden = true; }
  if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') { const bs = [...picker.querySelectorAll<HTMLElement>('[data-pick]')]; const i = bs.indexOf(document.activeElement as HTMLElement); bs[(i + (ev.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length]?.focus(); ev.preventDefault(); }
  ev.stopPropagation();
});

// ---------- inline editing ----------
let editing: { t: 'rename'; name: string } | { t: 'member'; name: string; kind: 'f' | 'm'; i: number } | null = null;
function placeEdit(x: number, y: number, w: number, value: string, mono = false) {
  const s = toScreen(x, y);
  editBox.style.left = s.x + 'px'; editBox.style.top = s.y + 'px'; editBox.style.width = Math.max(150, w * state.view.k) + 'px';
  editBox.classList.toggle('mono', mono);
  editBox.value = value; editBox.hidden = false; editBox.focus(); editBox.select();
}
export function startRename(name: string) {
  const c = cls().classes.find(x => x.name === name); if (!c) return;
  const r = rectOf(c);
  editing = { t: 'rename', name };
  placeEdit(r.x + 8, r.y + (c.stereo || c.kind !== 'class' ? 20 : 8), r.w - 16, name);
}
function startEditMember(name: string, kind: 'f' | 'm', i: number) {
  const c = cls().classes.find(x => x.name === name); if (!c) return;
  const r = rectOf(c), s = boxSize(c);
  const m = (kind === 'f' ? c.fields : c.methods)[i]; if (!m) return;
  editing = { t: 'member', name, kind, i };
  const y = r.y + s.headH + (kind === 'm' ? s.fieldsH : 0) + 2 + i * CLS.row;
  placeEdit(r.x + 4, y, r.w - 8, c.kind === 'enum' ? m.name : memberText(m), true);
}
function closeEdit(commit: boolean) {
  if (!editing || editBox.hidden) { editing = null; return; }
  const e = editing; editing = null; editBox.hidden = true;
  if (!commit) { drawCls(); return; }
  const v = editBox.value.trim();
  if (e.t === 'rename') { if (v && v !== e.name) tryRename(e.name, v); else drawCls(); return; }
  const c = cls().classes.find(x => x.name === e.name); if (!c) return;
  const list = e.kind === 'f' ? c.fields : c.methods;
  if (!v) { mutate(() => list.splice(e.i, 1)); renderAll(); return; }
  if (c.kind === 'enum') { if (/^[A-Za-z_$][\w$]*$/.test(v)) { mutate(() => { list[e.i] = { vis: '', name: v, type: '' }; }); renderAll(); } return; }
  const m = parseMember(v);
  if (!m) { hint('Not a member. Try  - name: Type  or  + method(arg: Type): Result', 2200); drawCls(); return; }
  mutate(() => {
    list.splice(e.i, 1);
    (isMethod(m) ? c.methods : c.fields).splice(isMethod(m) === (e.kind === 'm') ? e.i : (isMethod(m) ? c.methods.length : c.fields.length), 0, m);
  });
  renderAll();
}
editBox.addEventListener('keydown', ev => {
  if (ev.key === 'Enter') { ev.preventDefault(); closeEdit(true); }
  if (ev.key === 'Escape') { ev.preventDefault(); closeEdit(false); }
  ev.stopPropagation();
});
editBox.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== editBox) closeEdit(true); }, 0));
function tryRename(from: string, to: string) {
  if (!/^[A-Za-z_$][\w$]*$/.test(to)) { hint('Class names are letters, digits, _ and $ (no spaces)', 2000); renderAll(); return false; }
  if (has(to)) { hint(`There's already a class ${to}`, 1800); renderAll(); return false; }
  mutate(() => renameClass(cls(), from, to));
  state.multi.delete(from);
  select({ type: 'class', id: to }); renderAll();
  return true;
}

// ---------- adding ----------
function freeSpot(w: number, h: number) {
  const r = stage.getBoundingClientRect();
  const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
  const rects = cls().classes.map(rectOf);
  const free = (x: number, y: number) => rects.every(o => x + w + 24 <= o.x || o.x + o.w + 24 <= x || y + h + 24 <= o.y || o.y + o.h + 24 <= y);
  for (let ring = 0; ring < 14; ring++) for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
    const x = snap(c.x - w / 2 + dx * (w + 40)), y = snap(c.y - h / 2 + dy * (h + 40));
    if (free(x, y)) return { x, y };
  }
  return { x: snap(c.x), y: snap(c.y) };
}
export function addClass(kind: ClassKind, at?: { x: number; y: number }) {
  const base = { class: 'NewClass', abstract: 'AbstractThing', interface: 'NewInterface', enum: 'NewEnum', record: 'NewRecord' }[kind];
  let name = base, i = 2; while (has(name)) name = base + i++;
  const c: ClassBox = { name, kind, fields: kind === 'enum' ? [{ vis: '', name: 'FIRST', type: '' }, { vis: '', name: 'SECOND', type: '' }] : [], methods: [] };
  const s = boxSize(c);
  mutate(() => { cls().classes.push(c); cls().pos[name] = at ?? freeSpot(s.w, s.h); });
  select({ type: 'class', id: name }); renderAll();
  requestAnimationFrame(() => startRename(name));
}

// ---------- paste Java / Kotlin / Mermaid / text anywhere on the canvas ----------
document.addEventListener('paste', ev => {
  if (!isCls()) return;
  const t = ev.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.closest?.('.cm-editor'))) return;
  const text = ev.clipboardData?.getData('text/plain') ?? ''; if (!text.trim()) return;
  const p = parseClsAny(text);
  if (!p.doc.classes.length) { hint(p.errors[0]?.message ?? 'Nothing to read in what you pasted', 2400); return; }
  ev.preventDefault();
  importDoc(p.doc, p.from === 'code' ? 'code' : p.from === 'mermaid' ? 'Mermaid' : 'text');
});
export function importDoc(incoming: ClassDoc, what: string) {
  let res = { added: [] as string[], updated: [] as string[] };
  mutate(() => {
    res = mergeCls(cls(), incoming);
    const fresh = new Set(res.added);
    if (fresh.size) Object.assign(cls().pos, cls().classes.length === fresh.size ? layoutCls(cls()) : layoutCls(cls(), fresh));
  });
  const first = res.added[0] ?? res.updated[0];
  if (first) select({ type: 'class', id: first });
  renderAll(); requestAnimationFrame(() => fit());
  hint(`Read ${res.added.length} new and ${res.updated.length} updated class${res.added.length + res.updated.length === 1 ? '' : 'es'} from ${what}`, 2600);
}

// ---------- organise ----------
export function organiseCls() {
  const target = layoutCls(cls());
  const from = Object.fromEntries(Object.entries(cls().pos).map(([k, v]) => [k, { ...v }]));
  history.snapshot(cls());
  if (reduceMotion()) { cls().pos = target; renderAll(); fit(); return; }
  const t0 = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - t0) / 280), e = 1 - Math.pow(1 - t, 3);
    for (const n of Object.keys(target)) { const a = from[n] ?? target[n], b = target[n]; cls().pos[n] = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }; }
    renderCanvas(); if (t < 1) requestAnimationFrame(tick); else { renderAll(); fit(); }
  };
  requestAnimationFrame(tick);
}

// ---------- keyboard ----------
const QUICK: ClassKind[] = ['class', 'interface', 'enum', 'record', 'abstract'];
export function clsKey(ev: KeyboardEvent): boolean {
  const mod = ev.metaKey || ev.ctrlKey, k = ev.key.toLowerCase();
  if (!picker.hidden && ev.key === 'Escape') { picker.hidden = true; return true; }
  if (ev.key === 'Delete' || ev.key === 'Backspace') { deleteSelection(); return true; }
  if (ev.key === 'Enter' && state.sel?.type === 'class') { startRename(state.sel.id); return true; }
  if (mod && k === 'd' && state.sel?.type === 'class') { duplicate(state.sel.id); return true; }
  if (mod && k === 'a') { state.multi = new Set(cls().classes.map(c => c.name)); state.sel = null; renderCanvas(); return true; }
  if (!mod && k === 'o') { organiseCls(); return true; }
  if (!mod && /^[1-5]$/.test(ev.key)) { addClass(QUICK[+ev.key - 1]); return true; }
  const step = ev.shiftKey ? 32 : 8;
  const dirs: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (dirs[ev.key] && selected().size) {
    const [dx, dy] = dirs[ev.key];
    mutate(() => { for (const n of selected()) { const p = cls().pos[n]; if (p) cls().pos[n] = { x: p.x + dx, y: p.y + dy }; } });
    renderCanvas(); return true;
  }
  return false;
}
function duplicate(name: string) {
  const c = cls().classes.find(x => x.name === name); if (!c) return;
  let n = name + 'Copy', i = 2; while (has(n)) n = name + 'Copy' + i++;
  const copy: ClassBox = { ...JSON.parse(JSON.stringify(c)), name: n };
  const p = cls().pos[name] ?? { x: 0, y: 0 };
  mutate(() => { cls().classes.push(copy); cls().pos[n] = { x: p.x + 32, y: p.y + 32 }; });
  select({ type: 'class', id: n }); renderAll();
}
export function deleteSelection() {
  const s = state.sel; if (!s) return;
  if (s.type === 'rel') mutate(() => { cls().relations = cls().relations.filter(r => r.id !== s.id); });
  else if (s.type === 'class') {
    const names = selected();
    mutate(() => {
      cls().classes = cls().classes.filter(c => !names.has(c.name));
      cls().relations = cls().relations.filter(r => !names.has(r.from) && !names.has(r.to));
      for (const n of names) delete cls().pos[n];
    });
  } else return;
  state.multi.clear(); select(null); renderAll();
}

// ---------- rail ----------
const rail = $<HTMLElement>('railCls');
rail.addEventListener('click', ev => { const b = (ev.target as Element).closest<HTMLElement>('[data-clstool]'); if (b && isCls()) addClass(b.dataset.clstool as ClassKind); });

// ---------- generators (from the system diagrams open on this device) ----------
export interface Source { label: string; make: () => ClassDoc; title: string }
export function sources(): Source[] {
  const out: Source[] = [];
  for (const t of systemTabs()) {
    const d = peek(t.key)?.doc; if (!d) continue;
    for (const n of d.nodes) {
      if (n.tables?.length) out.push({ label: `${n.name} tables`, title: `${n.name} model`, make: () => fromTables(n.tables!, n.name) });
      if (typeof n.schema === 'string' && n.schema.trim().startsWith('{')) out.push({ label: `${n.name} schema`, title: `${n.name} schema`, make: () => fromAvro(n.schema as string) });
    }
  }
  return out;
}
void detailOf;

// ---------- the details panel ----------
type PanelTab = 'item' | 'code';
let ptab: PanelTab = 'item';
let codeView: import('@codemirror/view').EditorView | null = null;
let draft: string | null = null;
const opt = (v: string, label: string, cur: string) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
const VIS: Vis[] = ['+', '-', '#', '~', ''];
const VIS_TITLE: Record<string, string> = { '+': 'public', '-': 'private', '#': 'protected', '~': 'package', '': 'unspecified' };

export function clsPanel(body: HTMLElement) {
  codeView?.destroy(); codeView = null;
  const s = state.sel;
  const c = s?.type === 'class' ? cls().classes.find(x => x.name === s.id) : undefined;
  const r = s?.type === 'rel' ? cls().relations.find(x => x.id === s.id) : undefined;
  const itemName = c ? KIND_LABEL[c.kind] : r ? 'Relation' : 'Diagram';
  let h = `<div class="head"><span class="k">${c ? itemName : r ? 'Relation' : 'Classes'}</span><strong>${esc(c ? c.name : r ? `${r.from} ${REL_LABEL[r.type]} ${r.to}` : state.meta.title)}</strong><span class="spacer"></span>${c || r ? '<button class="icon danger" data-cl="delete" title="Delete" aria-label="Delete"><svg><use href="#ic-trash"/></svg></button>' : ''}</div>`;
  h += `<div class="tabs"><button data-cltab="item" class="${ptab === 'item' ? 'on' : ''}">${c ? 'Members' : itemName}</button><button data-cltab="code" class="${ptab === 'code' ? 'on' : ''}">Code</button></div>`;
  if (ptab === 'code') {
    const text = draft ?? printCls(cls());
    h += `<div class="sq-code"><div class="cm-host cl-cm"><pre class="cm-pre">${esc(text) || '&nbsp;'}</pre></div><p class="sq-status">${statusLine()}</p>`;
    h += `<p class="sq-help">Code and drawing are the same thing. <code>class A { - id: UUID }</code>, <code>interface</code>, <code>enum A { X, Y }</code>, <code>record</code>; relations <code>A *-- B</code> owns, <code>o--</code> has, <code>--&gt;</code> uses, <code>--|&gt;</code> extends, <code>..|&gt;</code> implements, <code>..&gt;</code> depends. Paste Java, Kotlin or Mermaid to read it in.</p></div>`;
    body.innerHTML = h;
    const host = body.querySelector<HTMLElement>('.cl-cm')!;
    import('./code').then(m => { if (host.isConnected) codeView = m.mountCls(host, { doc: text, onChange: onCodeChange, classes: () => cls().classes.map(x => x.name) }); });
    return;
  }
  if (c) h += classPanel(c); else if (r) h += relPanel(r); else h += diagramPanel();
  body.innerHTML = h;
}
function memberRows(c: ClassBox, kind: 'f' | 'm') {
  const list = kind === 'f' ? c.fields : c.methods;
  let h = '';
  list.forEach((m, i) => {
    const refs = typeRefs(m.type).filter(t => has(t.name) && t.name !== c.name);
    const tag = c.kind === 'enum' ? '' : m.name === 'id' ? '<span class="cl-tag id">ID</span>' : refs.length ? `<button class="cl-tag ref" data-cl="goto:${esc(refs[0].name)}">→ ${esc(refs[0].name)}</button>` : '';
    if (c.kind === 'enum') { h += `<div class="cl-mrow enum"><input data-clm="${kind}:${i}:name" value="${esc(m.name)}" spellcheck="false"><button class="x" data-cl="rm:${kind}:${i}" aria-label="Remove">×</button></div>`; return; }
    h += `<div class="cl-mrow"><button class="cl-visbtn" data-cl="vis:${kind}:${i}" title="${VIS_TITLE[m.vis]} — click to change">${m.vis || '·'}</button>`;
    h += `<input data-clm="${kind}:${i}:sig" value="${esc(kind === 'm' ? `${m.name}(${m.params})` : m.name)}" spellcheck="false" aria-label="${kind === 'm' ? 'Method' : 'Field'} name">`;
    h += `<input data-clm="${kind}:${i}:type" value="${esc(m.type)}" spellcheck="false" placeholder="${kind === 'm' ? 'void' : 'Type'}" list="clTypes" aria-label="Type">${tag}<button class="x" data-cl="rm:${kind}:${i}" aria-label="Remove">×</button></div>`;
  });
  return h;
}
const JAVA_TYPES = ['String', 'UUID', 'int', 'long', 'boolean', 'double', 'BigDecimal', 'Instant', 'LocalDate', 'List<>', 'Set<>', 'Map<String, >', 'Optional<>', 'void'];
function classPanel(c: ClassBox) {
  let h = '<div class="tab"><div class="props">';
  h += `<label>Name<input data-clp="name" value="${esc(c.name)}" spellcheck="false"></label>`;
  h += `<label>Kind<select data-clp="kind">${CLASS_KINDS.map(k => opt(k, KIND_LABEL[k], c.kind)).join('')}</select></label>`;
  h += `<label class="wide">Stereotype<input data-clp="stereo" value="${esc(c.stereo ?? '')}" placeholder="entity, aggregate root, value object…"></label>`;
  h += '</div>';
  h += `<datalist id="clTypes">${[...cls().classes.map(x => x.name), ...JAVA_TYPES].map(t => `<option value="${esc(t)}">`).join('')}</datalist>`;
  if (c.kind === 'enum') {
    h += `<div class="cl-sec">Constants</div>${memberRows(c, 'f')}`;
    h += `<input class="cl-add" data-cladd="f" placeholder="+ add constant — e.g. REFUNDED" spellcheck="false">`;
  } else {
    h += `<div class="cl-sec">Fields</div>${memberRows(c, 'f')}`;
    h += `<input class="cl-add" data-cladd="f" placeholder="+ add field — e.g. - fee: Money" spellcheck="false"><p class="cl-adderr" hidden></p>`;
    h += `<div class="cl-sec">Methods</div>${memberRows(c, 'm')}`;
    h += `<input class="cl-add" data-cladd="m" placeholder="+ add method — e.g. + retry(n: int): void" spellcheck="false"><p class="cl-adderr" hidden></p>`;
  }
  const rels = cls().relations.filter(r => r.from === c.name || r.to === c.name);
  if (rels.length) {
    h += `<div class="cl-sec">Relations</div><div class="cl-rels">`;
    for (const r of rels) h += `<button class="chip" data-cl="rel:${r.id}">${esc(r.from === c.name ? `${REL_LABEL[r.type]} ${r.to}` : `${r.from} ${REL_LABEL[r.type]} this`)}${r.label ? ` · ${esc(r.label)}` : ''}</button>`;
    h += '</div>';
  }
  h += `<p class="hint-line">Drag the dot on the box's right edge onto another class to relate them. Double-click a member on the box to edit it in place.</p>`;
  return h + '</div>';
}
function relPanel(r: Relation) {
  const names = cls().classes.map(c => c.name);
  let h = '<div class="tab">';
  h += `<div class="seg cl-types" role="group" aria-label="Kind">${REL_TYPES.map(t => `<button data-cltype="${t}" class="${r.type === t ? 'on' : ''}">${REL_LABEL[t]}</button>`).join('')}</div>`;
  h += '<div class="props" style="margin-top:12px">';
  h += `<label>From<select data-clr="from">${names.map(n => opt(n, n, r.from)).join('')}</select></label><label>To<select data-clr="to">${names.map(n => opt(n, n, r.to)).join('')}</select></label>`;
  h += `<label>From multiplicity<input data-clr="fromMult" value="${esc(r.fromMult ?? '')}" list="clMults" placeholder="1"></label><label>To multiplicity<input data-clr="toMult" value="${esc(r.toMult ?? '')}" list="clMults" placeholder="*"></label>`;
  h += `<label class="wide">Label<input data-clr="label" value="${esc(r.label ?? '')}" placeholder="items, card…"></label>`;
  h += '</div><datalist id="clMults"><option value="1"><option value="0..1"><option value="*"><option value="1..*"><option value="0..*"></datalist>';
  h += `<p class="sq-actions"><button class="small" data-cl="swap">Swap direction</button></p>`;
  return h + '</div>';
}
function diagramPanel() {
  let h = '<div class="tab">';
  const src = sources();
  h += `<div class="cl-sec">Generate</div>`;
  if (src.length) h += `<div class="cl-rels">${src.map((s, i) => `<button class="chip" data-cl="gen:${i}">From ${esc(s.label)}</button>`).join('')}</div><p class="hint-line">Adds classes from the tables or Avro schemas in the system diagrams you have open.</p>`;
  else h += `<p class="hint-line">Open a system diagram with database tables or Kafka/SQS schemas in another tab to generate classes from them.</p>`;
  h += `<div class="sq-tips"><strong>Drawing</strong><ul>
    <li>Add classes from the left (1–5), or double-click empty canvas.</li>
    <li>Paste Java, Kotlin or a Mermaid classDiagram anywhere on the canvas to read classes in.</li>
    <li>Drag the dot on a box's right edge onto another class, then pick: has many, has, uses, extends, implements, depends.</li>
    <li>Double-click a name or member to edit it. O organises the layout.</li></ul></div>`;
  return h + '</div>';
}
function statusLine() {
  if (draft !== null) { const e = parseClsAny(draft).errors.length; return `<span class="bad">●</span> ${e} problem${e === 1 ? '' : 's'} — the drawing keeps the last valid version`; }
  return `<span class="good">●</span> ${cls().classes.length} classes · ${cls().relations.length} relations`;
}
let codeSnap = false;
function onCodeChange(text: string) {
  const p = parseClsAny(text);
  const status = document.querySelector('.sq-status');
  if (p.errors.length || p.from !== 'cistem') { draft = text; if (status) status.innerHTML = statusLine(); return; }
  draft = null;
  if (!codeSnap) { history.snapshot(cls()); codeSnap = true; setTimeout(() => (codeSnap = false), 1200); }
  const prevPos = cls().pos, prevIds = cls().relations;
  const next: ClassDoc = { ...p.doc, pos: {} };
  for (const c of next.classes) if (prevPos[c.name]) next.pos[c.name] = prevPos[c.name];
  next.relations.forEach((r, i) => { const o = prevIds[i]; if (o && o.from === r.from && o.to === r.to) r.id = o.id; });
  const wasEmpty = !cls().classes.length;
  state.cls = next;
  if (state.sel?.type === 'class' && !next.classes.some(c => c.name === state.sel!.id)) state.sel = null;
  if (state.sel?.type === 'rel' && !next.relations.some(r => r.id === state.sel!.id)) state.sel = null;
  if (status) status.innerHTML = statusLine();
  renderCanvas();
  if (wasEmpty && next.classes.length) requestAnimationFrame(() => fit());
}

const body = document.getElementById('sheetBody') as HTMLElement;
let panelSnap: HTMLElement | null = null;
const curClass = () => state.sel?.type === 'class' ? cls().classes.find(x => x.name === state.sel!.id) : undefined;
const curRel = () => state.sel?.type === 'rel' ? cls().relations.find(x => x.id === state.sel!.id) : undefined;
body.addEventListener('focusin', ev => { if (!isCls()) return; const f = ev.target as HTMLElement; if ((f.dataset.clm || f.dataset.clr) && f !== panelSnap) { panelSnap = f; history.snapshot(cls()); } });
body.addEventListener('focusout', () => { panelSnap = null; });
body.addEventListener('input', ev => {
  if (!isCls()) return;
  const f = ev.target as HTMLInputElement;
  if (f.dataset.clm) {
    const c = curClass(); if (!c) return;
    const [k, i, part] = f.dataset.clm.split(':'); const m = (k === 'f' ? c.fields : c.methods)[+i]; if (!m) return;
    if (part === 'name') m.name = f.value.trim();
    else if (part === 'type') m.type = f.value.trim();
    else if (part === 'sig') { const mm = /^\s*([A-Za-z_$][\w$]*)\s*(?:\(([^)]*)\)?)?/.exec(f.value); if (mm) { m.name = mm[1]; if (k === 'm') m.params = (mm[2] ?? '').trim(); } }
    renderCanvas(); return;
  }
  if (f.dataset.clr) {
    const r = curRel(); if (!r || f.tagName === 'SELECT') return;
    const key = f.dataset.clr as 'label' | 'fromMult' | 'toMult';
    if (f.value.trim()) r[key] = f.value.trim(); else delete r[key];
    renderCanvas(); return;
  }
  if (f.classList.contains('cl-add')) { f.classList.remove('bad'); const e = f.nextElementSibling as HTMLElement | null; if (e?.classList.contains('cl-adderr')) e.hidden = true; }
});
body.addEventListener('change', ev => {
  if (!isCls()) return;
  const f = ev.target as HTMLInputElement | HTMLSelectElement;
  const c = curClass();
  if (c && f.dataset.clp === 'name') { if (f.value.trim() !== c.name && !tryRename(c.name, f.value.trim())) (f as HTMLInputElement).value = c.name; return; }
  if (c && f.dataset.clp === 'kind') { mutate(() => { const was = c.kind; c.kind = f.value as ClassKind; if (c.kind === 'enum' && was !== 'enum') { c.fields = c.fields.map(x => ({ vis: '', name: x.name, type: '' })); c.methods = []; } }); renderAll(); return; }
  if (c && f.dataset.clp === 'stereo') { mutate(() => { const v = f.value.trim(); if (v) c.stereo = v; else delete c.stereo; }); renderAll(); return; }
  const r = curRel();
  if (r && f.tagName === 'SELECT' && (f.dataset.clr === 'from' || f.dataset.clr === 'to')) { mutate(() => { r[f.dataset.clr as 'from' | 'to'] = f.value; }); renderAll(); return; }
  if (f.dataset.clm || f.dataset.clr) renderAll();
});
body.addEventListener('keydown', ev => {
  if (!isCls()) return;
  const f = ev.target as HTMLInputElement;
  if (f.dataset.cladd && ev.key === 'Enter') {
    ev.preventDefault();
    const c = curClass(); if (!c || !f.value.trim()) return;
    const err = f.nextElementSibling as HTMLElement | null;
    const kind = f.dataset.cladd;
    if (c.kind === 'enum') {
      const names = f.value.split(',').map(x => x.trim()).filter(x => /^[A-Za-z_$][\w$]*$/.test(x));
      if (!names.length) return;
      mutate(() => names.forEach(n => c.fields.push({ vis: '', name: n, type: '' })));
    } else {
      const raw = f.value.trim();
      const m = parseMember(kind === 'm' && !raw.includes('(') ? raw.replace(/^([+\-#~]?\s*[A-Za-z_$][\w$]*)/, '$1()') : raw);
      if (!m) { f.classList.add('bad'); if (err) { err.textContent = kind === 'm' ? 'Try  + retry(n: int): void' : 'Try  - fee: Money'; err.hidden = false; } return; }
      if (!m.vis && !/^[+\-#~]/.test(raw)) m.vis = kind === 'm' ? '+' : '-';
      mutate(() => (isMethod(m) ? c.methods : c.fields).push(m));
    }
    renderAll();
    requestAnimationFrame(() => body.querySelector<HTMLInputElement>(`[data-cladd="${kind}"]`)?.focus());
  }
  if ((f.dataset.clm || f.dataset.clp || f.dataset.clr) && ev.key === 'Enter') { ev.preventDefault(); f.blur(); }
});
body.addEventListener('click', ev => {
  if (!isCls()) return;
  const tb = (ev.target as Element).closest<HTMLElement>('[data-cltab]');
  if (tb) { ptab = tb.dataset.cltab as PanelTab; draft = null; renderAll(); return; }
  const ty = (ev.target as Element).closest<HTMLElement>('[data-cltype]');
  if (ty) { const r = curRel(); if (r) { mutate(() => { r.type = ty.dataset.cltype as RelType; }); renderAll(); } return; }
  const b = (ev.target as Element).closest<HTMLElement>('[data-cl]'); if (!b) return;
  const [act, a1, a2] = b.dataset.cl!.split(':');
  const c = curClass();
  if (act === 'delete') { deleteSelection(); return; }
  if (act === 'goto' && has(a1)) { select({ type: 'class', id: a1 }); renderAll(); return; }
  if (act === 'rel') { select({ type: 'rel', id: a1 }); renderAll(); return; }
  if (act === 'rm' && c) { mutate(() => (a1 === 'f' ? c.fields : c.methods).splice(+a2, 1)); renderAll(); return; }
  if (act === 'vis' && c) { const m = (a1 === 'f' ? c.fields : c.methods)[+a2]; if (m) { mutate(() => { m.vis = VIS[(VIS.indexOf(m.vis) + 1) % VIS.length]; }); renderAll(); } return; }
  if (act === 'swap') { const r = curRel(); if (r) { mutate(() => { [r.from, r.to] = [r.to, r.from]; [r.fromMult, r.toMult] = [r.toMult, r.fromMult]; if (!r.fromMult) delete r.fromMult; if (!r.toMult) delete r.toMult; }); renderAll(); } return; }
  if (act === 'gen') { const s = sources()[+a1]; if (s) importDoc(s.make(), s.label); return; }
});
setKindPanel('class', clsPanel);
$<HTMLButtonElement>('clsStart').onclick = () => addClass('class');
void blankCls; void tabs;
