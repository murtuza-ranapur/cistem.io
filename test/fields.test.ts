import assert from 'node:assert/strict';
import { parseJsonFields, jsonFieldsToText, parseAvro, avroToText, listAt } from '../src/domain/fields';
import { exampleDoc, topicFields } from '../src/domain/model';

// JSON bodies: example text → fields → text is stable and preserves shape
const body = '{\n  "id": "pay_01H...",\n  "amount": { "minor": 1200, "currency": "GBP" },\n  "items": [{ "sku": "A1", "qty": 2 }],\n  "tags": ["a"],\n  "captured": true,\n  "ref": null\n}';
const fs = parseJsonFields(body)!;
assert.ok(fs, 'parses');
assert.deepEqual(fs.map(f => [f.name, f.type]), [['id', 'string'], ['amount', 'object'], ['items', 'array'], ['tags', 'array'], ['captured', 'boolean'], ['ref', 'null']]);
assert.equal(fs[1].children!.length, 2);
assert.equal(fs[2].items, 'object'); assert.equal(fs[2].children![1].type, 'integer');
assert.equal(fs[3].items, 'string');
const text = jsonFieldsToText(fs);
assert.deepEqual(JSON.parse(text), JSON.parse(body), 'round trip');
assert.deepEqual(parseJsonFields(jsonFieldsToText(parseJsonFields(text)!)), fs, 'stable');

// editing the tree
const list = listAt(fs, '1'); list.push({ name: 'fx', type: 'number', example: '1.25' });
assert.equal(JSON.parse(jsonFieldsToText(fs)).amount.fx, 1.25);
fs[0].type = 'integer'; fs[0].example = 'abc'; // bad example falls back to a default of the right type
assert.equal(JSON.parse(jsonFieldsToText(fs)).id, 1);


assert.deepEqual(parseJsonFields(''), []);
assert.equal(parseJsonFields('[1,2]'), null, 'arrays at the root stay raw');
assert.equal(parseJsonFields('{ nope'), null, 'invalid stays raw');
assert.equal(jsonFieldsToText([]), '');

// Avro
const avro = (exampleDoc().nodes.find(n => n.kind === 'queue') as any).schema;
const rec = parseAvro(avro)!;
assert.equal(rec.name, 'PaymentAuthorised'); assert.equal(rec.namespace, 'com.example.payments');
assert.deepEqual(rec.fields.map(f => [f.name, f.type, f.nullable]), [['paymentId', 'string', false], ['amountMinor', 'long', false], ['currency', 'string', false]]);
assert.deepEqual(JSON.parse(avroToText(rec)), JSON.parse(avro), 'avro round trip');

const rich = parseAvro(JSON.stringify({
  type: 'record', name: 'Order', fields: [
    { name: 'id', type: { type: 'string', logicalType: 'uuid' } },
    { name: 'at', type: { type: 'long', logicalType: 'timestamp-millis' } },
    { name: 'note', type: ['null', 'string'], default: null },
    { name: 'status', type: { type: 'enum', name: 'Status', symbols: ['NEW', 'PAID'] } },
    { name: 'lines', type: { type: 'array', items: { type: 'record', name: 'Line', fields: [{ name: 'sku', type: 'string' }, { name: 'qty', type: 'int' }] } } },
    { name: 'attrs', type: { type: 'map', values: 'string' } },
  ],
}))!;
assert.ok(rich);
assert.deepEqual(rich.fields.map(f => f.type), ['uuid', 'timestamp-millis', 'string', 'enum', 'array', 'map']);
assert.equal(rich.fields[2].nullable, true);
assert.equal(rich.fields[3].symbols, 'NEW, PAID');
assert.equal(rich.fields[4].items, 'record'); assert.equal(rich.fields[4].children!.length, 2); assert.equal(rich.fields[4].typeName, 'Line');
const back = JSON.parse(avroToText(rich));
assert.deepEqual(back.fields[2].type, ['null', 'string']); assert.equal(back.fields[2].default, null);
assert.equal(back.fields[4].type.items.name, 'Line');
assert.equal(back.fields[5].type.values, 'string');
// the canvas renderer agrees with what the editor writes
assert.deepEqual(topicFields({ name: 't', partitions: 1, schema: avroToText(rich) }).map(x => x[1]), ['uuid', 'timestamp-millis', 'string?', 'enum(2)', 'array<Line>', 'map<string>']);

assert.equal(parseAvro('{"type":"string"}'), null, 'non-record stays raw');
assert.equal(parseAvro(JSON.stringify({ type: 'record', name: 'X', fields: [{ name: 'u', type: ['string', 'long'] }] })), null, 'wide unions stay raw');
assert.deepEqual(parseAvro(''), { name: '', namespace: '', fields: [] });

console.log('fields tests passed');
