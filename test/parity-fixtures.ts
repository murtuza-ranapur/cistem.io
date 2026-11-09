/**
 * Generates the fixtures the Java tests compare against (backend/src/test/resources/parity*.json), so the
 * TypeScript engine/layout/migration and their Java mirrors can't drift apart. Run: npx tsx test/parity-fixtures.ts
 */
import { parseCistem, printSeq } from '../src/domain/seq';
import { writeFileSync } from 'node:fs';
import { exampleDoc, makeNode } from '../src/domain/model';
import { compute } from '../src/domain/engine';
import { layeredLayout } from '../src/domain/layout';
import { toFile, v3to4 } from '../src/domain/document';

const res = '/home/claude/cistem.io/backend/src/test/resources/'.replace('/home/claude/cistem.io/', new URL('..', import.meta.url).pathname);
const expected = (doc: any) => {
  const r = compute(doc), l = layeredLayout(doc);
  return {
    nodes: Object.fromEntries(Object.entries(r.nodes).map(([id, n]) => [id, { load: n.load, cap: n.cap === Infinity ? null : n.cap, util: isFinite(n.util) ? n.util : null, status: n.status, lat: n.lat, cum: n.cum }])),
    edges: r.edges, crossings: r.crossings,
    verdict: { status: r.verdict.status, node: r.verdict.node?.id ?? null, lat: r.verdict.lat, converged: r.verdict.converged },
    layout: l.positions, frames: l.frames,
  };
};
const write = (name: string, doc: any, title: string) => {
  const file = toFile(doc, { title, created: '2026-01-01T00:00:00Z' }); file.meta.updated = '2026-01-01T00:00:00Z';
  const out = { file, expected: expected(doc) };
  writeFileSync(res + name, JSON.stringify(out, null, 1));
  console.log(name, out.expected.verdict);
};

// 1. the example, with two clients sending different peaks (total 7000)
{
  const doc = exampleDoc();
  const web = doc.nodes.find(n => n.kind === 'entry') as any; web.rps = 4500; web.name = 'Web';
  const app = makeNode('entry', 20, 360, { name: 'App', rps: 2500 }) as any;
  doc.nodes.push(app); doc.edges.push({ id: 'e99', from: app.id, to: doc.edges[0].to, calls: 1 });
  write('parity.json', doc, 'Parity fixture');
}
// 2. a service consuming its own Kafka topic
{
  const m = makeNode('entry', 0, 0, { name: 'Merchants (batch upload)', rps: 40 }), svc = makeNode('service', 0, 0, { name: 'ecom-transaction-payments', instances: 4, rpsPerInstance: 400 });
  const q = makeNode('queue', 0, 0, { name: 'payments.batch' }), cards = makeNode('service', 0, 0, { name: 'ecom-legacy-cards', instances: 3, rpsPerInstance: 500 });
  const d2 = { nodes: [m, svc, q, cards], containers: [], links: [], frames: {}, detail: {}, edges: [
    { id: 'e1', from: m.id, to: svc.id, calls: 1 }, { id: 'e2', from: svc.id, to: q.id, calls: 40 }, { id: 'e3', from: q.id, to: svc.id, calls: 1 }, { id: 'e4', from: svc.id, to: cards.id, calls: 1 } ] };
  write('parity-loop.json', d2, 'Loop fixture');
}
// 3. the newer component types: CDN → API gateway → service → MongoDB, and an SQS queue drained by a worker
{
  const c = makeNode('entry', 0, 0, { name: 'Shoppers', rps: 12000 });
  const cdn = makeNode('cdn', 0, 0, { name: 'edge-cdn', hitRatio: 0.75 });
  const gw = makeNode('apigw', 0, 0, { name: 'gateway', maxRps: 5000 });
  const svc = makeNode('service', 0, 0, { name: 'orders', instances: 6, rpsPerInstance: 600, endpoints: [{ method: 'POST', path: '/orders', headers: [], req: '', res: '' }] });
  const mongo = makeNode('mongodb', 0, 0, { name: 'orders-db', maxQps: 4000, replicas: 2, readShare: 0.7 });
  const sqs = makeNode('sqs', 0, 0, { name: 'fulfilment', fifo: true, key: 'orderId', schema: '{"type":"record","name":"Fulfil","fields":[{"name":"orderId","type":"string"}]}' });
  const worker = makeNode('service', 0, 0, { name: 'fulfilment-worker', variant: 'Worker', instances: 2, rpsPerInstance: 300 });
  // external systems: one unlimited (blank rate limit), one rate-limited below its load
  const psp = makeNode('external', 0, 0, { name: 'payments', latency: 220 });
  const tax = makeNode('external', 0, 0, { name: 'tax-api', maxRps: 1500, latency: 90 });
  const d3 = { nodes: [c, cdn, gw, svc, mongo, sqs, worker, psp, tax], containers: [], links: [], frames: {}, detail: { [svc.id]: 'expanded', [sqs.id]: 'expanded' } as Record<string, 'expanded'>, edges: [
    { id: 'e1', from: c.id, to: cdn.id, calls: 1 }, { id: 'e2', from: cdn.id, to: gw.id, calls: 1 }, { id: 'e3', from: gw.id, to: svc.id, calls: 1 },
    { id: 'e4', from: svc.id, to: mongo.id, calls: 2 }, { id: 'e5', from: svc.id, to: sqs.id, calls: 1 }, { id: 'e6', from: sqs.id, to: worker.id, calls: 1 },
    { id: 'e7', from: svc.id, to: psp.id, calls: 1 }, { id: 'e8', from: svc.id, to: tax.id, calls: 1 } ] };
  write('parity-types.json', d3, 'Types fixture');
}
// 4. a v3 document and what it migrates to
{
  const v3 = {
    version: 3, kind: 'system', meta: { title: 'v3', created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z' },
    model: { targetRps: 2000, containers: [], links: [], nodes: [
      { id: 'n1', kind: 'entry', name: 'web', platforms: ['web'], container: null },
      { id: 'n3', kind: 'service', name: 'api', rpsPerInstance: 500, instances: 4, latency: 10, endpoints: [], container: null },
      { id: 'n4', kind: 'queue', name: 'events', maxThroughput: 20000, latency: 5, container: null, topics: [
        { name: 'payments.authorised', partitions: 12, schema: '{"type":"record","name":"A","fields":[{"name":"id","type":"string"}]}', key: 'id' },
        { name: 'payments.refunded', partitions: 3, schema: '' }] },
      { id: 'n5', kind: 'service', name: 'worker', rpsPerInstance: 500, instances: 2, latency: 10, endpoints: [], container: null }],
      edges: [{ id: 'e1', from: 'n1', to: 'n3', calls: 1 }, { id: 'e3', from: 'n3', to: 'n4', calls: 1 }, { id: 'e4', from: 'n4', to: 'n5', calls: 1 }] },
    layout: { positions: { n1: { x: 0, y: 0 }, n3: { x: 300, y: 0 }, n4: { x: 600, y: 0 }, n5: { x: 900, y: 0 } }, frames: {} },
  };
  writeFileSync(res + 'migrate-v3.json', JSON.stringify({ input: v3, expected: v3to4(JSON.parse(JSON.stringify(v3))) }, null, 1));
  console.log('migrate-v3.json');
}
// 5. sequence text: parse (ids aside) and print agree
{
  const cases = [
    'participant merchants, proxy\nparticipant ecom "ecom-transaction-payments" service @n3\n\nmerchants -> proxy: POST /uploads\nalt merchant on legacy\n  proxy -> legacy: forward\n  legacy --> proxy: 202 Accepted\nelse\n  proxy -> ecom: POST /payments/batch\nend\necom ->> items: publish item\nloop for each item # comment\n  items ->> ecom: consume\n  note over ecom, items: idempotent\nend\n',
    '# a comment line\n// another\nactor user\nuser->api:GET /x?a=1#frag // keep\nnote over api: Order #42 // see https://x.io\napi-->user\npar\n  api ->> a: one\nand second\n  api ->> b: two\nend\nnote left of api: done',
    'a -> b: ok\nelse\nloop forever\na -> b\nwat is this\nparticipant a\nparticipant 9x\nb -> c:   spaced label  ',
    'participant p-1 "Name \\"q\\"" queue\np-1 -> p-1: self\nopt\nend',
  ];
  const out = cases.map(text => {
    const p = parseCistem(text);
    const strip = (rows: any[]) => rows.map(({ id: _id, ...r }) => r);
    return { text, participants: p.doc.participants, rows: strip(p.doc.rows), errors: p.errors, printed: printSeq(p.doc) };
  });
  writeFileSync(res + 'seq-text.json', JSON.stringify(out, null, 1));
  console.log('seq-text.json');
}
// 6. absurd inputs: negatives, numeric strings, text, booleans, NaN read the same in both engines
{
  const c = makeNode('entry', 0, 0, { name: 'c', rps: '250' }) as any, c2 = makeNode('entry', 0, 0, { name: 'neg', rps: -500 }) as any;
  const s = makeNode('service', 0, 0, { name: 's', instances: '2', rpsPerInstance: true, latency: -40 }) as any;
  const r = makeNode('cache', 0, 0, { name: 'r', hitRatio: '1.7', maxOps: 'lots' }) as any, d = makeNode('db', 0, 0, { name: 'd', replicas: -3, readShare: 'x' }) as any;
  const doc = { nodes: [c, c2, s, r, d], edges: [{ id: 'a', from: c.id, to: s.id, calls: '3' }, { id: 'b', from: c2.id, to: s.id, calls: -1 }, { id: 'x', from: s.id, to: r.id, calls: 1 }, { id: 'y', from: r.id, to: d.id, calls: 'NaN' }], containers: [], links: [], frames: {}, detail: {} } as any;
  write('parity-absurd.json', doc, 'Absurd inputs');
}
// 7. an unconnected component doesn't count towards end-to-end latency
{
  const c = makeNode('entry', 0, 0, { name: 'c', rps: 100 }) as any, s = makeNode('service', 0, 0, { name: 's', latency: 5 }) as any, lone = makeNode('service', 0, 0, { name: 'lone', latency: 900 }) as any;
  write('parity-unreached.json', { nodes: [c, s, lone], edges: [{ id: 'a', from: c.id, to: s.id, calls: 1 }], containers: [], links: [], frames: {}, detail: {} } as any, 'Unreached');
}
