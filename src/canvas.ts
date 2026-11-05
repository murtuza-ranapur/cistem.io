import { KINDS, NODE_H, ICON, nextId, type Node, type Edge, type Kind } from './model';
import { state, fmt, on, renderCanvas, renderAll } from './state';

const svg = document.getElementById('svg') as unknown as SVGSVGElement;
const world = document.getElementById('world') as unknown as SVGGElement;
const gN = document.getElementById('nodes') as unknown as SVGGElement;
const gE = document.getElementById('edges') as unknown as SVGGElement;
const hintEl = document.getElementById('hint') as HTMLElement;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}
const anchor = (n: Node, side: 'in' | 'out') => {
  const w = KINDS[n.kind].w;
  return side === 'out' ? { x: n.x + w, y: n.y + NODE_H / 2 } : { x: n.x, y: n.y + NODE_H / 2 };
};
const trunc = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

export function applyView() {
  world.setAttribute('transform', `translate(${state.view.x} ${state.view.y}) scale(${state.view.k})`);
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

export function draw() {
  const { doc, sel, results } = state;
  applyView();
  gE.innerHTML = ''; gN.innerHTML = '';
  const byId = Object.fromEntries(doc.nodes.map(n => [n.id, n]));

  doc.edges.forEach(e => {
    const a = byId[e.from], b = byId[e.to];
    if (!a || !b) return;
    const p = anchor(a, 'out'), q = anchor(b, 'in');
    const dx = Math.max(40, Math.abs(q.x - p.x) / 2);
    const d = `M${p.x} ${p.y} C${p.x + dx} ${p.y} ${q.x - dx} ${q.y} ${q.x} ${q.y}`;
    const isSel = sel?.type === 'edge' && sel.id === e.id;
    const crit = results.nodes[e.to]?.status === 'crit';
    const g = el('g', { class: 'edge' + (isSel ? ' sel' : '') + (crit ? ' crit' : ''), 'data-edge': e.id });
    g.appendChild(el('path', { d, class: 'hit' }));
    g.appendChild(el('path', { d, 'marker-end': isSel ? 'url(#arrowSel)' : crit ? 'url(#arrowCrit)' : 'url(#arrow)' }));
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
    const ep = b.kind === 'service' && b.endpoints && e.endpoint != null ? b.endpoints[e.endpoint] : null;
    const txt = `${e.calls}× · ${fmt(results.edges[e.id] || 0)} rps` + (ep ? `  ${ep.method} ${trunc(ep.path, 22)}` : '');
    const tw = txt.length * 6.2 + 10;
    g.appendChild(el('rect', { class: 'lbl', x: mx - tw / 2, y: my - 9, width: tw, height: 16, rx: 3 }));
    const t = el('text', { x: mx, y: my + 3, 'text-anchor': 'middle' }); t.textContent = txt; g.appendChild(t);
    gE.appendChild(g);
  });

  doc.nodes.forEach(n => {
    const r = results.nodes[n.id], w = KINDS[n.kind].w;
    const isSel = sel?.type === 'node' && sel.id === n.id;
    const g = el('g', { class: 'node k-' + n.kind + (isSel ? ' sel' : ''), transform: `translate(${n.x} ${n.y})`, 'data-node': n.id });
    g.appendChild(el('rect', { class: 'body', width: w, height: NODE_H, rx: 8 }));
    g.appendChild(el('use', { href: '#ic-' + n.kind, class: 'glyph', x: 10, y: 12, width: ICON, height: ICON }));
    const tx = 10 + ICON + 8;
    const k = el('text', { class: 'kind', x: tx, y: 20 }); k.textContent = KINDS[n.kind].label; g.appendChild(k);
    const nm = el('text', { class: 'name', x: tx, y: 37 }); nm.textContent = trunc(n.name || '', (w - tx - 10) / 7.2); g.appendChild(nm);
    const sm = el('text', { class: 'sum', x: 10, y: 55 }); sm.textContent = trunc(summary(n), (w - 20) / 6.3); g.appendChild(sm);
    const st = el('text', { class: 'stat', x: 10, y: 70 });
    st.textContent = n.kind === 'entry' ? `${fmt(r.load)} rps out` : `${fmt(r.load)} / ${fmt(r.cap)} rps · ${r.lat.toFixed(1)}ms`;
    g.appendChild(st);
    if (n.kind !== 'entry') {
      g.appendChild(el('rect', { class: 'bar', x: 10, y: 77, width: w - 20, height: 7, rx: 2 }));
      const u = Math.min(1, isFinite(r.util) ? r.util : 1);
      g.appendChild(el('rect', { class: 'fill ' + r.status, x: 10, y: 77, width: (w - 20) * u, height: 7, rx: 2 }));
      const pct = el('text', { class: 'stat', x: w - 10, y: 70, 'text-anchor': 'end' });
      pct.textContent = isFinite(r.util) ? Math.round(r.util * 100) + '%' : '∞'; g.appendChild(pct);
    }
    gN.appendChild(g);
  });

  const v = results.verdict;
  const vEl = document.getElementById('verdict') as HTMLElement;
  const labels = { ok: 'Handles it', warn: 'Near limit', crit: 'Breaks' };
  vEl.className = 'pill ' + v.status;
  vEl.textContent = labels[v.status] + (v.node ? ` · ${v.node.name}` : '');
  (document.getElementById('lat') as HTMLElement).textContent = `~${v.lat.toFixed(0)}ms p50 path` + (v.converged ? '' : ' · loop not converging');
}

// ---------- interaction ----------
type Drag = { type: 'node'; n: Node; ox: number; oy: number } | { type: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean };
const pointers = new Map<number, { x: number; y: number }>();
let drag: Drag | null = null;
let pinch: { d: number; k: number; cx: number; cy: number; vx: number; vy: number } | null = null;

function toWorld(cx: number, cy: number) {
  const r = svg.getBoundingClientRect();
  return { x: (cx - r.left - state.view.x) / state.view.k, y: (cy - r.top - state.view.y) / state.view.k };
}
export function hint(msg: string | null) {
  if (!msg) { hintEl.hidden = true; return; }
  hintEl.textContent = msg; hintEl.hidden = false;
}
export function setConnect(onOff: boolean) {
  state.connectMode = onOff; state.connectFrom = null;
  document.getElementById('connectBtn')!.classList.toggle('active', onOff);
  hint(onOff ? 'Tap the source node' : null);
}

svg.addEventListener('pointerdown', ev => {
  svg.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: state.view.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: state.view.x, vy: state.view.y };
    drag = null; return;
  }
  const target = ev.target as Element;
  const nodeEl = target.closest('[data-node]') as SVGGElement | null;
  const edgeEl = target.closest('[data-edge]') as SVGGElement | null;
  if (nodeEl) {
    const id = nodeEl.dataset.node!;
    if (state.connectMode) {
      if (!state.connectFrom) { state.connectFrom = id; hint('Now tap the target node'); state.sel = { type: 'node', id }; renderAll(); }
      else if (state.connectFrom !== id) {
        if (!state.doc.edges.some(e => e.from === state.connectFrom && e.to === id)) {
          const e: Edge = { id: nextId('e'), from: state.connectFrom, to: id, calls: 1, endpoint: null };
          state.doc.edges.push(e);
          state.sel = { type: 'edge', id: e.id };
        }
        setConnect(false); renderAll();
      }
      return;
    }
    const n = state.doc.nodes.find(x => x.id === id)!;
    const w = toWorld(ev.clientX, ev.clientY);
    drag = { type: 'node', n, ox: w.x - n.x, oy: w.y - n.y };
    if (!(state.sel?.type === 'node' && state.sel.id === id)) { state.sel = { type: 'node', id }; renderAll(); }
  } else if (edgeEl) {
    state.sel = { type: 'edge', id: edgeEl.dataset.edge! }; renderAll();
  } else {
    drag = { type: 'pan', sx: ev.clientX, sy: ev.clientY, vx: state.view.x, vy: state.view.y, moved: false };
  }
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
  if (drag.type === 'node') {
    const w = toWorld(ev.clientX, ev.clientY);
    drag.n.x = Math.round((w.x - drag.ox) / 8) * 8; drag.n.y = Math.round((w.y - drag.oy) / 8) * 8;
    renderCanvas();
  } else {
    if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 3) drag.moved = true;
    state.view.x = drag.vx + ev.clientX - drag.sx; state.view.y = drag.vy + ev.clientY - drag.sy;
    applyView();
  }
});

function up(ev: PointerEvent) {
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinch = null;
  if (drag?.type === 'pan' && !drag.moved && !state.connectMode) { state.sel = null; renderAll(); }
  drag = null;
}
svg.addEventListener('pointerup', up);
svg.addEventListener('pointercancel', up);

export function zoomAt(cx: number, cy: number, f: number) {
  const k = Math.min(3, Math.max(0.25, state.view.k * f));
  state.view.x = cx - (cx - state.view.x) * (k / state.view.k);
  state.view.y = cy - (cy - state.view.y) * (k / state.view.k);
  state.view.k = k; applyView();
}
svg.addEventListener('wheel', ev => {
  ev.preventDefault();
  const r = svg.getBoundingClientRect();
  zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1.1 : 0.9);
}, { passive: false });

export function fit() {
  const { doc } = state;
  if (!doc.nodes.length) return;
  const r = svg.getBoundingClientRect();
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  doc.nodes.forEach(n => { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + KINDS[n.kind].w); y1 = Math.max(y1, n.y + NODE_H); });
  const pad = 30;
  const k = Math.min(3, Math.max(0.25, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0))));
  state.view.k = k; state.view.x = (r.width - (x1 - x0) * k) / 2 - x0 * k; state.view.y = (r.height - (y1 - y0) * k) / 2 - y0 * k;
  applyView();
}

export function centreOfView() {
  const r = svg.getBoundingClientRect();
  return toWorld(r.left + r.width / 2, r.top + r.height / 2);
}
export function addNodeAtCentre(kind: Kind, make: (k: Kind, x: number, y: number) => Node) {
  const c = centreOfView();
  const n = make(kind, Math.round(c.x / 8) * 8 - 80, Math.round(c.y / 8) * 8 - 40);
  state.doc.nodes.push(n);
  state.sel = { type: 'node', id: n.id };
  renderAll();
}

on('canvas', draw);
