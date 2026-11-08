import { isSource, FRAME_PAD, FRAME_HEAD, nodeWidthFor, nodeHeight, ancestry, type Doc, type Frame } from './model';

const COL_GAP = 120;   // horizontal space between columns (beyond node width)
const ROW_GAP = 40;    // vertical space between nodes in a column
const GROUP_GAP = 80;  // space between sibling containers / unplaced nodes
const ORIGIN = { x: 40, y: 40 };

export type Positions = Record<string, { x: number; y: number }>;
export interface LayoutResult { positions: Positions; frames: Record<string, Frame> }

interface Item { id: string; w: number; h: number }          // a node or a laid-out container, as a block
interface Block { items: Item[]; edges: [string, string][]; roots: string[] }

/**
 * Layered left-to-right layout, container-aware.
 * Each container is laid out recursively into a block; at each level the blocks (nodes and
 * child containers) are arranged by longest path from the entry side, with edges between
 * blocks inherited from the member edges they contain.
 */
export function layeredLayout(doc: Doc): LayoutResult {
  const positions: Positions = {};
  const frames: Record<string, Frame> = {};
  const root = layoutLevel(doc, null, positions, frames);
  // shift everything to the origin
  shift(doc, positions, frames, ORIGIN.x - root.minX, ORIGIN.y - root.minY);
  return { positions, frames };
}

/** Node-only variant kept for callers that just want positions (ignores containers). */
export function layeredPositions(doc: Doc): Positions { return layeredLayout(doc).positions; }

function layoutLevel(doc: Doc, container: string | null, positions: Positions, frames: Record<string, Frame>): { minX: number; minY: number; w: number; h: number } {
  const children = doc.containers.filter(c => (c.parent ?? null) === container);
  const nodes = doc.nodes.filter(n => (n.container ?? null) === container);

  // 1. lay out each child container recursively → a block with its own size (local coords from 0,0)
  const blocks = new Map<string, { w: number; h: number }>();
  for (const c of children) {
    const r = layoutLevel(doc, c.id, positions, frames);
    blocks.set(c.id, { w: r.w, h: r.h });
  }

  // 2. items at this level: nodes + child containers; edges projected onto items
  // Which item at this level a node belongs to: itself, or the child container that (transitively) holds it.
  const itemOf = (nodeId: string): string | null => {
    const n = doc.nodes.find(x => x.id === nodeId); if (!n) return null;
    if ((n.container ?? null) === container) return n.id;
    const chain = ancestry(doc, n.container);            // nearest first
    if (container === null) return chain[chain.length - 1] ?? null;
    const i = chain.indexOf(container);
    return i > 0 ? chain[i - 1] : null;
  };
  const items: Item[] = [
    ...nodes.map(n => ({ id: n.id, w: nodeWidthFor(n, doc.detail?.[n.id]), h: nodeHeight(n, doc.detail?.[n.id]) })),
    ...children.map(c => ({ id: c.id, w: blocks.get(c.id)!.w, h: blocks.get(c.id)!.h })),
  ];
  const itemIds = new Set(items.map(i => i.id));
  const edges: [string, string][] = [];
  for (const e of doc.edges) {
    const a = itemOf(e.from), b = itemOf(e.to);
    if (a && b && a !== b && itemIds.has(a) && itemIds.has(b)) edges.push([a, b]);
  }
  const roots = items.filter(i => doc.nodes.some(n => n.id === i.id && isSource(n)) || containsEntry(doc, i.id)).map(i => i.id);

  // 3. arrange the items
  const placed = arrange({ items, edges, roots }, container === null ? COL_GAP : COL_GAP / 2, container === null ? GROUP_GAP : ROW_GAP);

  // 4. write positions: nodes directly; containers by shifting their already-laid-out contents
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    const p = placed.get(it.id)!;
    if (nodes.some(n => n.id === it.id)) positions[it.id] = { x: snap(p.x), y: snap(p.y) };
    else shiftContainer(doc, it.id, positions, frames, snap(p.x), snap(p.y));
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + it.w); maxY = Math.max(maxY, p.y + it.h);
  }
  if (!items.length) { minX = minY = 0; maxX = 200; maxY = 80; }

  // 5. this container's frame wraps its items with padding and a title band
  if (container) {
    const f: Frame = { x: minX - FRAME_PAD, y: minY - FRAME_PAD - FRAME_HEAD, w: maxX - minX + FRAME_PAD * 2, h: maxY - minY + FRAME_PAD * 2 + FRAME_HEAD };
    // normalise so the frame starts at 0,0 in local coords
    shiftContainer(doc, container, positions, frames, -f.x, -f.y, false);
    frames[container] = { x: 0, y: 0, w: f.w, h: f.h };
    return { minX: 0, minY: 0, w: f.w, h: f.h };
  }
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

function containsEntry(doc: Doc, containerId: string): boolean {
  return doc.nodes.some(n => isSource(n) && ancestry(doc, n.container).includes(containerId));
}

/** Move a container's frame and everything inside it (recursively). */
function shiftContainer(doc: Doc, id: string, positions: Positions, frames: Record<string, Frame>, dx: number, dy: number, moveFrame = true) {
  if (moveFrame && frames[id]) { frames[id] = { ...frames[id], x: frames[id].x + dx, y: frames[id].y + dy }; }
  for (const n of doc.nodes) if ((n.container ?? null) === id && positions[n.id]) positions[n.id] = { x: positions[n.id].x + dx, y: positions[n.id].y + dy };
  for (const c of doc.containers) if ((c.parent ?? null) === id) shiftContainer(doc, c.id, positions, frames, dx, dy);
}
function shift(doc: Doc, positions: Positions, frames: Record<string, Frame>, dx: number, dy: number) {
  for (const id in positions) positions[id] = { x: positions[id].x + dx, y: positions[id].y + dy };
  for (const id in frames) frames[id] = { ...frames[id], x: frames[id].x + dx, y: frames[id].y + dy };
}

/** Longest-path layering + barycentre ordering over abstract items. Returns top-left per item. */
function arrange(b: Block, colGap: number, rowGap: number): Map<string, { x: number; y: number }> {
  const ids = b.items.map(i => i.id);
  const size = new Map(b.items.map(i => [i.id, i]));
  const out: Record<string, string[]> = {}, inn: Record<string, string[]> = {};
  ids.forEach(id => { out[id] = []; inn[id] = []; });
  for (const [f, t] of b.edges) if (!out[f].includes(t)) { out[f].push(t); inn[t].push(f); }

  const state: Record<string, 0 | 1 | 2> = {}; const back = new Set<string>();
  const dfs = (u: string) => { state[u] = 1; for (const v of out[u]) { if (state[v] === 1) back.add(u + '>' + v); else if (!state[v]) dfs(v); } state[u] = 2; };
  [...b.roots, ...ids].forEach(id => { if (!state[id]) dfs(id); });
  const fwd = (u: string) => out[u].filter(v => !back.has(u + '>' + v));
  const preds = (v: string) => inn[v].filter(u => !back.has(u + '>' + v));

  const layer: Record<string, number> = {};
  const order = topo(ids, fwd);
  order.forEach(u => { const ps = preds(u); layer[u] = ps.length ? Math.max(...ps.map(p => layer[p])) + 1 : 0; });
  if (b.roots.length) {
    ids.forEach(id => { if (layer[id] === 0 && !b.roots.includes(id)) layer[id] = 1; });
    order.forEach(u => { const ps = preds(u); if (ps.length) layer[u] = Math.max(layer[u], ...ps.map(p => layer[p] + 1)); });
  }
  const maxLayer = Math.max(0, ...Object.values(layer));
  const cols: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  ids.forEach(id => cols[layer[id]].push(id));

  const pos: Record<string, number> = {};
  cols.forEach(c => c.forEach((id, i) => (pos[id] = i)));
  const sweep = (down: boolean) => {
    const range = down ? [...cols.keys()] : [...cols.keys()].reverse();
    for (const li of range) {
      const c = cols[li];
      const bary = (id: string) => { const nb = down ? preds(id) : fwd(id); return nb.length ? nb.reduce((s, n) => s + pos[n], 0) / nb.length : pos[id]; };
      c.sort((a, b2) => bary(a) - bary(b2) || pos[a] - pos[b2]);
      c.forEach((id, i) => (pos[id] = i));
    }
  };
  sweep(true); sweep(false); sweep(true);

  const colW = cols.map(c => Math.max(0, ...c.map(id => size.get(id)!.w)));
  const colH = cols.map(c => c.reduce((s, id) => s + size.get(id)!.h, 0) + Math.max(0, c.length - 1) * rowGap);
  const totalH = Math.max(0, ...colH);
  const result = new Map<string, { x: number; y: number }>();
  let x = 0;
  cols.forEach((c, li) => {
    let y = (totalH - colH[li]) / 2;
    c.forEach(id => { result.set(id, { x, y }); y += size.get(id)!.h + rowGap; });
    x += colW[li] + colGap;
  });
  return result;
}

function topo(ids: string[], fwd: (u: string) => string[]): string[] {
  const indeg: Record<string, number> = {};
  ids.forEach(id => (indeg[id] = 0));
  ids.forEach(u => fwd(u).forEach(v => indeg[v]++));
  const q = ids.filter(id => indeg[id] === 0), out: string[] = [];
  while (q.length) { const u = q.shift()!; out.push(u); fwd(u).forEach(v => { if (--indeg[v] === 0) q.push(v); }); }
  ids.forEach(id => { if (!out.includes(id)) out.push(id); });
  return out;
}
const snap = (v: number) => Math.round(v / 8) * 8;
