import assert from 'node:assert/strict';
import { contextAt, avroSuggestions, avroProblems, roleOf, namedTypes, problemRange } from '../src/domain/avro';

const at = (src: string) => { const pos = src.indexOf('|'); const text = src.replace('|', ''); return { text, pos, ctx: contextAt(text, pos) }; };
const labels = (src: string) => { const { text, ctx } = at(src); return avroSuggestions(text, ctx).map(s => s.label); };

// --- cursor context ---
{
  const { ctx } = at('{"type": "record", "fields": [{"name": "a", "type": "lo|"}]}');
  assert.equal(ctx.where, 'value'); assert.equal(ctx.key, 'type'); assert.equal(ctx.partial, 'lo'); assert.equal(ctx.inString, true);
  assert.deepEqual(ctx.path, ['fields', 0]); assert.equal(roleOf(ctx), 'field');
}
{
  const { ctx, text } = at('{"type": "record", "fields": [{"na|"}]}');
  assert.equal(ctx.where, 'key'); assert.equal(ctx.partial, 'na');
  assert.equal(text.slice(ctx.from, ctx.to), '"na"', 'replaces the whole half-typed key including the auto-closed quote');
}
{
  const { ctx } = at('{"type": "record", "fields": [{ | }]}');
  assert.equal(ctx.where, 'key'); assert.equal(ctx.inString, false);
}
{ // editing an existing key keeps its colon
  const { ctx } = at('{"type": "record", "na|me": "X", "fields": []}');
  assert.equal(ctx.where, 'key'); assert.equal(ctx.hasColon, true);
  assert.deepEqual(ctx.present.sort(), ['fields', 'type'], 'the key being edited is not counted as present');
}
{ // role from a sibling that comes AFTER the cursor
  const { ctx } = at('{"fields": [{"name": "s", "type": { | "type": "enum", "name": "S" }}]}');
  assert.equal(roleOf(ctx), 'enum');
}
{ // inside a union
  const { ctx } = at('{"type":"record","name":"R","fields":[{"name":"n","type":["null", "|"]}]}');
  assert.equal(ctx.where, 'value'); assert.equal(ctx.inArray, true); assert.deepEqual(ctx.path, ['fields', 0, 'type']);
}

// --- suggestions ---
assert.ok(labels('{"type": "record", "fields": [{"name": "a", "type": "|"}]}').slice(0, 3).includes('string'), 'primitives first for a field type');
assert.ok(!labels('{"type": "record", "fields": [{"name": "a", "type": "|"}]}').includes('null'), 'bare null is not offered as a field type');
assert.ok(labels('{"type":"record","name":"R","fields":[{"name":"n","type":["null", "|"]}]}').includes('string'), 'union members');
{
  const l = labels('{"type": "record", "fields": [{"name": "a", "type": |}]}');
  assert.ok(l.includes('nullable string') && l.includes('uuid') && l.includes('record'), 'snippets outside a string: ' + l);
}
{
  const l = labels('{"type": "record", "fields": [{"name": "a", | }]}');
  assert.equal(l[0], 'type', 'field keys, name already present → type first'); assert.ok(!l.includes('name')); assert.ok(l.includes('default') && l.includes('doc'));
}
{
  const l = labels('{ | }');
  assert.deepEqual(l.slice(0, 3), ['type', 'name', 'namespace'], 'root is a record: ' + l);
}
assert.deepEqual(labels('{"type":"record","name":"R","fields":[{"name":"d","type":{"type":"int","logicalType":"|"}}]}').slice(0, 2), ['uuid', 'date']);
assert.ok(labels('{"type":"record","name":"Order","fields":[{"name":"l","type":{"type":"record","name":"Line","fields":[]}},{"name":"m","type":"|"}]}').includes('Line'), 'named types are offered');
assert.deepEqual(namedTypes('{"type":"record","name":"Order","fields":[{"name":"s","type":{"type":"enum","name":"Status","symbols":["A"]}}]}').sort(), ['Order', 'Status']);
{ // key completion inserts a full property; mid-key edit inserts the key only
  const { text, ctx } = at('{"type": "record", "fields": [{"name": "a", "ty|"}]}');
  const s = avroSuggestions(text, ctx).find(x => x.label === 'type')!; assert.equal(s.apply, '"type": "${}"');
  const m = at('{"type": "record", "na|me": "X"}'); assert.equal(avroSuggestions(m.text, m.ctx).find(x => x.label === 'name')!.apply, '"name"');
}

// --- problems ---
const msgs = (o: unknown) => avroProblems(JSON.stringify(o)).map(p => p.severity + ': ' + p.message);
assert.deepEqual(msgs({ type: 'record', name: 'Ok', fields: [{ name: 'a', type: 'string' }, { name: 'b', type: ['null', 'long'], default: null }] }), [], 'clean schema');
assert.ok(msgs({ type: 'record', name: 'R', fields: [{ name: 'a', type: 'lnog' }] })[0].includes('Unknown type "lnog"'));
assert.ok(msgs({ type: 'record', name: 'R', fields: [{ name: 'a', type: 'strng' }] })[0].includes('did you mean "string"'));
assert.ok(msgs({ type: 'record', name: 'R', fields: [{ name: 'a', type: ['null', 'string'] }] })[0].startsWith('warning: "a" is nullable but has no default'));
assert.ok(msgs({ type: 'record', name: 'R', fields: [{ name: 'a', type: ['string', 'null'], default: null }] })[0].includes('null default needs "null" first'));
assert.ok(msgs({ type: 'record', name: 'R', fields: [{ name: 'a', type: 'string' }, { name: 'a', type: 'long' }] })[0].includes('Duplicate field "a"'));
assert.ok(msgs({ type: 'record', name: 'R', fields: [{ name: 's', type: { type: 'enum', name: 'S', symbols: [] } }] })[0].includes('at least one symbol'));
assert.ok(msgs({ type: 'record', name: 'R', fields: [{ name: 'u', type: { type: 'long', logicalType: 'uuid' } }] })[0].includes('goes on "string"'));
assert.ok(msgs({ type: 'record', fields: [] })[0].includes('needs a "name"'));
assert.deepEqual(msgs({ type: 'record', name: 'O', fields: [{ name: 'l', type: { type: 'record', name: 'L', fields: [{ name: 'x', type: 'int' }] } }, { name: 'm', type: 'L' }] }), [], 'named reference ok');
assert.deepEqual(avroProblems('{ broken'), [], 'JSON errors are left to the JSON linter');
{
  const t = '{\n  "type": "record", "name": "R",\n  "fields": [{ "name": "a", "type": "lnog" }]\n}';
  const [p] = avroProblems(t); const [f, to] = problemRange(t, p); assert.equal(t.slice(f, to), '"name": "a"', 'underline lands on the field');
}

console.log('avro tests passed');
