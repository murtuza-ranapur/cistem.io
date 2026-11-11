/** Where things are on the system canvas: node boxes, ports, edge curves, environment frames. Pure functions. */
import {
  NODE_H, FRAME_PAD, FRAME_HEAD, nodeWidthFor, nodeHeight, ancestry, isSource, detailOf, typeDef,
  type Doc, type Node, type Frame,
} from '../../domain/model';
import type { Box, Point } from '../../store/viewport';

export type Side = 'n' | 'e' | 's' | 'w';
export const SIDES: Side[] = ['n', 'e', 's', 'w'];

export const snap = (v: number) => Math.round(v / 8) * 8;
export const nodeW = (doc: Doc, n: Node) => nodeWidthFor(n, doc.detail?.[n.id]);
export const nodeH = (doc: Doc, n: Node) => nodeHeight(n, doc.detail?.[n.id]);
export const nodeBox = (doc: Doc, n: Node): Box => ({ x: n.x, y: n.y, w: nodeW(doc, n), h: nodeH(doc, n) });

/** A port on a node's side, in node-local coordinates. Side ports sit at the compact header height. */
export function localPort(w: number, h: number, side: Side): Point {
  const py = Math.min(h, NODE_H) / 2;
  return side === 'e' ? { x: w, y: py } : side === 'w' ? { x: 0, y: py } : side === 'n' ? { x: w / 2, y: 0 } : { x: w / 2, y: h };
}
export function port(doc: Doc, n: Node, side: Side): Point {
  const p = localPort(nodeW(doc, n), nodeH(doc, n), side);
  return { x: n.x + p.x, y: n.y + p.y };
}
/** Sides so an edge leaves and enters along the dominant direction. */
export function routeSides(doc: Doc, a: Node, b: Node): [Side, Side] {
  const dx = (b.x + nodeW(doc, b) / 2) - (a.x + nodeW(doc, a) / 2), dy = b.y - a.y;
  if (Math.abs(dx) * 1.2 >= Math.abs(dy)) return dx >= 0 ? ['e', 'w'] : ['w', 'e'];
  return dy >= 0 ? ['s', 'n'] : ['n', 's'];
}
export const opposite = (s: Side): Side => ({ e: 'w', w: 'e', n: 's', s: 'n' } as const)[s];

interface Curve { p: Point; c1: Point; c2: Point; q: Point }
function curve(p: Point, q: Point, s1: Side, s2: Side): Curve {
  const horiz = s1 === 'e' || s1 === 'w';
  const d = Math.max(40, (horiz ? Math.abs(q.x - p.x) : Math.abs(q.y - p.y)) / 2);
  const c1 = horiz ? { x: p.x + (s1 === 'e' ? d : -d), y: p.y } : { x: p.x, y: p.y + (s1 === 's' ? d : -d) };
  const c2 = horiz ? { x: q.x + (s2 === 'w' ? -d : d), y: q.y } : { x: q.x, y: q.y + (s2 === 'n' ? -d : d) };
  return { p, c1, c2, q };
}
const at = ({ p, c1, c2, q }: Curve, t: number): Point => {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p.x + b * c1.x + c * c2.x + d * q.x, y: a * p.y + b * c1.y + c * c2.y + d * q.y };
};
export function pathBetween(p: Point, q: Point, s1: Side, s2: Side): string {
  const { c1, c2 } = curve(p, q, s1, s2);
  return `M${p.x} ${p.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${q.x} ${q.y}`;
}

export interface EdgeGeometry { d: string; mid: Point; len: number }
/** The curve between two nodes, its midpoint (where the label goes) and its approximate length. */
export function edgeGeometry(doc: Doc, a: Node, b: Node): EdgeGeometry {
  const [s1, s2] = routeSides(doc, a, b);
  const c = curve(port(doc, a, s1), port(doc, b, s2), s1, s2);
  let len = 0, prev = c.p;
  for (let i = 1; i <= 16; i++) { const pt = at(c, i / 16); len += Math.hypot(pt.x - prev.x, pt.y - prev.y); prev = pt; }
  return { d: pathBetween(c.p, c.q, s1, s2), mid: at(c, 0.5), len };
}

/** The one-line summary under a node's name, from its type's detail (or behaviour). */
export function summary(n: Node): string {
  if (isSource(n)) return (n.platforms || []).map(p => ({ web: 'Web', app: 'App' } as Record<string, string>)[p] || p).join(' · ');
  switch (detailOf(n)) {
    case 'endpoints': {
      // how many, and by method — a list would be cut mid-path; expanding the card shows them all
      const e = n.endpoints || [];
      if (!e.length) return '';
      if (e.length === 1) return `${e[0].method} ${e[0].path}`;
      const by = new Map<string, number>(); for (const x of e) by.set(x.method, (by.get(x.method) ?? 0) + 1);
      return `${e.length} endpoints · ` + [...by].map(([m, k]) => `${m} ${k}`).join(' · ');
    }
    case 'tables': { const t = n.tables || []; return t.length ? t.slice(0, 3).map(x => x.name).join(', ') + (t.length > 3 ? ` +${t.length - 3}` : '') : ''; }
    case 'topic': return [n.cluster, `${n.partitions ?? '?'} partitions`, n.key ? `key ${n.key}` : ''].filter(Boolean).join(' · ');
    case 'message': return [n.fifo ? 'FIFO' : 'standard', n.key ? `group ${n.key}` : ''].filter(Boolean).join(' · ');
  }
  if (typeof n.eviction === 'string') return n.eviction;
  if (typeof n.hitRatio === 'number') return `${Math.round(n.hitRatio * 100)}% hits`;
  return '';
}
export const kindColour = (kind: string) => `var(--c-${kind}, ${typeDef(kind).color})`;

// ---------- environment frames ----------

/**
 * Frames always fit their members (nodes and child frames) with padding; a stored frame is used only for an
 * empty environment, so it has somewhere to be. `pinned` holds positions to use instead of the nodes' own
 * (while dragging nodes, frames fit where they started, so a frame doesn't chase the node pulled out of it).
 */
export function computeFrames(doc: Doc, pinned?: Record<string, Point> | null): Record<string, Frame> {
  const out: Record<string, Frame> = {};
  const px = (n: Node) => pinned?.[n.id]?.x ?? n.x, py = (n: Node) => pinned?.[n.id]?.y ?? n.y;
  const depth = (id: string) => ancestry(doc, id).length;
  for (const c of [...doc.containers].sort((a, b) => depth(b.id) - depth(a.id))) {   // deepest first
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of doc.nodes) if ((n.container ?? null) === c.id) {
      x0 = Math.min(x0, px(n)); y0 = Math.min(y0, py(n)); x1 = Math.max(x1, px(n) + nodeW(doc, n)); y1 = Math.max(y1, py(n) + nodeH(doc, n));
    }
    for (const k of doc.containers) if ((k.parent ?? null) === c.id && out[k.id]) {
      const f = out[k.id]; x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y); x1 = Math.max(x1, f.x + f.w); y1 = Math.max(y1, f.y + f.h);
    }
    if (x0 === Infinity) { const st = doc.frames[c.id]; out[c.id] = st ? { ...st } : { x: 40, y: 40, w: 260, h: 140 }; continue; }
    out[c.id] = { x: x0 - FRAME_PAD, y: y0 - FRAME_PAD - FRAME_HEAD, w: x1 - x0 + FRAME_PAD * 2, h: y1 - y0 + FRAME_PAD * 2 + FRAME_HEAD };
  }
  return out;
}

/** Deepest environment whose frame contains the point, ignoring `skip` and what's inside it. */
export function containerAt(doc: Doc, frames: Record<string, Frame>, x: number, y: number, skip: string | null = null): string | null {
  let best: string | null = null, bestDepth = -1;
  for (const c of doc.containers) {
    if (skip && ancestry(doc, c.id).includes(skip)) continue;
    const f = frames[c.id]; if (!f) continue;
    if (x >= f.x && y >= f.y && x <= f.x + f.w && y <= f.y + f.h) {
      const d = ancestry(doc, c.id).length;
      if (d > bestDepth) { best = c.id; bestDepth = d; }
    }
  }
  return best;
}

/** Everything drawn, for fit-to-view. */
export function diagramBounds(doc: Doc): Box[] {
  return [...doc.nodes.map(n => nodeBox(doc, n)), ...Object.values(computeFrames(doc)).map(f => ({ x: f.x, y: f.y, w: f.w, h: f.h }))];
}

// ---------- caches (documents are immutable: an unchanged node keeps its identity) ----------

const CELL = 256;
const indexes = new WeakMap<Doc, Map<string, Box[]>>();
/** Node boxes bucketed into a coarse grid, so overlap checks only look nearby. */
function nodeIndex(doc: Doc): Map<string, Box[]> {
  let idx = indexes.get(doc);
  if (idx) return idx;
  idx = new Map();
  for (const n of doc.nodes) {
    const b = nodeBox(doc, n);
    for (let cx = Math.floor(b.x / CELL); cx <= Math.floor((b.x + b.w) / CELL); cx++)
      for (let cy = Math.floor(b.y / CELL); cy <= Math.floor((b.y + b.h) / CELL); cy++) {
        const k = cx + ',' + cy; let cell = idx.get(k); if (!cell) idx.set(k, cell = []); cell.push(b);
      }
  }
  indexes.set(doc, idx);
  return idx;
}
/** Does a box overlap any node (for hiding edge labels that would land on one)? */
export function overlapsNode(doc: Doc, b: Box): boolean {
  const idx = nodeIndex(doc);
  for (let cx = Math.floor(b.x / CELL); cx <= Math.floor((b.x + b.w) / CELL); cx++)
    for (let cy = Math.floor(b.y / CELL); cy <= Math.floor((b.y + b.h) / CELL); cy++)
      for (const n of idx.get(cx + ',' + cy) ?? []) if (b.x < n.x + n.w && b.x + b.w > n.x && b.y < n.y + n.h && b.y + b.h > n.y) return true;
  return false;
}

/** Edge geometry, recomputed only when one of its ends moved or changed size. */
const geoCache = new WeakMap<Node, WeakMap<Node, { da?: string; db?: string; geo: EdgeGeometry }>>();
export function cachedEdgeGeometry(doc: Doc, a: Node, b: Node): EdgeGeometry {
  let byB = geoCache.get(a);
  if (!byB) geoCache.set(a, byB = new WeakMap());
  const da = doc.detail?.[a.id], db = doc.detail?.[b.id], hit = byB.get(b);
  if (hit && hit.da === da && hit.db === db) return hit.geo;
  const geo = edgeGeometry(doc, a, b);
  byB.set(b, { da, db, geo });
  return geo;
}
