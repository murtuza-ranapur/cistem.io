import { crossingLatency, type Doc, type Node } from './model';

export type Status = 'ok' | 'warn' | 'crit';
export interface NodeResult { load: number; cap: number; util: number; status: Status; lat: number; cum: number }
export interface Verdict { status: Status; node: Node | null; lat: number; converged: boolean }
export interface Results { nodes: Record<string, NodeResult>; edges: Record<string, number>; crossings: Record<string, number>; verdict: Verdict }

const num = (v: unknown) => +(v as number) || 0;
const clamp01 = (v: unknown) => Math.min(1, Math.max(0, num(v)));

/** Sustainable requests/sec a node can take before it saturates. */
export function capacity(n: Node): number {
  switch (n.kind) {
    case 'lb': return num(n.maxRps);
    case 'service': return num(n.rpsPerInstance) * num(n.instances);
    case 'cache': return num(n.maxOps);
    case 'db': {
      // Reads spread across primary + replicas; writes hit the primary only.
      const q = num(n.maxQps), r = Math.max(0, num(n.replicas)), rs = clamp01(n.readShare);
      const perReq = Math.max((1 - rs) + rs / (1 + r), rs / (1 + r));
      return perReq > 0 ? q / perReq : Infinity;
    }
    case 'queue': return num(n.maxThroughput);
    default: return Infinity;
  }
}

/** Fraction of a node's incoming load that travels down each outgoing edge. */
export function outFactor(n: Node, outCount: number): number {
  if (n.kind === 'cache') return 1 - clamp01(n.hitRatio);      // only misses go downstream
  if (n.kind === 'lb') return outCount > 0 ? 1 / outCount : 1; // even split
  return 1;
}

/** M/M/1-style inflation: base / (1 - util), capped at 10x once saturated. */
export function effLatency(n: Node, load: number): number {
  const base = num(n.latency), cap = capacity(n);
  if (cap === Infinity || cap <= 0) return base;
  const u = load / cap;
  if (u >= 0.999) return base * 10;
  return Math.min(base * 10, base / (1 - u));
}

export function compute(doc: Doc): Results {
  const byId = Object.fromEntries(doc.nodes.map(n => [n.id, n]));
  const outs: Record<string, number> = {};
  doc.nodes.forEach(n => (outs[n.id] = 0));
  doc.edges.forEach(e => { if (outs[e.from] !== undefined) outs[e.from]++; });

  const load: Record<string, number> = {}, cum: Record<string, number> = {};
  doc.nodes.forEach(n => { load[n.id] = 0; cum[n.id] = 0; });

  let converged = false;
  for (let iter = 0; iter < 60; iter++) {
    const next: Record<string, number> = {}, ncum: Record<string, number> = {};
    doc.nodes.forEach(n => { next[n.id] = n.kind === 'entry' ? num(doc.targetRps) : 0; ncum[n.id] = 0; });
    doc.edges.forEach(e => {
      const s = byId[e.from];
      if (!s || !byId[e.to]) return;
      next[e.to] += load[s.id] * outFactor(s, outs[s.id]) * num(e.calls);
      ncum[e.to] = Math.max(ncum[e.to], cum[s.id] + effLatency(s, load[s.id]) + crossingLatency(doc, s.container, byId[e.to].container));
    });
    let delta = 0;
    doc.nodes.forEach(n => { delta += Math.abs(next[n.id] - load[n.id]); });
    Object.assign(load, next); Object.assign(cum, ncum);
    if (delta < 0.01) { converged = true; break; }
  }

  const nodes: Record<string, NodeResult> = {};
  let worst: Status = 'ok', worstNode: Node | null = null, maxLat = 0;
  doc.nodes.forEach(n => {
    const cap = capacity(n), L = load[n.id];
    const util = cap === Infinity ? 0 : cap > 0 ? L / cap : L > 0 ? Infinity : 0;
    const status: Status = util >= 1 ? 'crit' : util >= 0.7 ? 'warn' : 'ok';
    const lat = effLatency(n, L);
    nodes[n.id] = { load: L, cap, util, status, lat, cum: cum[n.id] + lat };
    if (n.kind !== 'entry' && cum[n.id] + lat > maxLat) maxLat = cum[n.id] + lat;
    if (status === 'crit' && worst !== 'crit') { worst = 'crit'; worstNode = n; }
    else if (status === 'warn' && worst === 'ok') { worst = 'warn'; worstNode = n; }
  });

  const edges: Record<string, number> = {}, crossings: Record<string, number> = {};
  doc.edges.forEach(e => {
    const s = byId[e.from], t = byId[e.to]; if (!s || !t) return;
    edges[e.id] = load[s.id] * outFactor(s, outs[s.id]) * num(e.calls);
    crossings[e.id] = crossingLatency(doc, s.container, t.container);
  });

  return { nodes, edges, crossings, verdict: { status: worst, node: worstNode, lat: maxLat, converged } };
}
