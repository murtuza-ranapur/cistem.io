/** Edits to the system diagram used by the canvas, the panel, the keys and the menus. */
import {
  NODE_H, CONTAINER_KINDS, makeNode, makeContainer, typeDef, detailOf, hasSchemaDetail, topicFields, nodeWidth,
  type Doc, type Kind, type ContainerKind, type Node,
} from '../../domain/model';
import { layeredLayout } from '../../domain/layout';
import { create } from 'zustand';
import { animate } from '../../lib/browser';
import { editor, select, selectOne } from '../../store/editor';
import * as history from '../../store/history';
import { centre } from '../../store/viewport';
import { fitView } from '../../store/commands';
import { hint } from '../../store/ui';
import { computeFrames, containerAt, nodeBox, nodeH, nodeW, snap } from './geometry';
import { edit, freshId, selectedNodeIds, sysDoc } from './state';

// ---------- adding ----------

/** Add a component at (x, y), or at the nearest free spot around the middle of the view. */
export function addNode(kind: Kind, x?: number, y?: number): Node {
  const doc = sysDoc(), w = typeDef(kind).w;
  if (x === undefined || y === undefined) {
    const c = centre();
    const start = { x: c.x - w / 2, y: c.y - NODE_H / 2 };
    const free = (px: number, py: number) => doc.nodes.every(o => px + w + 16 <= o.x || o.x + nodeW(doc, o) + 16 <= px || py + NODE_H + 16 <= o.y || o.y + nodeH(doc, o) + 16 <= py);
    // the centre may be taken: spiral outwards to the nearest spot that overlaps nothing
    ({ x, y } = start);
    outer: for (let ring = 0; ring < 12; ring++) for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const px = start.x + dx * (w + 24), py = start.y + dy * (NODE_H + 24);
      if (free(px, py)) { x = px; y = py; break outer; }
    }
  }
  const made = makeNode(kind, snap(x!), snap(y!));
  const n = { ...made, id: freshId(doc, 'n', made.id) };
  n.container = containerAt(doc, computeFrames(doc), n.x + nodeWidth(n) / 2, n.y + NODE_H / 2);
  edit(d => { d.nodes.push(n); });
  selectOne('node', n.id);
  return n;
}

/** Add an environment at (x, y) (its top-left), or in the middle of the view. */
export function addContainer(kind: ContainerKind = 'cloud', x?: number, y?: number) {
  const doc = sysDoc();
  if (x === undefined || y === undefined) { const c = centre(); x = c.x - 130; y = c.y - 70; }
  const made = makeContainer(kind, kind === 'cloud' ? 'New environment' : CONTAINER_KINDS[kind].label);
  const c = { ...made, id: freshId(doc, 'c', made.id) };
  c.parent = containerAt(doc, computeFrames(doc), x + 130, y + 70);
  const frame = { x: snap(x), y: snap(y), w: 260, h: 140 };
  edit(d => { d.containers.push(c); d.frames[c.id] = frame; });
  selectOne('container', c.id);
  return c;
}

/** Connect two components (once). */
export function connect(from: string, to: string) {
  const doc = sysDoc();
  if (doc.edges.some(e => e.from === from && e.to === to)) { hint('Already connected', 1200); return; }
  const id = freshId(doc, 'e');
  edit(d => { d.edges.push({ id, from, to, calls: 1, endpoint: null }); });
  selectOne('edge', id);
}

// ---------- removing ----------

export function deleteNodes(ids: string[]) {
  const gone = new Set(ids);
  edit(d => {
    d.nodes = d.nodes.filter(n => !gone.has(n.id));
    d.edges = d.edges.filter(e => !gone.has(e.from) && !gone.has(e.to));
  });
}
export const deleteEdge = (id: string) => edit(d => { d.edges = d.edges.filter(e => e.id !== id); });
/** Remove an environment; what was inside moves up to its parent. */
export function deleteContainer(id: string) {
  edit(d => {
    const c = d.containers.find(x => x.id === id); if (!c) return;
    const parent = c.parent ?? null;
    d.nodes.forEach(n => { if ((n.container ?? null) === id) n.container = parent; });
    d.containers.forEach(k => { if ((k.parent ?? null) === id) k.parent = parent; });
    d.links = d.links.filter(l => l.from !== id && l.to !== id);
    delete d.frames[id];
    d.containers = d.containers.filter(x => x.id !== id);
  });
}
export function removeSelection() {
  const s = editor().selection; if (!s) return;
  if (s.type === 'container') deleteContainer(s.ids[0]);
  else if (s.type === 'edge') deleteEdge(s.ids[0]);
  else if (s.type === 'node') { const ids = selectedNodeIds(); if (!ids.length) return; deleteNodes(ids); }
  else return;
  select(null);
}

// ---------- duplicate, move, select ----------

/** Copy the selected components (and the connections between them) 32px down-right. */
export function duplicateSelection() {
  const ids = selectedNodeIds(); if (!ids.length) return;
  const doc = sysDoc(), map: Record<string, string> = {};
  edit(d => {
    for (const id of ids) {
      const src = doc.nodes.find(n => n.id === id)!;
      const copy = { ...structuredClone(src), id: freshId(d, 'n'), x: src.x + 32, y: src.y + 32 };
      map[id] = copy.id; d.nodes.push(copy);
    }
    for (const e of doc.edges) if (map[e.from] && map[e.to]) d.edges.push({ ...e, id: freshId(d, 'e'), from: map[e.from], to: map[e.to] });
  });
  select({ type: 'node', ids: Object.values(map) });
}
export function nudge(dx: number, dy: number) {
  const ids = new Set(selectedNodeIds()); if (!ids.size) return;
  edit(d => { for (const n of d.nodes) if (ids.has(n.id)) { n.x += dx; n.y += dy; } });
}
export function selectAll() {
  const doc = sysDoc();
  select(doc.nodes.length ? { type: 'node', ids: doc.nodes.map(n => n.id) } : null);
}

// ---------- detail (expanded schemas) and making room ----------

const ROOM_GAP = 40;
interface Push { id: string; dx: number; dy: number; x: number; y: number }
/** Where neighbours were pushed from, per grown node, so collapsing can put them back. */
const pushes = new Map<string, Push[]>();

/** Node `id` grew from (w0, h0): push the nodes below / to its right just enough to clear it. */
function makeRoom(d: Doc, id: string, w0: number, h0: number) {
  const n = d.nodes.find(x => x.id === id); if (!n) return;
  const { w, h } = nodeBox(d, n);
  const moved: Push[] = [];
  const others = d.nodes.filter(o => o.id !== id);
  if (h > h0) {
    // the column below it: overlapping horizontally (with the new width) and starting below its old bottom
    const below = others.filter(o => o.x < n.x + w + 8 && o.x + nodeW(d, o) > n.x - 8 && o.y >= n.y + h0 - 8);
    const dy = below.length ? Math.max(0, n.y + h + ROOM_GAP - Math.min(...below.map(o => o.y))) : 0;
    if (dy) below.forEach(o => { o.y += dy; moved.push({ id: o.id, dx: 0, dy, x: o.x, y: o.y }); });
  }
  if (w > w0) {
    const right = others.filter(o => o.y < n.y + h + 8 && o.y + nodeH(d, o) > n.y - 8 && o.x >= n.x + w0 - 8 && !moved.some(m => m.id === o.id));
    const dx = right.length ? Math.max(0, n.x + w + ROOM_GAP / 2 - Math.min(...right.map(o => o.x))) : 0;
    if (dx) right.forEach(o => { o.x += dx; moved.push({ id: o.id, dx, dy: 0, x: o.x, y: o.y }); });
  }
  if (moved.length) pushes.set(id, moved);
}
/** Node `id` shrank back: return what it pushed, if those nodes haven't been moved by hand since. */
function giveBackRoom(d: Doc, id: string) {
  const list = pushes.get(id); if (!list) return;
  pushes.delete(id);
  for (const m of list) { const o = d.nodes.find(x => x.id === m.id); if (o && o.x === m.x && o.y === m.y) { o.x -= m.dx; o.y -= m.dy; } }
}

export function toggleDetail(id: string, to?: 'compact' | 'expanded') {
  const doc = sysDoc();
  const cur = doc.detail[id] ?? 'compact', next = to ?? (cur === 'expanded' ? 'compact' : 'expanded');
  const n = doc.nodes.find(x => x.id === id);
  if (next === cur || !n) return;
  const { w: w0, h: h0 } = nodeBox(doc, n);
  edit(d => {
    if (next === 'compact') { delete d.detail[id]; giveBackRoom(d, id); }
    else { d.detail[id] = next; makeRoom(d, id, w0, h0); }
  });
}
const hasDetailToShow = (n: Node) => (detailOf(n) === 'tables' && !!n.tables?.length) || (detailOf(n) === 'endpoints' && !!n.endpoints?.length) || (hasSchemaDetail(n) && topicFields(n).length > 0);
/** Expand or collapse every node that has something to show. */
export function setAllDetail(to: 'compact' | 'expanded') {
  edit(d => {
    const ids = d.nodes.filter(hasDetailToShow).sort((a, b) => a.y - b.y || a.x - b.x).map(n => n.id);
    if (to === 'expanded') {
      for (const id of ids) {
        if (d.detail[id] === 'expanded') continue;
        const { w, h } = nodeBox(d, d.nodes.find(x => x.id === id)!);
        d.detail[id] = 'expanded'; makeRoom(d, id, w, h);
      }
    } else {
      for (const id of [...ids].reverse()) { if (!d.detail[id]) continue; delete d.detail[id]; giveBackRoom(d, id); }
      d.detail = {};
    }
  });
}

/** The toolbar's expand-all state (⇧Space and the button share it). */
export const useExpandAll = create(() => ({ on: false }));
export function toggleAllDetail() {
  const on = !useExpandAll.getState().on;
  useExpandAll.setState({ on });
  setAllDetail(on ? 'expanded' : 'compact');
}

// ---------- auto-organise ----------

/** Lay the diagram out in layers (sources on the left), animating every node to its place, then fit. */
export function organise() {
  const doc = sysDoc(), res = layeredLayout(doc), next = res.positions;
  if (doc.nodes.every(n => next[n.id].x === n.x && next[n.id].y === n.y)) { hint('Already organised', 1200); return; }
  const from = Object.fromEntries(doc.nodes.map(n => [n.id, { x: n.x, y: n.y }]));
  history.begin();
  // empty environments have no members to follow; give them their computed frame
  edit(d => {
    for (const id in res.frames) if (!d.nodes.some(n => n.container === id) && !d.containers.some(c => c.parent === id)) d.frames[id] = res.frames[id];
  });
  animate(280, t => edit(d => {
    for (const n of d.nodes) { const a = from[n.id], b = next[n.id] ?? a; if (a) { n.x = a.x + (b.x - a.x) * t; n.y = a.y + (b.y - a.y) * t; } }
  }), () => { history.end(); fitView(); });
}
