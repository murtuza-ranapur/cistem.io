import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { exampleDoc } from '../src/model';
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

// v1 (bare editor doc) migrates
const v1 = JSON.parse(JSON.stringify({ targetRps: 1234, nodes: doc.nodes, edges: doc.edges }));
const m = migrate(v1);
assert.equal(m.version, 2); assert.equal(m.kind, 'system'); assert.equal(m.model.targetRps, 1234);
assert.ok(validate(m), JSON.stringify(validate.errors, null, 1));

// unknown future version is refused clearly
assert.throws(() => migrate({ version: 99, kind: 'system' }), /newer/);
// wrong kind is refused
assert.throws(() => migrate({ version: 2, kind: 'sequence', meta: {}, model: { nodes: [], edges: [] }, layout: {} }), /kind/);
// nodes without a position default to 0,0 rather than failing
const noLayout = { ...file, layout: { positions: {} } };
assert.equal(fromFile(noLayout).doc.nodes[0].x, 0);

console.log('document tests passed');
