import { KINDS, NODE_H, ICON, nextId, makeNode, type Node, type Edge, type Kind } from './model';
import { state, fmt, on, renderCanvas, renderAll, mutate, select, selectedNodeIds } from './state';

const stage = document.getElementById('stage') as HTMLElement;
const svg = document.getElementById('svg') as unknown as SVGSVGElement;
const world = document.getElementById('world') as unknown as SVGGElement;
const gN = document.getElementById('nodes') as unknown as SVGGElement;
const gE = document.getElementById('edges') as unknown as SVGGElement;
const gO = document.getElementById('overlay') as unknown as SVGGElement;
const gL = document.getElementById('labels') as unknown as SVGGElement;
const hintEl = document.getElementById('hint') as HTMLElement;
const emptyEl = document.getElementById('emptyState') as HTMLElement;
const renameBox = document.getElementById('renameBox') as HTMLInputElement;
const zoomPct = document.getElementById('zoomPct') as HTMLElement;

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const NS = 'http://www.w3.org/2000/svg';
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}
const set = (e: Element, attrs: Record<string, string | number>) => { for (const k in attrs) e.setAttribute(k, String(attrs[k])); };
const trunc = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s);
const snap = (v: number) => Math.round(v / 8) * 8;
export const fmtMs = (ms: number) => ms >= 100 ? Math.round(ms) + 'ms' : ms >= 10 ? ms.toFixed(0) + 'ms' : ms.toFixed(1) + 'ms';

export function applyView() {
  world.setAttribute('transform', `translate(${state.view.x} ${state.view.y}) scale(${state.view.k})`);
  zoomPct.textContent = Math.round(state.view.k * 100) + '%';
}
function toWorld(cx: number, cy: number) {
  const r = svg.getBoundingClientRect();
  return { x: (cx - r.left - state.view.x) / state.view.k, y: (cy - r.top - state.view.y) / state.view.k };
}
function toScreen(x: number, y: number) {
  const r = svg.getBoundingClientRect();
  return { x: r.left + x * state.view.k + state.view.x, y: r.top + y * state.view.k + state.view.y };
}

// ---------- geometry ----------
type Side = 'n' | 'e' | 's' | 'w';
function port(n: Node, side: Side) {
  const w = KINDS[n.kind].w;
  return side === 'e' ? { x: n.x + w, y: n.y + NODE_H / 2 } : side === 'w' ? { x: n.x, y: n.y + NODE_H / 2 }
    : side === 'n' ? { x: n.x + w / 2, y: n.y } : { x: n.x + w / 2, y: n.y + NODE_H };
}
/** Choose sides so the edge leaves/enters along the dominant direction. */
function routeSides(a: Node, b: Node): [Side, Side] {
  const ac = { x: a.x + KINDS[a.kind].w / 2, y: a.y + NODE_H / 2 }, bc = { x: b.x + KINDS[b.kind].w / 2, y: b.y + NODE_H / 2 };
  const dx = bc.x - ac.x, dy = bc.y - ac.y;
  if (Math.abs(dx) * 1.2 >= Math.abs(dy)) return dx >= 0 ? ['e', 'w'] : ['w', 'e'];
  return dy >= 0 ? ['s', 'n'] : ['n', 's'];
}
function pathBetween(p: { x: number; y: number }, q: { x: number; y: number }, s1: Side, s2: Side) {
  const horiz = s1 === 'e' || s1 === 'w';
  const d = Math.max(40, (horiz ? Math.abs(q.x - p.x) : Math.abs(q.y - p.y)) / 2);
  const c1 = horiz ? { x: p.x + (s1 === 'e' ? d : -d), y: p.y } : { x: p.x, y: p.y + (s1 === 's' ? d : -d) };
  const c2 = horiz ? { x: q.x + (s2 === 'w' ? -d : d), y: q.y } : { x: q.x, y: q.y + (s2 === 'n' ? -d : d) };
  return `M${p.x} ${p.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${q.x} ${q.y}`;
}

function summary(n: Node): string {
  switch (n.kind) {
    case 'entry': return (n.platforms || []).map(p => ({ web: 'Web', app: 'App' } as Record<string, string>)[p] || p).join(' · ') || 'no platforms';
    case 'service': { const e = n.endpoints || []; return e.length ? e.slice(0, 2).map(x => `${x.method} ${x.path}`).join('  ') + (e.length > 2 ? `  +${e.length - 2}` : '') : 'no endpoints'; }
    case 'cache': return n.eviction || '';
    case 'db': { const t = n.tables || []; return t.length ? t.slice(0, 3).map(x => x.name).join(', ') + (t.length > 3 ? ` +${t.length - 3}` : '') : 'no tables'; }
    case 'queue': { const t = n.topics || []; return t.length ? t.slice(0, 2).map(x => x.name).join(', ') + (t.length > 2 ? ` +${t.length - 2}` : '') : 'no topics'; }
    default: return '';
  }
}

// ---------- keyed rendering ----------
const nodeEls = new Map<string, SVGGElement>();
const edgeEls = new Map<string, SVGGElement>();
const labelEls = new Map<string, SVGGElement>();
let firstDraw = true;

function buildNode(n: Node): SVGGElement {
  const w = KINDS[n.kind].w;
  const g = el('g', { class: 'node', 'data-node': n.id });
  g.appendChild(el('rect', { class: 'body', width: w, height: NODE_H, rx: 9 }));
  g.appendChild(el('rect', { class: 'accent', x: 0, y: 0, width: 3, height: NODE_H, rx: 1.5 }));
  g.appendChild(el('use', { href: '#ic-' + n.kind, class: 'glyph', x: 12, y: 12, width: ICON, height: ICON }));
  const tx = 12 + ICON + 9;
  g.appendChild(el('text', { class: 'kind', x: tx, y: 20 }));
  g.appendChild(el('text', { class: 'name', x: tx, y: 37 }));
  g.appendChild(el('text', { class: 'sum', x: 12, y: 56 }));
  g.appendChild(el('text', { class: 'stat', x: 12, y: 71 }));
  if (n.kind !== 'entry') {
    g.appendChild(el('rect', { class: 'bar', x: 12, y: 78, width: w - 24, height: 6, rx: 3 }));
    g.appendChild(el('rect', { class: 'fill ok', x: 12, y: 78, width: 0, height: 6, rx: 3 }));
    g.appendChild(el('text', { class: 'stat pct', x: w - 12, y: 71, 'text-anchor': 'end' }));
  }
  (['n', 'e', 's', 'w'] as Side[]).forEach(s => {
    const p = port({ ...n, x: 0, y: 0 } as Node, s);
    g.appendChild(el('circle', { class: 'handle', 'data-handle': s, cx: p.x, cy: p.y, r: 5 }));
  });
  return g;
}
function updateNode(g: SVGGElement, n: Node) {
  const r = state.results.nodes[n.id], w = KINDS[n.kind].w;
  const isSel = (state.sel?.type === 'node' && state.sel.id === n.id) || state.multi.has(n.id);
  g.setAttribute('class', 'node k-' + n.kind + (isSel ? ' sel' : '') + (r.status === 'crit' ? ' crit' : '') + (g.classList.contains('enter') ? ' enter' : '') + (g.classList.contains('dragging') ? ' dragging' : ''));
  g.setAttribute('transform', `translate(${n.x} ${n.y})`);
  g.style.setProperty('--nx', n.x + 'px'); g.style.setProperty('--ny', n.y + 'px');
  const tx = 12 + ICON + 9;
  g.querySelector('.kind')!.textContent = KINDS[n.kind].label;
  g.querySelector('.name')!.textContent = trunc(n.name || '', (w - tx - 12) / 7.2);
  g.querySelector('.sum')!.textContent = trunc(summary(n), (w - 24) / 6.3);
  g.querySelector('.stat')!.textContent = n.kind === 'entry' ? `${fmt(r.load)} rps out` : `${fmt(r.load)} / ${fmt(r.cap)} rps · ${fmtMs(r.lat)}`;
  if (n.kind !== 'entry') {
    const u = Math.min(1, isFinite(r.util) ? r.util : 1);
    const fill = g.querySelector('.fill')!;
    set(fill, { width: (w - 24) * u, class: 'fill ' + r.status });
    g.querySelector('.pct')!.textContent = isFinite(r.util) ? Math.round(r.util * 100) + '%' : '∞';
  }
}
function buildEdge(e: Edge): SVGGElement {
  const g = el('g', { class: 'edge', 'data-edge': e.id });
  g.appendChild(el('path', { class: 'hit', d: '' }));
  g.appendChild(el('path', { class: 'line', d: '' }));
  const l = el('g', { class: 'edge-label', 'data-edge': e.id });
  l.appendChild(el('rect', { class: 'lbl' }));
  l.appendChild(el('text', { 'text-anchor': 'middle' }));
  labelEls.set(e.id, l); gL.appendChild(l);
  return g;
}
function updateEdge(g: SVGGElement, e: Edge, a: Node, b: Node) {
  const [s1, s2] = routeSides(a, b);
  const p = port(a, s1), q = port(b, s2);
  const d = pathBetween(p, q, s1, s2);
  const isSel = state.sel?.type === 'edge' && state.sel.id === e.id;
  const crit = state.results.nodes[e.to]?.status === 'crit';
  g.setAttribute('class', 'edge' + (isSel ? ' sel' : '') + (crit ? ' crit' : '') + (g.classList.contains('enter') ? ' enter' : ''));
  const line = g.querySelector('.line') as SVGPathElement;
  set(g.querySelector('.hit')!, { d });
  set(line, { d, 'marker-end': isSel ? 'url(#arrowSel)' : crit ? 'url(#arrowCrit)' : 'url(#arrow)' });
  if (g.classList.contains('enter')) { const len = line.getTotalLength(); line.style.strokeDasharray = String(len); line.style.setProperty('--len', String(len)); }
  else { line.style.strokeDasharray = ''; }
  // label at the curve midpoint
  const mid = line.getTotalLength() ? line.getPointAtLength(line.getTotalLength() / 2) : { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  const txt = `${e.calls}× · ${fmt(state.results.edges[e.id] || 0)} rps`;
  const tw = txt.length * 6.1 + 12;
  const l = labelEls.get(e.id)!;
  const tooShort = line.getTotalLength() < tw + 36 && !isSel;
  l.setAttribute('class', 'edge-label' + (isSel ? ' sel' : '') + (tooShort ? ' hidden' : ''));
  set(l.querySelector('.lbl')!, { x: mid.x - tw / 2, y: mid.y - 9, width: tw, height: 18 });
  const t = l.querySelector('text')!; set(t, { x: mid.x, y: mid.y + 3.5 }); t.textContent = txt;
}

export function draw() {
  const { doc, results } = state;
  applyView();
  const byId = Object.fromEntries(doc.nodes.map(n => [n.id, n]));
  const animate = !firstDraw && !reduceMotion();

  // nodes
  const liveN = new Set(doc.nodes.map(n => n.id));
  for (const [id, g] of nodeEls) if (!liveN.has(id)) {
    nodeEls.delete(id);
    if (animate) { g.classList.add('exit'); g.addEventListener('animationend', () => g.remove(), { once: true }); } else g.remove();
  }
  doc.nodes.forEach(n => {
    let g = nodeEls.get(n.id);
    if (!g) {
      g = buildNode(n); nodeEls.set(n.id, g); gN.appendChild(g);
      if (animate) { g.classList.add('enter'); g.addEventListener('animationend', () => g!.classList.remove('enter'), { once: true }); }
    }
    updateNode(g, n);
  });
  // keep selected node on top
  const top = state.sel?.type === 'node' ? nodeEls.get(state.sel.id) : null;
  if (top && gN.lastElementChild !== top) gN.appendChild(top);

  // edges
  const liveE = new Set(doc.edges.map(e => e.id));
  for (const [id, g] of edgeEls) if (!liveE.has(id)) {
    edgeEls.delete(id); labelEls.get(id)?.remove(); labelEls.delete(id);
    if (animate) { g.classList.add('exit'); g.addEventListener('animationend', () => g.remove(), { once: true }); } else g.remove();
  }
  doc.edges.forEach(e => {
    const a = byId[e.from], b = byId[e.to]; if (!a || !b) return;
    let g = edgeEls.get(e.id);
    if (!g) {
      g = buildEdge(e); edgeEls.set(e.id, g); gE.appendChild(g);
      if (animate) { g.classList.add('enter'); const ln = g.querySelector('.line')!; ln.addEventListener('animationend', () => { g!.classList.remove('enter'); (ln as SVGPathElement).style.strokeDasharray = ''; }, { once: true }); }
    }
    updateEdge(g, e, a, b);
  });

  // verdict
  const v = results.verdict;
  const wrap = document.getElementById('verdictWrap') as HTMLElement;
  const labels = { ok: 'Handles it', warn: 'Near limit', crit: 'Breaks' };
  wrap.className = 'verdict ' + v.status;
  (document.getElementById('verdict') as HTMLElement).textContent = labels[v.status] + (v.node ? ` at ${v.node.name}` : '');
  (document.getElementById('lat') as HTMLElement).textContent = `~${v.lat.toFixed(0)} ms` + (v.converged ? '' : ' · not converging');
  emptyEl.hidden = doc.nodes.length > 0;
  firstDraw = false;
}

// ---------- hint ----------
let hintTimer = 0;
export function hint(msg: string | null, ms = 0) {
  clearTimeout(hintTimer);
  if (!msg) { hintEl.hidden = true; return; }
  hintEl.textContent = msg; hintEl.hidden = false;
  if (ms) hintTimer = window.setTimeout(() => (hintEl.hidden = true), ms);
}

// ---------- pointer interaction ----------
type Drag =
  | { type: 'node'; ids: string[]; start: Record<string, { x: number; y: number }>; ox: number; oy: number; moved: boolean; snapped: boolean }
  | { type: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { type: 'connect'; from: string; side: Side; path: SVGPathElement; target: string | null }
  | { type: 'marquee'; x0: number; y0: number; rect: SVGRectElement; additive: boolean };
const pointers = new Map<number, { x: number; y: number }>();
let drag: Drag | null = null;
let pinch: { d: number; k: number; cx: number; cy: number; vx: number; vy: number } | null = null;

svg.addEventListener('pointerdown', ev => {
  if (ev.button === 2) return;
  renameBox.hidden = true;
  svg.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: state.view.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: state.view.x, vy: state.view.y };
    drag = null; return;
  }
  const target = ev.target as Element;
  const handle = target.closest('[data-handle]') as SVGCircleElement | null;
  const nodeEl = target.closest('[data-node]') as SVGGElement | null;
  const edgeEl = target.closest('[data-edge]') as SVGGElement | null;
  const additive = ev.shiftKey || ev.metaKey || ev.ctrlKey;

  if (handle && nodeEl) {
    const path = el('path'); gO.appendChild(path);
    drag = { type: 'connect', from: nodeEl.dataset.node!, side: handle.dataset.handle as Side, path, target: null };
    hint('Drop on a component to connect');
    return;
  }
  if (nodeEl) {
    const id = nodeEl.dataset.node!;
    const already = selectedNodeIds().includes(id);
    if (additive) { if (already) { state.multi.delete(id); if (state.sel?.id === id) state.sel = null; } else select({ type: 'node', id }, true); }
    else if (!already) select({ type: 'node', id });
    else if (state.sel?.id !== id) { state.multi.add(state.sel!.id); state.multi.delete(id); state.sel = { type: 'node', id }; }
    const ids = selectedNodeIds();
    const w = toWorld(ev.clientX, ev.clientY);
    const start: Record<string, { x: number; y: number }> = {};
    ids.forEach(i => { const n = state.doc.nodes.find(x => x.id === i)!; start[i] = { x: n.x, y: n.y }; });
    drag = { type: 'node', ids, start, ox: w.x, oy: w.y, moved: false, snapped: false };
    renderAll();
    return;
  }
  if (edgeEl) { select({ type: 'edge', id: edgeEl.dataset.edge! }); renderAll(); return; }
  if (additive || ev.altKey) {
    const w = toWorld(ev.clientX, ev.clientY);
    const rect = el('rect', { class: 'marquee', x: w.x, y: w.y, width: 0, height: 0 }); gO.appendChild(rect);
    drag = { type: 'marquee', x0: w.x, y0: w.y, rect, additive };
    return;
  }
  drag = { type: 'pan', sx: ev.clientX, sy: ev.clientY, vx: state.view.x, vy: state.view.y, moved: false };
});

svg.addEventListener('pointermove', ev => {
  if (!pointers.has(ev.pointerId)) return;
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const k = Math.min(3, Math.max(0.25, pinch.k * d / pinch.d));
    const r = svg.getBoundingClientRect();
    const cx = pinch.cx - r.left, cy = pinch.cy - r.top;
    state.view.k = k; state.view.x = cx - (cx - pinch.vx) * (k / pinch.k); state.view.y = cy - (cy - pinch.vy) * (k / pinch.k);
    applyView(); return;
  }
  if (!drag) return;
  const w = toWorld(ev.clientX, ev.clientY);
  switch (drag.type) {
    case 'node': {
      const dx = w.x - drag.ox, dy = w.y - drag.oy;
      if (!drag.moved && Math.hypot(dx, dy) * state.view.k > 3) {
        drag.moved = true; mutate(() => {});
        drag.ids.forEach(id => nodeEls.get(id)?.classList.add('dragging'));
      }
      if (!drag.moved) return;
      const start = drag.start;
      drag.ids.forEach(id => { const n = state.doc.nodes.find(x => x.id === id)!; n.x = snap(start[id].x + dx); n.y = snap(start[id].y + dy); });
      renderCanvas(); break;
    }
    case 'pan':
      if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 3) drag.moved = true;
      state.view.x = drag.vx + ev.clientX - drag.sx; state.view.y = drag.vy + ev.clientY - drag.sy; applyView(); break;
    case 'connect': {
      const a = state.doc.nodes.find(n => n.id === (drag as any).from)!;
      const p = port(a, drag.side);
      const over = (document.elementFromPoint(ev.clientX, ev.clientY) as Element | null)?.closest('[data-node]') as SVGGElement | null;
      const tid = over && over.dataset.node !== a.id ? over.dataset.node! : null;
      if (tid !== drag.target) { nodeEls.get(drag.target || '')?.classList.remove('target'); drag.target = tid; nodeEls.get(tid || '')?.classList.add('target'); }
      let q = w, s2: Side = drag.side === 'e' ? 'w' : drag.side === 'w' ? 'e' : drag.side === 'n' ? 's' : 'n';
      if (tid) { const b = state.doc.nodes.find(n => n.id === tid)!; const sides = routeSides(a, b); s2 = sides[1]; q = port(b, s2); }
      drag.path.setAttribute('d', pathBetween(p, q, drag.side, s2)); break;
    }
    case 'marquee': {
      const x = Math.min(drag.x0, w.x), y = Math.min(drag.y0, w.y), wd = Math.abs(w.x - drag.x0), ht = Math.abs(w.y - drag.y0);
      set(drag.rect, { x, y, width: wd, height: ht });
      state.multi.clear(); if (!drag.additive) state.sel = null;
      state.doc.nodes.forEach(n => { const nw = KINDS[n.kind].w; if (n.x < x + wd && n.x + nw > x && n.y < y + ht && n.y + NODE_H > y) state.multi.add(n.id); });
      renderCanvas(); break;
    }
  }
});

function up(ev: PointerEvent) {
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!drag) return;
  const d = drag; drag = null;
  switch (d.type) {
    case 'pan': if (!d.moved) { select(null); renderAll(); } break;
    case 'node': d.ids.forEach(id => nodeEls.get(id)?.classList.remove('dragging')); renderAll(); break;
    case 'connect': {
      d.path.remove(); hint(null);
      nodeEls.get(d.target || '')?.classList.remove('target');
      if (d.target && !state.doc.edges.some(e => e.from === d.from && e.to === d.target)) {
        const e: Edge = { id: nextId('e'), from: d.from, to: d.target, calls: 1, endpoint: null };
        mutate(() => state.doc.edges.push(e));
        select({ type: 'edge', id: e.id }); renderAll();
      } else if (d.target) hint('Already connected', 1200);
      break;
    }
    case 'marquee': {
      d.rect.remove();
      const ids = [...state.multi];
      if (ids.length && !state.sel) { state.sel = { type: 'node', id: ids[0] }; state.multi.delete(ids[0]); }
      renderAll(); break;
    }
  }
}
svg.addEventListener('pointerup', up);
svg.addEventListener('pointercancel', up);
svg.addEventListener('contextmenu', ev => ev.preventDefault());

// double-click to rename
svg.addEventListener('dblclick', ev => {
  const nodeEl = (ev.target as Element).closest('[data-node]') as SVGGElement | null;
  if (!nodeEl) return;
  const n = state.doc.nodes.find(x => x.id === nodeEl.dataset.node)!;
  const s = toScreen(n.x + 12 + ICON + 9, n.y + 26);
  const r = stage.getBoundingClientRect();
  renameBox.style.left = (s.x - r.left) + 'px'; renameBox.style.top = (s.y - r.top - 12) + 'px';
  renameBox.style.width = Math.max(120, (KINDS[n.kind].w - 60) * state.view.k) + 'px';
  renameBox.value = n.name; renameBox.hidden = false; renameBox.focus(); renameBox.select();
  const commit = () => { if (renameBox.hidden) return; renameBox.hidden = true; if (renameBox.value !== n.name) { mutate(() => (n.name = renameBox.value)); renderAll(); } };
  renameBox.onblur = commit;
  renameBox.onkeydown = e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { renameBox.hidden = true; } e.stopPropagation(); };
});

// zoom
export function zoomAt(cx: number, cy: number, f: number) {
  const k = Math.min(3, Math.max(0.25, state.view.k * f));
  state.view.x = cx - (cx - state.view.x) * (k / state.view.k);
  state.view.y = cy - (cy - state.view.y) * (k / state.view.k);
  state.view.k = k; applyView();
}
svg.addEventListener('wheel', ev => {
  ev.preventDefault();
  const r = svg.getBoundingClientRect();
  if (ev.ctrlKey || ev.metaKey) { zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.01)); return; }
  // trackpad / wheel pans; pinch (ctrlKey) zooms
  state.view.x -= ev.deltaX; state.view.y -= ev.deltaY; applyView();
}, { passive: false });

export function fit(animated = true) {
  const { doc } = state;
  if (!doc.nodes.length) return;
  const r = svg.getBoundingClientRect();
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  doc.nodes.forEach(n => { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + KINDS[n.kind].w); y1 = Math.max(y1, n.y + NODE_H); });
  const pad = 48;
  const k = Math.min(1.5, Math.max(0.25, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0))));
  const target = { k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k };
  if (!animated || reduceMotion()) { Object.assign(state.view, target); applyView(); return; }
  const from = { ...state.view }, t0 = performance.now(), dur = 240;
  const tick = (now: number) => {
    const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
    state.view.k = from.k + (target.k - from.k) * e; state.view.x = from.x + (target.x - from.x) * e; state.view.y = from.y + (target.y - from.y) * e;
    applyView(); if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------- adding nodes ----------
export function addNode(kind: Kind, x?: number, y?: number) {
  if (x === undefined || y === undefined) {
    const r = svg.getBoundingClientRect();
    const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    x = c.x - KINDS[kind].w / 2; y = c.y - NODE_H / 2;
  }
  const n = makeNode(kind, snap(x), snap(y));
  mutate(() => state.doc.nodes.push(n));
  select({ type: 'node', id: n.id });
  renderAll();
  return n;
}
// drag from rail → drop on canvas
document.querySelectorAll<HTMLElement>('#rail [data-add]').forEach(b => {
  b.addEventListener('dragstart', ev => { ev.dataTransfer!.setData('text/kind', b.dataset.add!); ev.dataTransfer!.effectAllowed = 'copy'; });
  b.addEventListener('click', () => addNode(b.dataset.add as Kind));
});
stage.addEventListener('dragover', ev => { ev.preventDefault(); ev.dataTransfer!.dropEffect = 'copy'; stage.classList.add('dropping'); });
stage.addEventListener('dragleave', () => stage.classList.remove('dropping'));
stage.addEventListener('drop', ev => {
  ev.preventDefault(); stage.classList.remove('dropping');
  const kind = ev.dataTransfer!.getData('text/kind') as Kind; if (!KINDS[kind]) return;
  const w = toWorld(ev.clientX, ev.clientY);
  addNode(kind, w.x - KINDS[kind].w / 2, w.y - NODE_H / 2);
});

export function nudge(dx: number, dy: number) {
  const ids = selectedNodeIds(); if (!ids.length) return;
  mutate(() => ids.forEach(id => { const n = state.doc.nodes.find(x => x.id === id)!; n.x += dx; n.y += dy; }));
  renderCanvas();
}

on('canvas', draw);
