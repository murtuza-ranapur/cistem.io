/**
 * A checkout system used as a fixture by the tests (the app itself starts with a blank diagram): entry, load
 * balancer, an API with endpoints, a cache, a database with tables, a topic and a worker, in two accounts.
 */
import { makeNode, makeContainer, nodeHeight, resetIds, type Doc } from '../src/domain/model';
import { toFile } from '../src/domain/document';

export function exampleDoc(): Doc {
  resetIds(1);
  const clients = makeNode('entry', 20, 200, { name: 'Checkout clients', rps: 5000 });
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
    name: 'payments.authorised', cluster: 'events', partitions: 12, key: 'paymentId',
    schema: '{\n  "type": "record",\n  "name": "PaymentAuthorised",\n  "namespace": "com.example.payments",\n  "fields": [\n    {"name": "paymentId", "type": "string"},\n    {"name": "amountMinor", "type": "long"},\n    {"name": "currency", "type": "string"}\n  ]\n}' });
  const worker = makeNode('service', 1280, 460, { name: 'ledger-worker', rpsPerInstance: 400, instances: 8, latency: 40 });
  const aws = makeContainer('cloud', 'AWS'); aws.provider = 'aws';
  const edge = makeContainer('account', 'acq-edge', aws.id);
  const core = makeContainer('account', 'acq-core', aws.id);
  // the database starts expanded: keep what sits under it clear of its tables
  const below = db.y + nodeHeight(db, 'expanded') + 48;
  if (q.y < below) { q.y = below; worker.y = below; }
  lb.container = edge.id; api.container = edge.id;
  cache.container = core.id; db.container = core.id; q.container = core.id; worker.container = core.id;
  const doc: Doc = {
    containers: [aws, edge, core], frames: {}, detail: { [db.id]: 'expanded' },
    links: [{ id: 'l1', from: edge.id, to: core.id, type: 'privatelink', latencyMs: 2 }],
    nodes: [clients, lb, api, cache, db, q, worker], edges: [
      { id: 'e1', from: clients.id, to: lb.id, calls: 1 },
      { id: 'e2', from: lb.id, to: api.id, calls: 1, endpoints: [{ i: 0, calls: 1 }] },
      { id: 'e3', from: api.id, to: cache.id, calls: 2 },
      { id: 'e4', from: cache.id, to: db.id, calls: 1 },
      { id: 'e5', from: api.id, to: db.id, calls: 1 },
      { id: 'e6', from: api.id, to: q.id, calls: 1 },
      { id: 'e7', from: q.id, to: worker.id, calls: 1 },
    ] };
  resetIds(20);
  return doc;
}

export const exampleFile = () => toFile(exampleDoc(), { title: 'Checkout example', created: new Date().toISOString(), updated: new Date().toISOString() });
