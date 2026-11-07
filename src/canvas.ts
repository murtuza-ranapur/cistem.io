import { KINDS, NODE_H, ICON, EXP, nodeWidth, nodeWidthFor, nodeHeight, topicFields, foreignKeys, FRAME_PAD, FRAME_HEAD, CONTAINER_KINDS, nextId, makeNode, makeContainer, ancestry, type Node, type Edge, type Kind, type Container, type Frame, type ContainerKind } from './model';
import { state, fmt, on, renderCanvas, renderAll, mutate, select, selectedNodeIds } from './state';

const stage = document.getElementById('stage') as HTMLElement;
const svg = document.getElementById('svg') as unknown as SVGSVGElement;
const world = document.getElementById('world') as unknown as SVGGElement;
const gN = document.getElementById('nodes') as unknown as SVGGElement;
const gE = document.getElementById('edges') as unknown as SVGGElement;
const gF = document.getElementById('frames') as unknown as SVGGElement;
const gO = document.getElementById('overlay') as unknown as SVGGElement;
const gL = document.getElementById('labels') as unknown as SVGGElement;
const gFk = document.getElementById('fks') as unknown as SVGGElement;
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
const textWidth = (t: SVGTextElement) => { try { return t.getComputedTextLength(); } catch { return (t.textContent?.length ?? 0) * 7; } };
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
const detailOf = (n: Node) => state.doc.detail?.[n.id];
const W = (n: Node) => nodeWidthFor(n, detailOf(n));
const H = (n: Node) => nodeHeight(n, detailOf(n));
function port(n: Node, side: Side) {
  const w = W(n), h = H(n);
  // side ports sit at the compact header height so expanded nodes still connect near the title
  const py = n.y + Math.min(h, NODE_H) / 2;
  return side === 'e' ? { x: n.x + w, y: py } : side === 'w' ? { x: n.x, y: py }
    : side === 'n' ? { x: n.x + w / 2, y: n.y } : { x: n.x + w / 2, y: n.y + h };
}
/** Choose sides so the edge leaves/enters along the dominant direction. */
function routeSides(a: Node, b: Node): [Side, Side] {
  const ac = { x: a.x + W(a) / 2, y: a.y + NODE_H / 2 }, bc = { x: b.x + W(b) / 2, y: b.y + NODE_H / 2 };
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

// ---------- container frames ----------
/**
 * Frames always fit their members (nodes + child frames) with padding; a stored frame is used
 * only for an empty container, so it has somewhere to be. Computed per render, cheap at this scale.
 */
/** Nodes currently being dragged, with the positions they had when the drag started. While a drag is
 *  in progress frames fit the *start* positions, so a frame doesn't chase the node you're pulling out of it. */
let dragging: Record<string, { x: number; y: number }> | null = null;
export function computeFrames(): Record<string, Frame> {
  const { doc } = state;
  const out: Record<string, Frame> = {};
  const px = (n: Node) => dragging?.[n.id]?.x ?? n.x, py = (n: Node) => dragging?.[n.id]?.y ?? n.y;
  const depth = (id: string) => ancestry(doc, id).length;
  const order = [...doc.containers].sort((a, b) => depth(b.id) - depth(a.id)); // deepest first
  for (const c of order) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of doc.nodes) if ((n.container ?? null) === c.id) { x0 = Math.min(x0, px(n)); y0 = Math.min(y0, py(n)); x1 = Math.max(x1, px(n) + W(n)); y1 = Math.max(y1, py(n) + H(n)); }
    for (const k of doc.containers) if ((k.parent ?? null) === c.id && out[k.id]) { const f = out[k.id]; x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y); x1 = Math.max(x1, f.x + f.w); y1 = Math.max(y1, f.y + f.h); }
    if (x0 === Infinity) { const st = doc.frames[c.id]; out[c.id] = st ? { ...st } : { x: 40, y: 40, w: 260, h: 140 }; continue; }
    out[c.id] = { x: x0 - FRAME_PAD, y: y0 - FRAME_PAD - FRAME_HEAD, w: x1 - x0 + FRAME_PAD * 2, h: y1 - y0 + FRAME_PAD * 2 + FRAME_HEAD };
  }
  return out;
}
let frames: Record<string, Frame> = {};
export const currentFrames = () => frames;
/** Deepest container whose frame contains the point, excluding `skip` and its descendants. */
export function containerAt(x: number, y: number, skip: string | null = null): string | null {
  const { doc } = state;
  let best: string | null = null, bestDepth = -1;
  for (const c of doc.containers) {
    if (skip && ancestry(doc, c.id).includes(skip)) continue;
    const f = frames[c.id]; if (!f) continue;
    if (x >= f.x && y >= f.y && x <= f.x + f.w && y <= f.y + f.h) { const d = ancestry(doc, c.id).length; if (d > bestDepth) { best = c.id; bestDepth = d; } }
  }
  return best;
}
const frameEls = new Map<string, SVGGElement>();
function buildFrame(c: Container): SVGGElement {
  const g = el('g', { class: 'frame', 'data-container': c.id });
  g.appendChild(el('rect', { class: 'fbody', rx: 12 }));
  g.appendChild(el('rect', { class: 'fhead', height: FRAME_HEAD }));
  g.appendChild(el('use', { href: '#ic-container', class: 'ficon', width: 14, height: 14 }));
  g.appendChild(el('text', { class: 'ftitle' }));
  g.appendChild(el('text', { class: 'fkind' }));
  g.appendChild(el('text', { class: 'fmeta', 'text-anchor': 'end' }));
  return g;
}
function updateFrame(g: SVGGElement, c: Container, f: Frame) {
  const isSel = state.sel?.type === 'container' && state.sel.id === c.id;
  const d = ancestry(state.doc, c.id).length - 1;
  g.setAttribute('class', 'frame k-' + c.kind + (isSel ? ' sel' : '') + (g.classList.contains('target') ? ' target' : ''));
  g.style.setProperty('--h', String(CONTAINER_KINDS[c.kind].hue));
  g.style.setProperty('--depth', String(d));
  set(g.querySelector('.fbody')!, { x: f.x, y: f.y, width: f.w, height: f.h });
  set(g.querySelector('.fhead')!, { x: f.x, y: f.y, width: f.w, rx: 12 });
  set(g.querySelector('.ficon')!, { x: f.x + 12, y: f.y + 8 });
  const avail = f.w - 44;
  const t = g.querySelector('.ftitle') as SVGTextElement; set(t, { x: f.x + 32, y: f.y + 20 });
  t.textContent = c.name; let tw = textWidth(t); if (tw > avail) { t.textContent = trunc(c.name, Math.max(3, Math.floor(c.name.length * avail / tw))); tw = textWidth(t); }
  const k = g.querySelector('.fkind') as SVGTextElement; set(k, { x: f.x + 32 + tw + 8, y: f.y + 20 });
  k.textContent = CONTAINER_KINDS[c.kind].label.toLowerCase() + (c.provider ? ` · ${c.provider}` : '');
  const kw = textWidth(k);
  if (tw + 8 + kw > avail) k.textContent = '';
  const m = g.querySelector('.fmeta') as SVGTextElement; set(m, { x: f.x + f.w - 12, y: f.y + 20 }); m.textContent = c.owner ?? '';
  // owner sits at the right edge; drop it if it would run into the title/kind
  if (m.textContent && textWidth(m) + 16 > f.w - (32 + tw + 8 + (k.textContent ? kw + 12 : 0))) m.textContent = '';
}

// ---------- keyed rendering ----------
const nodeEls = new Map<string, SVGGElement>();
const edgeEls = new Map<string, SVGGElement>();
const labelEls = new Map<string, SVGGElement>();
let firstDraw = true;

function buildNode(n: Node): SVGGElement {
  const w = nodeWidth(n);
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
  g.appendChild(el('g', { class: 'detail' }));
  if (n.kind === 'db' || n.kind === 'service' || n.kind === 'queue') {
    const c = el('g', { class: 'chev', 'data-toggle': n.id });
    c.appendChild(el('rect', { x: -10, y: -10, width: 20, height: 20, rx: 5 }));
    c.appendChild(el('path', { d: 'M-4 -2 L0 2 L4 -2' }));
    g.appendChild(c);
  }
  (['n', 'e', 's', 'w'] as Side[]).forEach(s => {
    const p = port({ ...n, x: 0, y: 0 } as Node, s);
    g.appendChild(el('circle', { class: 'handle', 'data-handle': s, cx: p.x, cy: p.y, r: 5 }));
  });
  return g;
}

const tag = (g: SVGGElement, x: number, y: number, label: string, cls: string) => {
  const r = el('rect', { class: 'tag ' + cls, x, y: y - 9, width: label.length * 6 + 8, height: 12, rx: 3 }); g.appendChild(r);
  const t = el('text', { class: 'tagt', x: x + 4, y: y }); t.textContent = label; g.appendChild(t);
  return label.length * 6 + 8;
};
/** Where a table's column row sits, in node-local coordinates (for FK lines). */
const rowAnchors = new Map<string, { x: number; y: number; w: number }>(); // key: node|table|col
function drawDetail(g: SVGGElement, n: Node, w: number) {
  const d = g.querySelector('.detail') as SVGGElement; d.innerHTML = '';
  if (detailOf(n) !== 'expanded') return;
  let y = NODE_H + EXP.sectionPad;
  d.appendChild(el('line', { class: 'sep', x1: 12, y1: NODE_H + 2, x2: w - 12, y2: NODE_H + 2 }));
  if (n.kind === 'db') {
    for (const t of n.tables ?? []) {
      d.appendChild(el('rect', { class: 'tbl', x: 12, y, width: w - 24, height: EXP.tableHead + (t.columns?.length ?? 0) * EXP.row + EXP.tablePad, rx: 5 }));
      d.appendChild(el('rect', { class: 'tblhead', x: 12, y, width: w - 24, height: EXP.tableHead, rx: 5 }));
      const th = el('text', { class: 'tname', x: 20, y: y + 15 }); th.textContent = t.name; d.appendChild(th);
      const cnt = el('text', { class: 'tcount', x: w - 20, y: y + 15, 'text-anchor': 'end' }); cnt.textContent = `${t.columns?.length ?? 0} cols`; d.appendChild(cnt);
      let ry = y + EXP.tableHead + 12;
      for (const c of t.columns ?? []) {
        rowAnchors.set(`${n.id}|${t.name}|${c.name}`, { x: n.x + 12, y: n.y + ry - 4, w: w - 24 });
        let x = 20;
        if (c.pk) x += tag(d, x, ry, 'PK', 'pk') + 4;
        if (c.references) x += tag(d, x, ry, 'FK', 'fk') + 4;
        if (c.unique && !c.pk) x += tag(d, x, ry, 'UQ', 'uq') + 4;
        if (c.index && !c.pk && !c.unique) x += tag(d, x, ry, 'IX', 'ix') + 4;
        const cn = el('text', { class: 'col' + (c.pk ? ' pkcol' : ''), x, y: ry }); cn.textContent = trunc(c.name, Math.max(6, (w - x - 90) / 6.4)); d.appendChild(cn);
        const ct = el('text', { class: 'ctype', x: w - 20, y: ry, 'text-anchor': 'end' }); ct.textContent = c.type + (c.nullable ? '?' : ''); d.appendChild(ct);
        ry += EXP.row;
      }
      y += EXP.tableHead + (t.columns?.length ?? 0) * EXP.row + EXP.tablePad + EXP.tableGap;
    }
  } else if (n.kind === 'service') {
    for (const ep of n.endpoints ?? []) {
      const m = el('text', { class: 'method m-' + ep.method.toLowerCase(), x: 14, y: y + 12 }); m.textContent = ep.method; d.appendChild(m);
      const pth = el('text', { class: 'path', x: 62, y: y + 12 }); pth.textContent = trunc(ep.path, (w - 74 - 40) / 6.4); d.appendChild(pth);
      const hc = (ep.headers?.length ?? 0);
      const meta = el('text', { class: 'ctype', x: w - 14, y: y + 12, 'text-anchor': 'end' }); meta.textContent = [hc ? `${hc}h` : '', ep.req ? 'req' : '', ep.res ? 'res' : ''].filter(Boolean).join(' '); d.appendChild(meta);
      y += EXP.endpointRow;
    }
  } else if (n.kind === 'queue') {
    for (const t of n.topics ?? []) {
      const tn = el('text', { class: 'tname', x: 14, y: y + 13 }); tn.textContent = trunc(t.name, (w - 90) / 7); d.appendChild(tn);
      const pc = el('text', { class: 'tcount', x: w - 14, y: y + 13, 'text-anchor': 'end' }); pc.textContent = `${t.partitions ?? '?'} partitions`; d.appendChild(pc);
      y += EXP.topicHead;
      for (const [fname, ftype] of topicFields(t)) {
        let fx = 22;
        if (t.key && t.key === fname) fx += tag(d, fx, y + 10, 'KEY', 'pk') + 4;
        const f = el('text', { class: 'col', x: fx, y: y + 10 }); f.textContent = fname; d.appendChild(f);
        const ft = el('text', { class: 'ctype', x: w - 14, y: y + 10, 'text-anchor': 'end' }); ft.textContent = ftype; d.appendChild(ft);
        y += EXP.topicRow;
      }
      y += 6;
    }
  }
}
function updateNode(g: SVGGElement, n: Node) {
  const r = state.results.nodes[n.id], w = W(n), h = H(n), expanded = detailOf(n) === 'expanded';
  set(g.querySelector('rect.body')!, { width: w, height: h });
  set(g.querySelector('rect.accent')!, { height: h });
  if (n.kind !== 'entry') { set(g.querySelector('rect.bar')!, { width: w - 24 }); set(g.querySelector('.pct')!, { x: w - 12 }); }
  (['e', 'n', 's', 'w'] as Side[]).forEach(sd => { const p = port({ ...n, x: 0, y: 0 } as Node, sd); set(g.querySelector(`[data-handle="${sd}"]`)!, { cx: p.x, cy: p.y }); });
  const chev = g.querySelector('.chev'); if (chev) { chev.setAttribute('transform', `translate(${w - 20} 20)${expanded ? ' rotate(180 0 0)' : ''}`); }
  drawDetail(g, n, w);
  const isSel = (state.sel?.type === 'node' && state.sel.id === n.id) || state.multi.has(n.id);
  g.setAttribute('class', 'node k-' + n.kind + (isSel ? ' sel' : '') + (expanded ? ' expanded' : '') + (r.status === 'crit' ? ' crit' : '') + (g.classList.contains('enter') ? ' enter' : '') + (g.classList.contains('dragging') ? ' dragging' : ''));
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
  const cross = state.results.crossings?.[e.id] || 0;
  g.setAttribute('class', 'edge' + (isSel ? ' sel' : '') + (crit ? ' crit' : '') + (cross ? ' cross' : '') + (g.classList.contains('enter') ? ' enter' : ''));
  const line = g.querySelector('.line') as SVGPathElement;
  set(g.querySelector('.hit')!, { d });
  set(line, { d, 'marker-end': isSel ? 'url(#arrowSel)' : crit ? 'url(#arrowCrit)' : 'url(#arrow)' });
  if (g.classList.contains('enter')) { const len = line.getTotalLength(); line.style.strokeDasharray = String(len); line.style.setProperty('--len', String(len)); }
  else { line.style.strokeDasharray = ''; }
  // label at the curve midpoint
  const mid = line.getTotalLength() ? line.getPointAtLength(line.getTotalLength() / 2) : { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  const txt = `${e.calls}× · ${fmt(state.results.edges[e.id] || 0)} rps` + (cross ? ` · +${cross}ms` : '');
  const tw = txt.length * 6.1 + 12;
  const l = labelEls.get(e.id)!;
  const tooShort = line.getTotalLength() < tw + 36 && !isSel;
  // hide a label that would land on a node (labels are decoration; the inspector has the number)
  const lx = mid.x - tw / 2, ly = mid.y - 9, lw = tw, lh = 18;
  const onNode = !isSel && state.doc.nodes.some(n => { const nw = W(n), nh = H(n); return lx < n.x + nw && lx + lw > n.x && ly < n.y + nh && ly + lh > n.y; });
  l.setAttribute('class', 'edge-label' + (isSel ? ' sel' : '') + (tooShort || onNode ? ' hidden' : ''));
  set(l.querySelector('.lbl')!, { x: mid.x - tw / 2, y: mid.y - 9, width: tw, height: 18 });
  const t = l.querySelector('text')!; set(t, { x: mid.x, y: mid.y + 3.5 }); t.textContent = txt;
}

export function draw() {
  const { doc, results } = state;
  applyView();
  const byId = Object.fromEntries(doc.nodes.map(n => [n.id, n]));
  const animate = !firstDraw && !reduceMotion();

  rowAnchors.clear();
  // frames (parents drawn before children so children sit on top)
  frames = computeFrames();
  const liveC = new Set(doc.containers.map(c => c.id));
  for (const [id, g] of frameEls) if (!liveC.has(id)) { frameEls.delete(id); g.remove(); }
  const ordered = [...doc.containers].sort((a, b) => ancestry(doc, a.id).length - ancestry(doc, b.id).length);
  for (const c of ordered) {
    let g = frameEls.get(c.id);
    if (!g) { g = buildFrame(c); frameEls.set(c.id, g); }
    gF.appendChild(g); // re-append keeps parent-before-child order
    updateFrame(g, c, frames[c.id]);
  }

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

  // foreign-key lines between table rows (only where both ends are drawn expanded)
  gFk.innerHTML = '';
  for (const fk of foreignKeys(doc)) {
    const a = rowAnchors.get(`${fk.from.node}|${fk.from.table}|${fk.from.col}`);
    const b = rowAnchors.get(`${fk.to.node}|${fk.to.table}|${fk.to.col}`);
    if (!a || !b) continue;
    const sameNode = fk.from.node === fk.to.node;
    // leave from the right edge of the row, arrive at the right edge of the target row, loop outside the box
    const ax = a.x + a.w, bx = b.x + b.w;
    const bulge = sameNode ? 22 : Math.max(40, Math.abs(bx - ax) / 2);
    const d = sameNode
      ? `M${ax} ${a.y} C${ax + bulge} ${a.y} ${bx + bulge} ${b.y} ${bx} ${b.y}`
      : `M${ax} ${a.y} C${ax + bulge} ${a.y} ${b.x - bulge} ${b.y} ${b.x} ${b.y}`;
    const p = el('path', { class: 'fk', d, 'marker-end': 'url(#crow)' });
    gFk.appendChild(p);
  }

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
  | { type: 'marquee'; x0: number; y0: number; rect: SVGRectElement; additive: boolean }
  | { type: 'frame'; id: string; nodeIds: string[]; start: Record<string, { x: number; y: number }>; frameStart: Record<string, Frame>; ox: number; oy: number; moved: boolean; target: string | null };
const pointers = new Map<number, { x: number; y: number }>();
let drag: Drag | null = null;
let lastClick: { id: string; t: number; x: number; y: number } | null = null;
let pinch: { d: number; k: number; cx: number; cy: number; vx: number; vy: number } | null = null;

svg.addEventListener('pointerdown', ev => {
  if (ev.button === 2) return;
  // Own double-click detection: selecting a node re-appends it (to bring it on top), which stops
  // the browser from pairing the two clicks into a dblclick event.
  {
    const nEl = (ev.target as Element).closest('[data-node]') as SVGGElement | null;
    const onControl = !!(ev.target as Element).closest('[data-handle],[data-toggle]');
    if (nEl && !onControl && lastClick && lastClick.id === nEl.dataset.node && performance.now() - lastClick.t < 400 && Math.hypot(ev.clientX - lastClick.x, ev.clientY - lastClick.y) < 6) {
      lastClick = null; startRename(ev as unknown as MouseEvent); return;
    }
    lastClick = nEl && !onControl ? { id: nEl.dataset.node!, t: performance.now(), x: ev.clientX, y: ev.clientY } : null;
  }
  if (!renameBox.hidden) { renameBox.onblur?.(new FocusEvent('blur')); }
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

  const toggle = target.closest('[data-toggle]') as SVGGElement | null;
  if (toggle) { toggleDetail(toggle.dataset.toggle!); return; }
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
  const frameEl = target.closest('[data-container]') as SVGGElement | null;
  if (frameEl && !additive && !ev.altKey) {
    const id = frameEl.dataset.container!;
    select({ type: 'container', id });
    const w = toWorld(ev.clientX, ev.clientY);
    const nodeIds = state.doc.nodes.filter(n => ancestry(state.doc, n.container).includes(id)).map(n => n.id);
    const start: Record<string, { x: number; y: number }> = {};
    nodeIds.forEach(i => { const n = state.doc.nodes.find(x => x.id === i)!; start[i] = { x: n.x, y: n.y }; });
    const frameStart: Record<string, Frame> = {};
    state.doc.containers.filter(c => ancestry(state.doc, c.id).includes(id)).forEach(c => { frameStart[c.id] = { ...(state.doc.frames[c.id] ?? frames[c.id]) }; });
    drag = { type: 'frame', id, nodeIds, start, frameStart, ox: w.x, oy: w.y, moved: false, target: null };
    renderAll();
    return;
  }
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
        dragging = drag.start;
        drag.ids.forEach(id => nodeEls.get(id)?.classList.add('dragging'));
      }
      if (!drag.moved) return;
      const start = drag.start;
      drag.ids.forEach(id => { const n = state.doc.nodes.find(x => x.id === id)!; n.x = snap(start[id].x + dx); n.y = snap(start[id].y + dy); });
      // highlight the frame the pointer is over (that's where the node will land)
      const over = containerAt(w.x, w.y);
      const ids = drag.ids;
      frameEls.forEach((g, id) => g.classList.toggle('target', id === over && !ids.some(nid => (state.doc.nodes.find(x => x.id === nid)?.container ?? null) === over)));
      renderCanvas(); break;
    }
    case 'frame': {
      const dx = w.x - drag.ox, dy = w.y - drag.oy;
      if (!drag.moved && Math.hypot(dx, dy) * state.view.k > 3) { drag.moved = true; mutate(() => {}); }
      if (!drag.moved) return; // (no `dragging` snapshot here: the frame must follow its members)
      const d = drag;
      d.nodeIds.forEach(id => { const n = state.doc.nodes.find(x => x.id === id)!; n.x = snap(d.start[id].x + dx); n.y = snap(d.start[id].y + dy); });
      // empty containers keep a stored frame; move those too
      for (const cid in d.frameStart) { const f = d.frameStart[cid]; state.doc.frames[cid] = { ...f, x: snap(f.x + dx), y: snap(f.y + dy) }; }
      const over = containerAt(w.x, w.y, d.id);
      const cur = state.doc.containers.find(c => c.id === d.id)!;
      d.target = over !== (cur.parent ?? null) ? over : null;
      frameEls.forEach((g, id) => g.classList.toggle('target', id === over && over !== (cur.parent ?? null)));
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
      state.doc.nodes.forEach(n => { const nw = W(n), nh = H(n); if (n.x < x + wd && n.x + nw > x && n.y < y + ht && n.y + nh > y) state.multi.add(n.id); });
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
    case 'node': {
      d.ids.forEach(id => nodeEls.get(id)?.classList.remove('dragging'));
      frameEls.forEach(g => g.classList.remove('target'));
      if (d.moved) {
        // decide the new home with frames fitted to the *other* nodes, by where the pointer let go
        frames = computeFrames();
        const w = toWorld(ev.clientX, ev.clientY);
        const into = containerAt(w.x, w.y);
        d.ids.forEach(id => { const n = state.doc.nodes.find(x => x.id === id)!; if ((n.container ?? null) !== into) n.container = into; });
      }
      dragging = null;
      renderAll(); break;
    }
    case 'frame': {
      frameEls.forEach(g => g.classList.remove('target'));
      dragging = null;
      if (d.moved && d.target !== null) {
        const c = state.doc.containers.find(x => x.id === d.id)!;
        c.parent = d.target;
      } else if (d.moved) {
        const c = state.doc.containers.find(x => x.id === d.id)!;
        const f = frames[d.id]; const over = containerAt(f.x + f.w / 2, f.y + 8, d.id);
        if (over !== (c.parent ?? null)) c.parent = over;
      }
      renderAll(); break;
    }
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
svg.addEventListener('dblclick', ev => startRename(ev));
function startRename(ev: MouseEvent) {
  const nodeEl = (ev.target as Element).closest('[data-node]') as SVGGElement | null;
  if (!nodeEl) return;
  const n = state.doc.nodes.find(x => x.id === nodeEl.dataset.node)!;
  const s = toScreen(n.x + 12 + ICON + 9, n.y + 26);
  const r = stage.getBoundingClientRect();
  renameBox.style.left = (s.x - r.left) + 'px'; renameBox.style.top = (s.y - r.top - 12) + 'px';
  renameBox.style.width = Math.max(120, (W(n) - 60) * state.view.k) + 'px';
  renameBox.value = n.name; renameBox.hidden = false;
  renameBox.onblur = null;   // (re)armed below, after focus has settled
  setTimeout(() => { renameBox.focus(); renameBox.select(); renameBox.onblur = commit; }, 0);
  const commit = () => { if (renameBox.hidden) return; renameBox.hidden = true; if (renameBox.value !== n.name) { mutate(() => (n.name = renameBox.value)); renderAll(); } };
  renameBox.onkeydown = e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { renameBox.hidden = true; } e.stopPropagation(); };
}

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
  if (!doc.nodes.length && !doc.containers.length) return;
  const r = svg.getBoundingClientRect();
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  doc.nodes.forEach(n => { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + W(n)); y1 = Math.max(y1, n.y + H(n)); });
  Object.values(computeFrames()).forEach(f => { x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y); x1 = Math.max(x1, f.x + f.w); y1 = Math.max(y1, f.y + f.h); });
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

/** After the inspector opens, make sure the selected node/frame isn't hidden under it. */
export function revealSelection() {
  const s = state.sel; if (!s || s.type === 'edge') return;
  if (drag) return; // never move the view under a pointer that's mid-gesture
  let box: { x: number; y: number; w: number; h: number } | null = null;
  if (s.type === 'node') { const n = state.doc.nodes.find(x => x.id === s.id); if (n) box = { x: n.x, y: n.y, w: W(n), h: H(n) }; }
  else { const f = frames[s.id]; if (f) box = { x: f.x, y: f.y, w: Math.min(f.w, 360), h: Math.min(f.h, 60) }; }
  if (!box) return;
  const r = svg.getBoundingClientRect(); const pad = 24;
  const sx0 = box.x * state.view.k + state.view.x, sy0 = box.y * state.view.k + state.view.y;
  const sx1 = sx0 + box.w * state.view.k, sy1 = sy0 + box.h * state.view.k;
  let dx = 0, dy = 0;
  if (sx1 > r.width - pad) dx = r.width - pad - sx1; else if (sx0 < pad) dx = pad - sx0;
  if (sy1 > r.height - pad) dy = r.height - pad - sy1; else if (sy0 < pad) dy = pad - sy0;
  if (!dx && !dy) return;
  const from = { x: state.view.x, y: state.view.y }, t0 = performance.now(), dur = reduceMotion() ? 0 : 200;
  const tick = (now: number) => {
    const t = dur ? Math.min(1, (now - t0) / dur) : 1, e = 1 - Math.pow(1 - t, 3);
    state.view.x = from.x + dx * e; state.view.y = from.y + dy * e; applyView();
    if (t < 1) requestAnimationFrame(tick);
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
  n.container = containerAt(n.x + nodeWidth(n) / 2, n.y + NODE_H / 2);
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
  const w = toWorld(ev.clientX, ev.clientY);
  if (ev.dataTransfer!.getData('text/container')) { addContainer('cloud', w.x - 130, w.y - 70); return; }
  const kind = ev.dataTransfer!.getData('text/kind') as Kind; if (!KINDS[kind]) return;
  addNode(kind, w.x - KINDS[kind].w / 2, w.y - NODE_H / 2);
});

export function addContainer(kind: ContainerKind = 'cloud', x?: number, y?: number) {
  if (x === undefined || y === undefined) {
    const r = svg.getBoundingClientRect();
    const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    x = c.x - 130; y = c.y - 70;
  }
  const c = makeContainer(kind, kind === 'cloud' ? 'New environment' : CONTAINER_KINDS[kind].label);
  c.parent = containerAt(x + 130, y + 70);
  mutate(() => { state.doc.containers.push(c); state.doc.frames[c.id] = { x: snap(x!), y: snap(y!), w: 260, h: 140 }; });
  select({ type: 'container', id: c.id });
  renderAll();
  return c;
}
document.querySelectorAll<HTMLElement>('#rail [data-add-container]').forEach(b => {
  b.addEventListener('dragstart', ev => { ev.dataTransfer!.setData('text/container', '1'); ev.dataTransfer!.effectAllowed = 'copy'; });
  b.setAttribute('draggable', 'true');
  b.addEventListener('click', () => addContainer());
});

export function toggleDetail(id: string, to?: 'compact' | 'expanded') {
  const cur = state.doc.detail[id] ?? 'compact';
  const next = to ?? (cur === 'expanded' ? 'compact' : 'expanded');
  mutate(() => { if (next === 'compact') delete state.doc.detail[id]; else state.doc.detail[id] = next; });
  renderAll();
}
export function setAllDetail(to: 'compact' | 'expanded') {
  mutate(() => {
    state.doc.detail = {};
    if (to === 'expanded') state.doc.nodes.forEach(n => { if ((n.kind === 'db' && n.tables?.length) || (n.kind === 'service' && n.endpoints?.length) || (n.kind === 'queue' && n.topics?.length)) state.doc.detail[n.id] = 'expanded'; });
  });
  renderAll();
}

export function nudge(dx: number, dy: number) {
  const ids = selectedNodeIds(); if (!ids.length) return;
  mutate(() => ids.forEach(id => { const n = state.doc.nodes.find(x => x.id === id)!; n.x += dx; n.y += dy; }));
  renderCanvas();
}

on('canvas', draw);
