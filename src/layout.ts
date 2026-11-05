import { KINDS, NODE_H, type Doc } from './model';

const COL_GAP = 60;   // horizontal space between columns (beyond node width)
const ROW_GAP = 28;   // vertical space between nodes in a column
const ORIGIN = { x: 40, y: 40 };

export type Positions = Record<string, { x: number; y: number }>;

/** Longest-path layering from the entry node(s), barycentre ordering, grid snap. */
export function layeredLayout(doc: Doc): Positions {
  const ids = doc.nodes.map(n => n.id);
  const idSet = new Set(ids);
  const out: Record<string, string[]> = {}, inn: Record<string, string[]> = {};
  ids.forEach(id => { out[id] = []; inn[id] = []; });
  doc.edges.forEach(e => {
    if (!idSet.has(e.from) || !idSet.has(e.to) || e.from === e.to) return;
    if (!out[e.from].includes(e.to)) { out[e.from].push(e.to); inn[e.to].push(e.from); }
  });

  // Drop back-edges found by DFS so the graph is a DAG for layering.
  const state: Record<string, 0 | 1 | 2> = {};
  const back = new Set<string>();
  const roots = doc.nodes.filter(n => n.kind === 'entry').map(n => n.id);
  const dfs = (u: string) => {
    state[u] = 1;
    for (const v of out[u]) {
      if (state[v] === 1) back.add(u + '>' + v);
      else if (!state[v]) dfs(v);
    }
    state[u] = 2;
  };
  [...roots, ...ids].forEach(id => { if (!state[id]) dfs(id); });
  const fwd = (u: string) => out[u].filter(v => !back.has(u + '>' + v));
  const preds = (v: string) => inn[v].filter(u => !back.has(u + '>' + v));

  // Longest path from any root; nodes with no forward predecessors sit at layer 0.
  const layer: Record<string, number> = {};
  const order = topo(ids, fwd);
  order.forEach(u => { const ps = preds(u); layer[u] = ps.length ? Math.max(...ps.map(p => layer[p])) + 1 : 0; });
  // Entry nodes always first; anything else at layer 0 that isn't an entry moves right of the entries.
  if (roots.length) {
    ids.forEach(id => { if (layer[id] === 0 && !roots.includes(id)) layer[id] = 1; });
    // re-propagate so children stay to the right of shifted parents
    order.forEach(u => { const ps = preds(u); if (ps.length) layer[u] = Math.max(layer[u], ...ps.map(p => layer[p] + 1)); });
  }

  const maxLayer = Math.max(0, ...Object.values(layer));
  const cols: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  ids.forEach(id => cols[layer[id]].push(id));

  // Barycentre ordering: two downward sweeps, one upward.
  const pos: Record<string, number> = {};
  cols.forEach(c => c.forEach((id, i) => (pos[id] = i)));
  const sweep = (down: boolean) => {
    const range = down ? cols.keys() : [...cols.keys()].reverse();
    for (const li of range) {
      const c = cols[li];
      const bary = (id: string) => {
        const nb = down ? preds(id) : fwd(id);
        return nb.length ? nb.reduce((s, n) => s + pos[n], 0) / nb.length : pos[id];
      };
      c.sort((a, b) => bary(a) - bary(b) || pos[a] - pos[b]);
      c.forEach((id, i) => (pos[id] = i));
    }
  };
  sweep(true); sweep(false); sweep(true);

  // Place: each column vertically centred on the tallest column.
  const colW = cols.map(c => Math.max(0, ...c.map(id => KINDS[doc.nodes.find(n => n.id === id)!.kind].w)));
  const colH = cols.map(c => c.length * NODE_H + Math.max(0, c.length - 1) * ROW_GAP);
  const totalH = Math.max(...colH);
  const result: Positions = {};
  let x = ORIGIN.x;
  cols.forEach((c, li) => {
    let y = ORIGIN.y + (totalH - colH[li]) / 2;
    c.forEach(id => {
      result[id] = { x: snap(x), y: snap(y) };
      y += NODE_H + ROW_GAP;
    });
    x += colW[li] + COL_GAP;
  });
  return result;
}

function topo(ids: string[], fwd: (u: string) => string[]): string[] {
  const indeg: Record<string, number> = {};
  ids.forEach(id => (indeg[id] = 0));
  ids.forEach(u => fwd(u).forEach(v => indeg[v]++));
  const q = ids.filter(id => indeg[id] === 0), out: string[] = [];
  while (q.length) { const u = q.shift()!; out.push(u); fwd(u).forEach(v => { if (--indeg[v] === 0) q.push(v); }); }
  ids.forEach(id => { if (!out.includes(id)) out.push(id); }); // leftovers (shouldn't happen after back-edge removal)
  return out;
}
const snap = (v: number) => Math.round(v / 8) * 8;
