import { crossingLatency, behaviourOf, isSource, isAsync, type Doc, type Node } from './model';

export type Status = 'ok' | 'warn' | 'crit';
export interface NodeResult { load: number; cap: number; util: number; status: Status; lat: number; cum: number }
export interface Verdict { status: Status; node: Node | null; lat: number; converged: boolean }
export interface Results { nodes: Record<string, NodeResult>; edges: Record<string, number>; crossings: Record<string, number>; verdict: Verdict }

const num = (v: unknown) => +(v as number) || 0;
const clamp01 = (v: unknown) => Math.min(1, Math.max(0, num(v)));

/**
 * Sustainable requests/sec a node can take before it saturates — by behaviour, not type, so a new
 * component type in shared/component-types.json needs no engine change.
 */
export function capacity(n: Node): number {
  switch (behaviourOf(n)) {
    case 'balancer': case 'limit': return num(n.maxRps);
    case 'scaled': return num(n.rpsPerInstance) * num(n.instances);
    case 'cache': return num(n.maxOps);
    case 'store': {
      // Reads spread across primary + replicas; writes hit the primary only.
      const q = num(n.maxQps), r = Math.max(0, num(n.replicas)), rs = clamp01(n.readShare);
      const perReq = Math.max((1 - rs) + rs / (1 + r), rs / (1 + r));
      return perReq > 0 ? q / perReq : Infinity;
    }
    case 'async': return num(n.maxThroughput);
    default: return Infinity;   // source
  }
}

/** Fraction of a node's incoming load that travels down each outgoing edge. */
export function outFactor(n: Node, outCount: number): number {
  const b = behaviourOf(n);
  if (b === 'cache') return 1 - clamp01(n.hitRatio);              // only misses go downstream
  if (b === 'balancer') return outCount > 0 ? 1 / outCount : 1;   // even split
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

  // Load per node, broken down by origin: 'sync' (request-driven) or the id of the queue it was
  // consumed from. Load consumed from queue Q is never published back into Q, so a service can
  // consume its own topic without the model looping forever.
  type Breakdown = Record<string, number>;
  const bd: Record<string, Breakdown> = {}, cum: Record<string, number> = {};
  doc.nodes.forEach(n => { bd[n.id] = {}; cum[n.id] = 0; });
  const total = (id: string) => Object.values(bd[id]).reduce((a, b) => a + b, 0);

  let converged = false;
  for (let iter = 0; iter < 60; iter++) {
    const next: Record<string, Breakdown> = {}, ncum: Record<string, number> = {};
    doc.nodes.forEach(n => { next[n.id] = isSource(n) ? { sync: num(n.rps) } : {}; ncum[n.id] = 0; });
    doc.edges.forEach(e => {
      const s = byId[e.from], t = byId[e.to];
      if (!s || !t) return;
      const factor = outFactor(s, outs[s.id]) * num(e.calls);
      const srcTotal = total(s.id);
      for (const origin in bd[s.id]) {
        if (isAsync(t) && origin === t.id) continue;          // don't republish what we consumed from t
        const amount = bd[s.id][origin] * factor;
        const tag = isAsync(s) ? s.id : origin;                 // consuming from a queue tags the load with it
        next[t.id][tag] = (next[t.id][tag] ?? 0) + amount;
      }
      ncum[t.id] = Math.max(ncum[t.id], cum[s.id] + effLatency(s, srcTotal) + crossingLatency(doc, s.container, t.container));
    });
    let delta = 0;
    doc.nodes.forEach(n => { delta += Math.abs(Object.values(next[n.id]).reduce((a, b) => a + b, 0) - total(n.id)); });
    doc.nodes.forEach(n => { bd[n.id] = next[n.id]; });
    Object.assign(cum, ncum);
    if (delta < 0.01) { converged = true; break; }
  }
  const load: Record<string, number> = {};
  doc.nodes.forEach(n => (load[n.id] = total(n.id)));

  const nodes: Record<string, NodeResult> = {};
  let worst: Status = 'ok', worstNode: Node | null = null, maxLat = 0;
  doc.nodes.forEach(n => {
    const cap = capacity(n), L = load[n.id];
    const util = cap === Infinity ? 0 : cap > 0 ? L / cap : L > 0 ? Infinity : 0;
    const status: Status = util >= 1 ? 'crit' : util >= 0.7 ? 'warn' : 'ok';
    const lat = effLatency(n, L);
    nodes[n.id] = { load: L, cap, util, status, lat, cum: cum[n.id] + lat };
    if (!isSource(n) && cum[n.id] + lat > maxLat) maxLat = cum[n.id] + lat;
    if (status === 'crit' && worst !== 'crit') { worst = 'crit'; worstNode = n; }
    else if (status === 'warn' && worst === 'ok') { worst = 'warn'; worstNode = n; }
  });

  const edges: Record<string, number> = {}, crossings: Record<string, number> = {};
  doc.edges.forEach(e => {
    const s = byId[e.from], t = byId[e.to]; if (!s || !t) return;
    const eligible = Object.entries(bd[s.id]).filter(([o]) => !(isAsync(t) && o === t.id)).reduce((a, [, v]) => a + v, 0);
    edges[e.id] = eligible * outFactor(s, outs[s.id]) * num(e.calls);
    crossings[e.id] = crossingLatency(doc, s.container, t.container);
  });

  return { nodes, edges, crossings, verdict: { status: worst, node: worstNode, lat: maxLat, converged } };
}
