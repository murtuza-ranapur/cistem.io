import { crossingLatency, behaviourOf, isSource, isAsync, qty, edgeCalls, type Doc, type Node } from './model';

export type Status = 'ok' | 'warn' | 'crit';
export interface NodeResult { load: number; cap: number; util: number; status: Status; lat: number; cum: number;
  /** A consumer with more instances than the partitions it reads: how many sit idle. */
  idle?: number;
  /** A consumer (fed only by topics/queues) pulls at its own pace: it never takes more than its capacity. */
  pull?: true;
  /** A pull consumer slower than what's published: the backlog (lag) grows by this many msg/s. */
  lag?: number;
  /** …and with the topics' retention known, hours until the oldest unread messages expire. */
  lossAfter?: number;
  /** cum is time since the message was published, not since the request (reached only through a topic). */
  async?: true }
/** lat: the slowest request path; asyncLat: the slowest path after a publish (0 when there's none). */
export interface Verdict { status: Status; node: Node | null; lat: number; asyncLat: number; converged: boolean }
export interface Results { nodes: Record<string, NodeResult>; edges: Record<string, number>; crossings: Record<string, number>; verdict: Verdict }

/** Loads are capped so absurd inputs (1e300 × 1e300) stay finite instead of Infinity/NaN; Engine.MAX_LOAD mirrors it. */
const MAX_LOAD = 1e18;
/** see qty in model.ts */
export const num = qty;
const clamp01 = (v: unknown) => Math.min(1, Math.max(0, num(v)));

/**
 * Sustainable requests/sec a node can take before it saturates — by behaviour, not type, so a new
 * component type in shared/component-types.json needs no engine change.
 */
export function capacity(n: Node, partitionsIn = 0): number {
  switch (behaviourOf(n)) {
    case 'balancer': case 'limit': return num(n.maxRps);
    // a consumer group uses one instance per partition at most
    case 'scaled': return num(n.rpsPerInstance) * (partitionsIn > 0 ? Math.min(num(n.instances), partitionsIn) : num(n.instances));
    case 'cache': return num(n.maxOps);
    case 'store': {
      // Reads spread across primary + replicas; writes hit the primary only.
      const q = num(n.maxQps), r = Math.max(0, num(n.replicas)), rs = clamp01(n.readShare);
      const perReq = Math.max((1 - rs) + rs / (1 + r), rs / (1 + r));
      return perReq > 0 ? q / perReq : Infinity;
    }
    case 'async': return n.msgPerPartition !== undefined ? num(n.partitions) * num(n.msgPerPartition) : num(n.maxThroughput);
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
export function effLatency(n: Node, load: number, cap = capacity(n)): number {
  const base = num(n.latency);
  if (cap === Infinity || cap <= 0) return base;
  const u = load / cap;
  if (u >= 0.999) return base * 10;
  return Math.min(base * 10, base / (1 - u));
}

/** A partitioned topic: its consumers can't use more instances than it has partitions. */
const partitioned = (n: Node) => isAsync(n) && n.msgPerPartition !== undefined && num(n.partitions) > 0;

/** Fed only by topics or queues (nothing calls it directly): it pulls at its own pace. */
export function isConsumer(doc: Doc, n: Node, byId: Record<string, Node>): boolean {
  if (isSource(n) || isAsync(n)) return false;
  const from = doc.edges.filter(e => e.to === n.id).map(e => byId[e.from]).filter(Boolean);
  return from.length > 0 && from.every(isAsync);
}

/**
 * For a scaled component that only consumes partitioned topics (nothing calls it directly): the
 * partitions it reads, summed over the topics. 0 means no cap — anything with direct traffic
 * spreads that over every instance.
 */
export function partitionsIn(doc: Doc, byId: Record<string, Node> = Object.fromEntries(doc.nodes.map(n => [n.id, n]))): Record<string, number> {
  const out: Record<string, number> = {};
  doc.nodes.forEach(n => {
    if (behaviourOf(n) !== 'scaled') { out[n.id] = 0; return; }
    const from = doc.edges.filter(e => e.to === n.id).map(e => byId[e.from]).filter(Boolean);
    const topics = new Set(from.filter(partitioned).map(s => s.id));
    out[n.id] = from.length > 0 && from.every(partitioned) ? [...topics].reduce((a, id) => a + num(byId[id].partitions), 0) : 0;
  });
  return out;
}

export function compute(doc: Doc): Results {
  const byId = Object.fromEntries(doc.nodes.map(n => [n.id, n]));
  const outs: Record<string, number> = {};
  doc.nodes.forEach(n => (outs[n.id] = 0));
  doc.edges.forEach(e => { if (outs[e.from] !== undefined) outs[e.from]++; });
  const pin = partitionsIn(doc, byId);
  const caps: Record<string, number> = {}, pull: Record<string, boolean> = {};
  doc.nodes.forEach(n => { caps[n.id] = capacity(n, pin[n.id]); pull[n.id] = isConsumer(doc, n, byId); });
  // a consumer passes on only what it gets through; it doesn't queue inside (the backlog is in the topic)
  const through = (id: string, L: number) => pull[id] && L > caps[id] ? (L > 0 ? caps[id] / L : 0) : 1;
  const latOf = (n: Node, L: number) => pull[n.id] ? num(n.latency) : effLatency(n, L, caps[n.id]);

  // Load per node, broken down by origin: 'sync' (request-driven) or the id of the queue it was
  // consumed from. Load consumed from queue Q is never published back into Q, so a service can
  // consume its own topic without the model looping forever.
  type Breakdown = Record<string, number>;
  // Time along the request (cum) and, for what's reached through a topic, since the publish (acum);
  // -1 = not reached that way.
  const bd: Record<string, Breakdown> = {}, cum: Record<string, number> = {}, acum: Record<string, number> = {};
  doc.nodes.forEach(n => { bd[n.id] = {}; cum[n.id] = 0; acum[n.id] = -1; });
  const total = (id: string) => Object.values(bd[id]).reduce((a, b) => a + b, 0);
  const syncOf = (id: string) => bd[id].sync ?? 0;

  let converged = false;
  for (let iter = 0; iter < 60; iter++) {
    const next: Record<string, Breakdown> = {}, ncum: Record<string, number> = {}, nacum: Record<string, number> = {};
    doc.nodes.forEach(n => { next[n.id] = isSource(n) ? { sync: Math.min(MAX_LOAD, num(n.rps)) } : {}; ncum[n.id] = 0; nacum[n.id] = -1; });
    doc.edges.forEach(e => {
      const s = byId[e.from], t = byId[e.to];
      if (!s || !t) return;
      const srcTotal = total(s.id);
      const factor = outFactor(s, outs[s.id]) * edgeCalls(e) * through(s.id, srcTotal);
      for (const origin in bd[s.id]) {
        if (isAsync(t) && origin === t.id) continue;          // don't republish what we consumed from t
        const amount = Math.min(MAX_LOAD, bd[s.id][origin] * factor);
        const tag = isAsync(s) ? s.id : origin;                 // consuming from a queue tags the load with it
        next[t.id][tag] = Math.min(MAX_LOAD, (next[t.id][tag] ?? 0) + amount);
      }
      const step = latOf(s, srcTotal) + crossingLatency(doc, s.container, t.container);
      if (isAsync(s)) {
        // delivery to a consumer starts the clock after the publish (or carries on from an earlier one)
        if (srcTotal > 0) nacum[t.id] = Math.max(nacum[t.id], Math.max(0, acum[s.id]) + step);
      } else {
        if (isSource(s) || syncOf(s.id) > 0) ncum[t.id] = Math.max(ncum[t.id], cum[s.id] + step);
        if (acum[s.id] >= 0 && srcTotal - syncOf(s.id) > 0) nacum[t.id] = Math.max(nacum[t.id], acum[s.id] + step);
      }
    });
    let delta = 0;
    doc.nodes.forEach(n => { delta += Math.abs(Object.values(next[n.id]).reduce((a, b) => a + b, 0) - total(n.id)); });
    doc.nodes.forEach(n => { bd[n.id] = next[n.id]; });
    Object.assign(cum, ncum); Object.assign(acum, nacum);
    if (delta < 0.01) { converged = true; break; }
  }
  const load: Record<string, number> = {};
  doc.nodes.forEach(n => (load[n.id] = total(n.id)));

  const nodes: Record<string, NodeResult> = {};
  let worst: Status = 'ok', worstNode: Node | null = null, maxLat = 0, asyncLat = 0;
  // retention of the topics each consumer reads (the shortest wins), in hours
  const retention = (id: string) => {
    const r = doc.edges.filter(e => e.to === id).map(e => byId[e.from]).filter(s => s && isAsync(s) && num(s.retentionHours) > 0).map(s => num(s.retentionHours));
    return r.length ? Math.min(...r) : 0;
  };
  doc.nodes.forEach(n => {
    const cap = caps[n.id], L = load[n.id];
    const util = cap === Infinity ? 0 : cap > 0 ? L / cap : L > 0 ? Infinity : 0;
    // a consumer that can't keep up falls behind (lag), it doesn't fail: amber, not red
    const status: Status = util >= 1 ? (pull[n.id] ? 'warn' : 'crit') : util >= 0.7 ? 'warn' : 'ok';
    const lat = latOf(n, L);
    const viaSync = isSource(n) || syncOf(n.id) > 0, viaAsync = acum[n.id] >= 0 && L - syncOf(n.id) > 0;
    nodes[n.id] = { load: L, cap, util, status, lat, cum: (viaSync || !viaAsync ? cum[n.id] : acum[n.id]) + lat };
    if (!viaSync && viaAsync) nodes[n.id].async = true;
    if (pull[n.id]) {
      nodes[n.id].pull = true;
      if (L > cap) {
        nodes[n.id].lag = L - cap;
        // the message being read at time t was published at t·cap/L, so its age is t·(1 − cap/L)
        const r = retention(n.id);
        if (r > 0) nodes[n.id].lossAfter = r / (1 - cap / L);
      }
    }
    if (pin[n.id] > 0 && num(n.instances) > pin[n.id]) nodes[n.id].idle = num(n.instances) - pin[n.id];
    // end-to-end latency follows the traffic: components nothing reaches don't count
    if (!isSource(n) && L > 0 && viaSync && cum[n.id] + lat > maxLat) maxLat = cum[n.id] + lat;
    if (viaAsync && acum[n.id] + lat > asyncLat) asyncLat = acum[n.id] + lat;
    if (status === 'crit' && worst !== 'crit') { worst = 'crit'; worstNode = n; }
    // among the amber ones, a consumer falling behind says more than one near its limit
    else if (status === 'warn' && (worst === 'ok' || (worst === 'warn' && nodes[n.id].lag && !(worstNode && nodes[worstNode.id]?.lag)))) { worst = 'warn'; worstNode = n; }
  });

  const edges: Record<string, number> = {}, crossings: Record<string, number> = {};
  doc.edges.forEach(e => {
    const s = byId[e.from], t = byId[e.to]; if (!s || !t) return;
    const eligible = Object.entries(bd[s.id]).filter(([o]) => !(isAsync(t) && o === t.id)).reduce((a, [, v]) => a + v, 0);
    edges[e.id] = eligible * outFactor(s, outs[s.id]) * edgeCalls(e) * through(s.id, total(s.id));
    crossings[e.id] = crossingLatency(doc, s.container, t.container);
  });

  return { nodes, edges, crossings, verdict: { status: worst, node: worstNode, lat: maxLat, asyncLat, converged } };
}
