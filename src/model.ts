export type Kind = 'entry' | 'lb' | 'service' | 'cache' | 'db' | 'queue';

export interface Header { k: string; v: string }
export interface Endpoint { method: string; path: string; headers: Header[]; req: string; res: string }
export interface Column { name: string; type: string; pk: boolean; nullable: boolean; unique?: boolean; references?: string | null; default?: string; index?: boolean }
/** `references` is "table.column" within the same database, or "node:table.column" for another database node. */
export interface Table { name: string; columns: Column[] }
export interface Topic { name: string; partitions: number; schema: string }

export interface NodeBase { id: string; kind: Kind; x: number; y: number; name: string; latency?: number; container?: string | null }
export interface EntryNode extends NodeBase { kind: 'entry'; platforms: string[] }
export interface LbNode extends NodeBase { kind: 'lb'; maxRps: number; latency: number }
export interface ServiceNode extends NodeBase { kind: 'service'; rpsPerInstance: number; instances: number; latency: number; endpoints: Endpoint[] }
export interface CacheNode extends NodeBase { kind: 'cache'; maxOps: number; hitRatio: number; latency: number; eviction: string }
export interface DbNode extends NodeBase { kind: 'db'; maxQps: number; readShare: number; replicas: number; latency: number; tables: Table[] }
export interface QueueNode extends NodeBase { kind: 'queue'; maxThroughput: number; latency: number; topics: Topic[] }
export type Node = EntryNode | LbNode | ServiceNode | CacheNode | DbNode | QueueNode;

export interface Edge { id: string; from: string; to: string; calls: number; endpoint?: number | null }

/** A boundary that components live in: a cloud, an account, a VPC... Nested via `parent`. */
export type ContainerKind = 'cloud' | 'account' | 'vpc' | 'region' | 'datacentre' | 'team';
export interface Container { id: string; kind: ContainerKind; name: string; parent: string | null; provider?: string; owner?: string; note?: string }
/** How two containers talk; adds latency to every edge crossing between them (or their descendants). */
export interface Link { id: string; from: string; to: string; type: string; latencyMs: number }
/** Editor-side frame geometry for a container. */
export interface Frame { x: number; y: number; w: number; h: number }

export type Detail = 'compact' | 'expanded';
export interface Doc { targetRps: number; nodes: Node[]; edges: Edge[]; containers: Container[]; links: Link[]; frames: Record<string, Frame>; detail: Record<string, Detail> }

export const CONTAINER_KINDS: Record<ContainerKind, { label: string; hue: number }> = {
  cloud:      { label: 'Cloud',       hue: 210 },
  account:    { label: 'Account',     hue: 260 },
  vpc:        { label: 'VPC',         hue: 160 },
  region:     { label: 'Region',      hue: 30 },
  datacentre: { label: 'Data centre', hue: 350 },
  team:       { label: 'Team',        hue: 90 },
};
export const LINK_TYPES: Record<string, number> = {
  'same-network': 0, 'vpc-peering': 1, 'privatelink': 2, 'transit-gateway': 3, 'vpn': 20, 'direct-connect': 10, 'public-internet': 40,
};
/** Default crossing latency when no link is declared, by how far apart the two containers are. */
export const CROSSING_DEFAULT_MS = { sameContainer: 0, siblings: 1, differentRoots: 10 };
export const FRAME_PAD = 28, FRAME_HEAD = 30;

export interface KindDef { label: string; w: number; defaults: Record<string, unknown>; fields: [string, string][] }

export const KINDS: Record<Kind, KindDef> = {
  entry:   { label: 'Clients',       w: 190, defaults: { name: 'Clients', platforms: ['web', 'app'] }, fields: [] },
  lb:      { label: 'Load balancer', w: 190, defaults: { name: 'LB', maxRps: 50000, latency: 1 }, fields: [['maxRps', 'max rps'], ['latency', 'latency ms']] },
  service: { label: 'Microservice',  w: 200, defaults: { name: 'api', rpsPerInstance: 800, instances: 3, latency: 20, endpoints: [] }, fields: [['instances', 'instances'], ['rpsPerInstance', 'rps / instance'], ['latency', 'latency ms']] },
  cache:   { label: 'Redis',         w: 190, defaults: { name: 'redis', maxOps: 100000, hitRatio: 0.9, latency: 1, eviction: 'allkeys-lru' }, fields: [['maxOps', 'max ops/s'], ['hitRatio', 'hit ratio 0-1'], ['latency', 'latency ms']] },
  db:      { label: 'Postgres',      w: 200, defaults: { name: 'postgres', maxQps: 5000, readShare: 0.8, replicas: 1, latency: 8, tables: [] }, fields: [['maxQps', 'max qps / node'], ['replicas', 'read replicas'], ['readShare', 'read share 0-1'], ['latency', 'latency ms']] },
  queue:   { label: 'Kafka',         w: 200, defaults: { name: 'kafka', maxThroughput: 20000, latency: 5, topics: [] }, fields: [['maxThroughput', 'max msg/s'], ['latency', 'latency ms']] },
};

export const NODE_H = 92;
/** Row heights for the expanded view. Deterministic so Java agrees. */
export const EXP = { tableHead: 22, row: 16, tablePad: 8, tableGap: 10, endpointRow: 18, topicHead: 20, topicRow: 15, sectionPad: 10, max: 560 };
/** Expanded node height from its content; compact nodes are NODE_H. */
export function nodeHeight(n: { kind: Kind; endpoints?: Endpoint[]; tables?: Table[]; topics?: Topic[] }, detail: Detail | undefined): number {
  if (detail !== 'expanded') return NODE_H;
  let extra = 0;
  if (n.kind === 'db') { const ts = n.tables ?? []; extra = ts.reduce((h, t) => h + EXP.tableHead + (t.columns?.length ?? 0) * EXP.row + EXP.tablePad, 0) + Math.max(0, ts.length - 1) * EXP.tableGap; }
  else if (n.kind === 'service') extra = (n.endpoints?.length ?? 0) * EXP.endpointRow;
  else if (n.kind === 'queue') { const ts = n.topics ?? []; extra = ts.reduce((h, t) => h + EXP.topicHead + topicFields(t).length * EXP.topicRow, 0) + Math.max(0, ts.length - 1) * 6; }
  if (extra === 0) return NODE_H;
  return Math.min(EXP.max, NODE_H + EXP.sectionPad + extra + EXP.sectionPad);
}
/** Expanded nodes also widen so table rows fit. */
export function nodeWidthFor(n: { kind: Kind; name?: string; tables?: Table[] }, detail: Detail | undefined): number {
  const w = nodeWidth(n);
  if (detail !== 'expanded') return w;
  if (n.kind === 'db') { const longest = (n.tables ?? []).reduce((m, t) => Math.max(m, ...(t.columns ?? []).map(c => c.name.length + c.type.length + 3 + (c.references ? 6 : 0))), 0); return Math.min(360, Math.max(w, 40 + longest * 6.4 + 60)); }
  if (n.kind === 'service') return Math.max(w, 280);
  if (n.kind === 'queue') return Math.max(w, 280);
  return w;
}
/** Avro record fields as [name, type] pairs, from the schema text; empty if it doesn't parse. */
export function topicFields(t: Topic): [string, string][] {
  try {
    const j = JSON.parse(t.schema || '');
    if (!j || !Array.isArray(j.fields)) return [];
    return j.fields.map((f: any) => [String(f.name), avroType(f.type)]);
  } catch { return []; }
}
function avroType(t: any): string {
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.filter(x => x !== 'null').map(avroType).join('|') + (t.includes('null') ? '?' : '');
  if (t && typeof t === 'object') { if (t.logicalType) return t.logicalType; if (t.type === 'array') return `array<${avroType(t.items)}>`; if (t.type === 'map') return `map<${avroType(t.values)}>`; if (t.type === 'enum') return `enum(${(t.symbols || []).length})`; if (t.type === 'record') return t.name || 'record'; return String(t.type); }
  return String(t);
}
/** Foreign keys: [fromNode, fromTable, fromCol, toNode, toTable, toCol]. */
export function foreignKeys(doc: Doc): Array<{ from: { node: string; table: string; col: string }; to: { node: string; table: string; col: string } }> {
  const out: Array<{ from: { node: string; table: string; col: string }; to: { node: string; table: string; col: string } }> = [];
  for (const n of doc.nodes) if (n.kind === 'db') for (const t of n.tables ?? []) for (const c of t.columns ?? []) {
    if (!c.references) continue;
    let ref = c.references, node = n.id;
    if (ref.includes(':')) { const [nid, rest] = ref.split(':'); node = nid; ref = rest; }
    const [table, col] = ref.split('.');
    if (table) out.push({ from: { node: n.id, table: t.name, col: c.name }, to: { node, table, col: col || 'id' } });
  }
  return out;
}
/** Node width follows the name so long names aren't clipped; deterministic (no font metrics) so Java agrees. */
export function nodeWidth(n: { kind: Kind; name?: string }): number {
  const base = KINDS[n.kind].w;
  const need = 56 + (n.name?.length ?? 0) * 7.8 + 16;
  return Math.min(320, Math.max(base, Math.round(need / 8) * 8));
}
export const ICON = 26;
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const PG_TYPES = ['uuid', 'text', 'varchar(255)', 'integer', 'bigint', 'numeric(18,2)', 'boolean', 'timestamptz', 'date', 'jsonb'];
export const EVICTIONS = ['allkeys-lru', 'volatile-lru', 'allkeys-lfu', 'volatile-ttl', 'noeviction'];

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

let uid = 1;
export const nextId = (prefix = 'n') => prefix + (uid++);
export const bumpId = (doc: Doc) => {
  const all: { id: string }[] = [...doc.nodes, ...doc.edges, ...(doc.containers ?? []), ...(doc.links ?? [])];
  uid = Math.max(2, ...all.map(x => parseInt(String(x.id).replace(/\D/g, '')) || 0)) + 1;
};

export function makeContainer(kind: ContainerKind, name: string, parent: string | null = null): Container {
  return { id: nextId('c'), kind, name, parent };
}
/** Root-ward chain of container ids for a node (nearest first). */
export function ancestry(doc: Doc, containerId: string | null | undefined): string[] {
  const out: string[] = []; const byId = new Map(doc.containers.map(c => [c.id, c]));
  let cur = containerId ?? null; let guard = 0;
  while (cur && guard++ < 32) { out.push(cur); cur = byId.get(cur)?.parent ?? null; }
  return out;
}
/** Latency added to a call from container a to container b (either may be null = unplaced). */
export function crossingLatency(doc: Doc, a: string | null | undefined, b: string | null | undefined): number {
  if ((a ?? null) === (b ?? null)) return 0;
  const pa = ancestry(doc, a), pb = ancestry(doc, b);
  // explicit link between any ancestor pair wins (nearest first)
  for (const x of pa.length ? pa : ['']) for (const y of pb.length ? pb : ['']) {
    const l = doc.links.find(l => (l.from === x && l.to === y) || (l.from === y && l.to === x));
    if (l) return l.latencyMs;
  }
  if (!a || !b) return CROSSING_DEFAULT_MS.siblings;
  const rootA = pa[pa.length - 1], rootB = pb[pb.length - 1];
  return rootA === rootB ? CROSSING_DEFAULT_MS.siblings : CROSSING_DEFAULT_MS.differentRoots;
}
export function containerDepth(doc: Doc, id: string): number { return ancestry(doc, id).length - 1; }
/** Members of a container, including those in nested containers. */
export function membersOf(doc: Doc, id: string): Node[] { return doc.nodes.filter(n => ancestry(doc, n.container).includes(id)); }

export function makeNode(kind: Kind, x: number, y: number, props: Record<string, unknown> = {}): Node {
  return { id: nextId(), kind, x, y, ...clone(KINDS[kind].defaults), ...props } as Node;
}

/** Fill in any fields a loaded document is missing (older saves, hand-edited JSON). */
export function adopt(d: unknown): Doc {
  const doc = d as Doc;
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw new Error('not a cistem.io document');
  doc.nodes.forEach(n => {
    if (!KINDS[n.kind]) throw new Error('unknown kind ' + n.kind);
    const defs = KINDS[n.kind].defaults;
    Object.keys(defs).forEach(k => { if ((n as any)[k] === undefined) (n as any)[k] = clone(defs[k]); });
    if (n.container === undefined) n.container = null;
  });
  doc.containers = doc.containers ?? []; doc.links = doc.links ?? []; doc.frames = doc.frames ?? {}; doc.detail = doc.detail ?? {};
  // drop dangling references rather than failing
  const cids = new Set(doc.containers.map(c => c.id));
  doc.nodes.forEach(n => { if (n.container && !cids.has(n.container)) n.container = null; });
  doc.containers.forEach(c => { if (c.parent && !cids.has(c.parent)) c.parent = null; });
  doc.links = doc.links.filter(l => cids.has(l.from) && cids.has(l.to));
  bumpId(doc);
  return doc;
}

export function exampleDoc(): Doc {
  uid = 1;
  const clients = makeNode('entry', 20, 200, { name: 'Checkout clients' });
  const lb = makeNode('lb', 330, 200, { name: 'ALB' });
  const api = makeNode('service', 640, 200, {
    name: 'checkout-api', rpsPerInstance: 600, instances: 10, latency: 25, endpoints: [
      { method: 'POST', path: '/v1/payments', headers: [{ k: 'Authorization', v: 'Bearer <token>' }, { k: 'Idempotency-Key', v: '<uuid>' }],
        req: '{\n  "amount": 1299,\n  "currency": "GBP",\n  "card_token": "tok_..."\n}',
        res: '{\n  "id": "pay_01H...",\n  "status": "AUTHORISED"\n}' },
      { method: 'GET', path: '/v1/payments/{id}', headers: [{ k: 'Authorization', v: 'Bearer <token>' }], req: '', res: '{\n  "id": "pay_01H...",\n  "status": "CAPTURED"\n}' },
    ] });
  const cache = makeNode('cache', 960, 60, { name: 'session-cache', hitRatio: 0.85 });
  const db = makeNode('db', 960, 260, {
    name: 'payments-db', maxQps: 4000, replicas: 2, readShare: 0.85, latency: 6, tables: [
      { name: 'payments', columns: [
        { name: 'id', type: 'uuid', pk: true, nullable: false }, { name: 'merchant_id', type: 'uuid', pk: false, nullable: false, index: true },
        { name: 'idempotency_key', type: 'text', pk: false, nullable: false, unique: true },
        { name: 'amount_minor', type: 'bigint', pk: false, nullable: false }, { name: 'currency', type: 'varchar(255)', pk: false, nullable: false },
        { name: 'status', type: 'text', pk: false, nullable: false }, { name: 'created_at', type: 'timestamptz', pk: false, nullable: false } ] },
      { name: 'refunds', columns: [
        { name: 'id', type: 'uuid', pk: true, nullable: false }, { name: 'payment_id', type: 'uuid', pk: false, nullable: false, references: 'payments.id' },
        { name: 'amount_minor', type: 'bigint', pk: false, nullable: false } ] },
    ] });
  const q = makeNode('queue', 960, 460, {
    name: 'events', topics: [{ name: 'payments.authorised', partitions: 12,
      schema: '{\n  "type": "record",\n  "name": "PaymentAuthorised",\n  "namespace": "com.example.payments",\n  "fields": [\n    {"name": "paymentId", "type": "string"},\n    {"name": "amountMinor", "type": "long"},\n    {"name": "currency", "type": "string"}\n  ]\n}' }] });
  const worker = makeNode('service', 1280, 460, { name: 'ledger-worker', rpsPerInstance: 400, instances: 8, latency: 40 });
  const aws = makeContainer('cloud', 'AWS'); aws.provider = 'aws';
  const edge = makeContainer('account', 'acq-edge', aws.id);
  const core = makeContainer('account', 'acq-core', aws.id);
  lb.container = edge.id; api.container = edge.id;
  cache.container = core.id; db.container = core.id; q.container = core.id; worker.container = core.id;
  const doc: Doc = {
    targetRps: 5000, containers: [aws, edge, core], frames: {}, detail: { [db.id]: 'expanded' },
    links: [{ id: 'l1', from: edge.id, to: core.id, type: 'privatelink', latencyMs: 2 }],
    nodes: [clients, lb, api, cache, db, q, worker], edges: [
      { id: 'e1', from: clients.id, to: lb.id, calls: 1 },
      { id: 'e2', from: lb.id, to: api.id, calls: 1, endpoint: 0 },
      { id: 'e3', from: api.id, to: cache.id, calls: 2 },
      { id: 'e4', from: cache.id, to: db.id, calls: 1 },
      { id: 'e5', from: api.id, to: db.id, calls: 1 },
      { id: 'e6', from: api.id, to: q.id, calls: 1 },
      { id: 'e7', from: q.id, to: worker.id, calls: 1 },
    ] };
  uid = 20;
  return doc;
}
