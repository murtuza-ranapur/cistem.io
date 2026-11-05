export type Kind = 'entry' | 'lb' | 'service' | 'cache' | 'db' | 'queue';

export interface Header { k: string; v: string }
export interface Endpoint { method: string; path: string; headers: Header[]; req: string; res: string }
export interface Column { name: string; type: string; pk: boolean; nullable: boolean }
export interface Table { name: string; columns: Column[] }
export interface Topic { name: string; partitions: number; schema: string }

export interface NodeBase { id: string; kind: Kind; x: number; y: number; name: string; latency?: number }
export interface EntryNode extends NodeBase { kind: 'entry'; platforms: string[] }
export interface LbNode extends NodeBase { kind: 'lb'; maxRps: number; latency: number }
export interface ServiceNode extends NodeBase { kind: 'service'; rpsPerInstance: number; instances: number; latency: number; endpoints: Endpoint[] }
export interface CacheNode extends NodeBase { kind: 'cache'; maxOps: number; hitRatio: number; latency: number; eviction: string }
export interface DbNode extends NodeBase { kind: 'db'; maxQps: number; readShare: number; replicas: number; latency: number; tables: Table[] }
export interface QueueNode extends NodeBase { kind: 'queue'; maxThroughput: number; latency: number; topics: Topic[] }
export type Node = EntryNode | LbNode | ServiceNode | CacheNode | DbNode | QueueNode;

export interface Edge { id: string; from: string; to: string; calls: number; endpoint?: number | null }
export interface Doc { targetRps: number; nodes: Node[]; edges: Edge[] }

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
export const ICON = 26;
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const PG_TYPES = ['uuid', 'text', 'varchar(255)', 'integer', 'bigint', 'numeric(18,2)', 'boolean', 'timestamptz', 'date', 'jsonb'];
export const EVICTIONS = ['allkeys-lru', 'volatile-lru', 'allkeys-lfu', 'volatile-ttl', 'noeviction'];

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

let uid = 1;
export const nextId = (prefix = 'n') => prefix + (uid++);
export const bumpId = (doc: Doc) => {
  uid = Math.max(2, ...doc.nodes.concat(doc.edges as unknown as Node[]).map(x => parseInt(String(x.id).replace(/\D/g, '')) || 0)) + 1;
};

export function makeNode(kind: Kind, x: number, y: number, props: Record<string, unknown> = {}): Node {
  return { id: nextId(), kind, x, y, ...clone(KINDS[kind].defaults), ...props } as Node;
}

/** Fill in any fields a loaded document is missing (older saves, hand-edited JSON). */
export function adopt(d: unknown): Doc {
  const doc = d as Doc;
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw new Error('not a Loadmap document');
  doc.nodes.forEach(n => {
    if (!KINDS[n.kind]) throw new Error('unknown kind ' + n.kind);
    const defs = KINDS[n.kind].defaults;
    Object.keys(defs).forEach(k => { if ((n as any)[k] === undefined) (n as any)[k] = clone(defs[k]); });
  });
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
        { name: 'id', type: 'uuid', pk: true, nullable: false }, { name: 'merchant_id', type: 'uuid', pk: false, nullable: false },
        { name: 'amount_minor', type: 'bigint', pk: false, nullable: false }, { name: 'currency', type: 'varchar(255)', pk: false, nullable: false },
        { name: 'status', type: 'text', pk: false, nullable: false }, { name: 'created_at', type: 'timestamptz', pk: false, nullable: false } ] },
      { name: 'refunds', columns: [
        { name: 'id', type: 'uuid', pk: true, nullable: false }, { name: 'payment_id', type: 'uuid', pk: false, nullable: false },
        { name: 'amount_minor', type: 'bigint', pk: false, nullable: false } ] },
    ] });
  const q = makeNode('queue', 960, 460, {
    name: 'events', topics: [{ name: 'payments.authorised', partitions: 12,
      schema: '{\n  "type": "record",\n  "name": "PaymentAuthorised",\n  "namespace": "com.example.payments",\n  "fields": [\n    {"name": "paymentId", "type": "string"},\n    {"name": "amountMinor", "type": "long"},\n    {"name": "currency", "type": "string"}\n  ]\n}' }] });
  const worker = makeNode('service', 1280, 460, { name: 'ledger-worker', rpsPerInstance: 400, instances: 8, latency: 40 });
  const doc: Doc = {
    targetRps: 5000, nodes: [clients, lb, api, cache, db, q, worker], edges: [
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
