/**
 * Generates the fixtures the Java tests compare against (backend/src/test/resources/parity*.json), so the
 * TypeScript engine/layout/migration and their Java mirrors can't drift apart. Run: npx tsx test/parity-fixtures.ts
 */
import { writeFileSync } from 'node:fs';
import { exampleDoc, makeNode } from '../src/model';
import { compute } from '../src/engine';
import { layeredLayout } from '../src/layout';
import { toFile, v3to4 } from '../src/document';

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
// 3. a v3 document and what it migrates to
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
