import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { exampleDoc, crossingLatency, TYPES, makeNode } from '../src/domain/model';
import { compute } from '../src/domain/engine';
import { toFile, fromFile, migrate, FORMAT_VERSION } from '../src/domain/document';

const schema = JSON.parse(readFileSync(new URL('../schema/cistem.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false }); addFormats(ajv);
const validate = ajv.compile(schema);

// v2 file produced by the app validates against the schema
const doc = exampleDoc();
const file = toFile(doc, { title: 'Checkout example' });
assert.equal(file.version, FORMAT_VERSION);
assert.ok(validate(file), JSON.stringify(validate.errors, null, 1));
assert.ok(!('x' in file.model.nodes[0]), 'model carries no coordinates');
assert.equal(Object.keys(file.layout.positions).length, doc.nodes.length);

// round trip restores positions and everything else
const back = fromFile(JSON.parse(JSON.stringify(file)));
assert.deepEqual(back.doc.nodes.map(n => [n.id, n.x, n.y]), doc.nodes.map(n => [n.id, n.x, n.y]));
assert.deepEqual(back.doc.edges, doc.edges);
assert.equal(back.meta.title, 'Checkout example');

// containers round-trip and crossing latency applies
assert.equal(back.doc.containers.length, 3);
assert.equal(back.doc.nodes.find(n => n.id === 'n3')!.container, back.doc.containers[1].id);
const [aws, edge, core] = back.doc.containers;
assert.equal(crossingLatency(back.doc, edge.id, edge.id), 0, 'same container');
assert.equal(crossingLatency(back.doc, edge.id, core.id), 2, 'declared privatelink');
assert.equal(crossingLatency(back.doc, null, edge.id), 1, 'unplaced → sibling default');
const ibm = { id: 'c99', kind: 'cloud' as const, name: 'IBM', parent: null };
back.doc.containers.push(ibm);
assert.equal(crossingLatency(back.doc, core.id, ibm.id), 10, 'different clouds default');
assert.equal(crossingLatency(back.doc, edge.id, aws.id), 1, 'child → its own parent counts as sibling-ish hop');
const r = compute(back.doc);
assert.equal(r.crossings['e2'], 0, 'lb → api both in acq-edge');
assert.equal(r.crossings['e3'], 2, 'api → cache crosses accounts over privatelink');

// v2 file migrates to v3 with empty containers
const v2 = { version: 2, kind: 'system', meta: file.meta, model: { targetRps: 1, nodes: file.model.nodes, edges: file.model.edges }, layout: { positions: file.layout.positions } };
const m2 = migrate(JSON.parse(JSON.stringify(v2)));
assert.equal(m2.version, 4); assert.deepEqual(m2.model.containers, []); assert.deepEqual(m2.layout.frames, {});
assert.ok(validate(m2), JSON.stringify(validate.errors, null, 1));

// v1 (bare editor doc) migrates
const v1 = JSON.parse(JSON.stringify({ targetRps: 1234, nodes: doc.nodes, edges: doc.edges }));
const m = migrate(v1);
assert.equal(m.version, 4); assert.equal(m.kind, 'system'); assert.ok(!('targetRps' in m.model));
assert.equal((m.model.nodes.find((n: any) => n.kind === 'entry') as any).rps, 5000, 'example client keeps its own rps');
assert.ok(validate(m), JSON.stringify(validate.errors, null, 1));

// v3 → v4: the diagram-wide target becomes each client's rps; multi-topic Kafka nodes split into one per topic
{
  const v3 = {
    version: 3, kind: 'system', meta: { title: 't', created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z' },
    model: {
      targetRps: 2000, containers: [], links: [],
      nodes: [
        { id: 'n1', kind: 'entry', name: 'web', platforms: ['web'] },
        { id: 'n2', kind: 'entry', name: 'app', platforms: ['app'] },
        { id: 'n3', kind: 'service', name: 'api', rpsPerInstance: 500, instances: 4, latency: 10, endpoints: [] },
        { id: 'n4', kind: 'queue', name: 'events', maxThroughput: 20000, latency: 5, topics: [
          { name: 'payments.authorised', partitions: 12, schema: '{"type":"record","name":"A","fields":[{"name":"id","type":"string"}]}', key: 'id' },
          { name: 'payments.refunded', partitions: 3, schema: '' }] },
        { id: 'n5', kind: 'service', name: 'worker', rpsPerInstance: 500, instances: 2, latency: 10, endpoints: [] },
      ],
      edges: [{ id: 'e1', from: 'n1', to: 'n3', calls: 1 }, { id: 'e2', from: 'n2', to: 'n3', calls: 1 }, { id: 'e3', from: 'n3', to: 'n4', calls: 1 }, { id: 'e4', from: 'n4', to: 'n5', calls: 1 }],
    },
    layout: { positions: { n1: { x: 0, y: 0 }, n2: { x: 0, y: 120 }, n3: { x: 300, y: 0 }, n4: { x: 600, y: 0 }, n5: { x: 900, y: 0 } }, frames: {} },
  };
  const before = compute(fromFileV3Engine(v3));
  const m4 = migrate(JSON.parse(JSON.stringify(v3)));
  assert.equal(m4.version, 4); assert.ok(!('targetRps' in m4.model));
  assert.deepEqual(m4.model.nodes.filter((n: any) => n.kind === 'entry').map((n: any) => n.rps), [2000, 2000], 'each client gets the old target');
  const qs = m4.model.nodes.filter((n: any) => n.kind === 'queue') as any[];
  assert.deepEqual(qs.map(q => [q.name, q.partitions, q.cluster, q.key ?? null]), [['payments.authorised', 12, 'events', 'id'], ['payments.refunded', 3, 'events', null]]);
  assert.equal(qs[0].id, 'n4', 'first topic keeps the node id'); assert.ok(!('topics' in qs[0]));
  const q2 = qs[1].id;
  assert.ok(m4.model.edges.some((e: any) => e.from === 'n3' && e.to === q2) && m4.model.edges.some((e: any) => e.from === q2 && e.to === 'n5'), 'split topic wired like the original');
  assert.deepEqual(m4.layout.positions[q2], { x: 600, y: 132 }, 'placed under the original');
  assert.ok(validate(m4), JSON.stringify(validate.errors, null, 1));
  const after = compute(fromFile(m4).doc);
  assert.equal(after.nodes.n3.load, before.nodes.n3.load, 'service load unchanged by the migration (4000)');
  assert.equal(after.nodes.n3.load, 4000);
}
function fromFileV3Engine(v3: any) {
  // what the v3 engine saw: every entry injected the full target
  const d = JSON.parse(JSON.stringify(v3));
  d.model.nodes.forEach((n: any) => { if (n.kind === 'entry') n.rps = d.model.targetRps; if (n.kind === 'queue') { n.partitions = 1; n.schema = ''; } });
  d.model.nodes = d.model.nodes.map((n: any) => { const { topics, ...r } = n; return r; });
  delete d.model.targetRps; d.version = 4;
  return fromFile(d).doc;
}

// unknown future version is refused clearly
assert.throws(() => migrate({ version: 99, kind: 'system' }), /newer/);
// wrong kind is refused
assert.throws(() => migrate({ version: 2, kind: 'sequence', meta: {}, model: { nodes: [], edges: [] }, layout: {} }), /kind/);
// nodes without a position default to 0,0 rather than failing
const noLayout = { ...file, layout: { positions: {} } };
assert.equal(fromFile(noLayout).doc.nodes[0].x, 0);

console.log('document tests passed');

// every component type in shared/component-types.json makes a node the schema accepts
{
  const nodes = Object.keys(TYPES).map((k, i) => makeNode(k, i * 250, 0));
  const f = toFile({ nodes, edges: [], containers: [], links: [], frames: {}, detail: {} } as any, { title: 'all types', created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z' });
  assert.ok(validate(f), JSON.stringify(validate.errors, null, 1));
  assert.ok(Object.keys(TYPES).length >= 10, 'new types are present');
  console.log('component types validate');
}

// logos: a raster data: URL survives a round trip; anything else is dropped when a file is read
{
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGP4z8DwHwqRWQwMAMJ4Bf8kVb3uAAAAAElFTkSuQmCC';
  const good = makeNode('service', 0, 0, { name: 'ok', logo: png, variant: 'Application', border: 'dashed' });
  const bad = makeNode('service', 300, 0, { name: 'evil', logo: 'javascript:alert(1)', border: 'wavy' });
  const svg = makeNode('service', 600, 0, { name: 'svg', logo: 'data:image/svg+xml;base64,PHN2Zy8+' });
  const f = toFile({ nodes: [good, bad, svg], edges: [], containers: [], links: [], frames: {}, detail: {} } as any, { title: 'logos' });
  const back = fromFile(JSON.parse(JSON.stringify(f))).doc.nodes;
  assert.equal(back[0].logo, png); assert.equal(back[0].variant, 'Application'); assert.equal(back[0].border, 'dashed');
  assert.equal(back[1].logo, undefined, 'script URL dropped'); assert.equal(back[1].border, undefined, 'unknown border dropped'); assert.equal(back[2].logo, undefined, 'SVG never stored');
  assert.ok(validate(toFile({ nodes: [good], edges: [], containers: [], links: [], frames: {}, detail: {} } as any, { title: 'x' })), JSON.stringify(validate.errors));
  console.log('logos, types and borders');
}

// connection labels and styles, component colours: kept when valid, dropped otherwise
{
  const a = makeNode('service', 0, 0, { name: 'a', color: 'teal' }), b = makeNode('service', 300, 0, { name: 'b', color: 'chartreuse' });
  const good = { id: 'e1', from: a.id, to: b.id, calls: 1, label: 'route', showNotes: true, line: 'dotted', color: 'violet', width: 'thick', arrows: 'both' };
  const bad = { id: 'e2', from: b.id, to: a.id, calls: 1, label: 42, showNotes: 'yes', line: 'wavy', color: '#f00', width: 'huge', arrows: 'left' };
  const f = toFile({ nodes: [a, b], edges: [good, bad], containers: [], links: [], frames: {}, detail: {} } as any, { title: 'style' });
  const back = fromFile(JSON.parse(JSON.stringify(f))).doc;
  const [e1, e2] = back.edges;
  assert.deepEqual([e1.label, e1.showNotes, e1.line, e1.color, e1.width, e1.arrows], ['route', true, 'dotted', 'violet', 'thick', 'both']);
  for (const k of ['label', 'showNotes', 'line', 'color', 'width', 'arrows']) assert.equal((e2 as any)[k], undefined, k + ' dropped');
  assert.equal(back.nodes[0].color, 'teal'); assert.equal(back.nodes[1].color, undefined);
  assert.ok(validate(toFile({ nodes: [a], edges: [], containers: [], links: [], frames: {}, detail: {} } as any, { title: 'x' })), JSON.stringify(validate.errors));
  console.log('connection labels and styles, component colours');
}
