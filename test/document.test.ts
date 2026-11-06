import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { exampleDoc, crossingLatency } from '../src/model';
import { compute } from '../src/engine';
import { toFile, fromFile, migrate, FORMAT_VERSION } from '../src/document';

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
assert.equal(m2.version, 3); assert.deepEqual(m2.model.containers, []); assert.deepEqual(m2.layout.frames, {});
assert.ok(validate(m2), JSON.stringify(validate.errors, null, 1));

// v1 (bare editor doc) migrates
const v1 = JSON.parse(JSON.stringify({ targetRps: 1234, nodes: doc.nodes, edges: doc.edges }));
const m = migrate(v1);
assert.equal(m.version, 3); assert.equal(m.kind, 'system'); assert.equal(m.model.targetRps, 1234);
assert.ok(validate(m), JSON.stringify(validate.errors, null, 1));

// unknown future version is refused clearly
assert.throws(() => migrate({ version: 99, kind: 'system' }), /newer/);
// wrong kind is refused
assert.throws(() => migrate({ version: 2, kind: 'sequence', meta: {}, model: { nodes: [], edges: [] }, layout: {} }), /kind/);
// nodes without a position default to 0,0 rather than failing
const noLayout = { ...file, layout: { positions: {} } };
assert.equal(fromFile(noLayout).doc.nodes[0].x, 0);

console.log('document tests passed');
