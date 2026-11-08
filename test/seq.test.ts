import assert from 'node:assert/strict';
import { parseSeq, printSeq, layoutSeq, activations, timing, sequenceFromPath, balanced, keepIds, slugId, type SeqDoc } from '../src/domain/seq';
import { exampleDoc } from '../src/domain/model';
import { compute } from '../src/domain/engine';

const strip = (d: SeqDoc) => JSON.parse(JSON.stringify(d, (k, v) => (k === 'id' && typeof v === 'string' && /^r/.test(v) ? undefined : v)));

// ---- the text format round-trips ----
const text = `participant merchants, proxy
participant ecom "ecom-transaction-payments" service @n3
participant items queue

merchants -> proxy: POST /uploads
alt merchant still on legacy
  proxy -> legacy: forward upload
  legacy --> proxy: 202 Accepted
else
  proxy -> ecom: POST /payments/batch
end
ecom ->> items: publish item × n
loop for each item
  items ->> ecom: consume item
  note over ecom, items: idempotent by itemId
end
`;
const p = parseSeq(text);
assert.equal(p.from, 'cistem');
assert.deepEqual(p.errors, []);
assert.deepEqual(p.doc.participants.map(x => x.id), ['merchants', 'proxy', 'ecom', 'items', 'legacy'], 'declared first, then as used');
assert.deepEqual(p.doc.participants[2], { id: 'ecom', name: 'ecom-transaction-payments', type: 'service', ref: 'n3' });
assert.equal(p.doc.rows.filter(r => r.t === 'msg').length, 6);
assert.ok(balanced(p.doc.rows));
const printed = printSeq(p.doc);
assert.deepEqual(strip(parseSeq(printed).doc), strip(p.doc), 'print → parse is the same diagram');
assert.equal(printSeq(parseSeq(printed).doc), printed, 'printing is stable');
assert.ok(printed.includes('participant merchants, proxy\n'), printed);
assert.ok(printed.includes('  proxy -> legacy: forward upload'), 'indented inside blocks');

// ---- problems are reported with their line ----
const bad = parseSeq('a -> b: ok\nelse\nloop forever\na -> b\nwat is this');
assert.deepEqual(bad.errors.map(e => e.line), [1, 2, 4], JSON.stringify(bad.errors));
assert.ok(balanced(bad.doc.rows), 'an unclosed block is closed so the drawing still works');

// ---- Mermaid ----
const mer = parseSeq(`sequenceDiagram
  autonumber
  actor U as Merchant
  participant P as payment-upload-proxy
  U->>+P: POST /uploads
  P-->>-U: 202
  P-)Q: publish
  rect rgb(200,200,200)
  Note right of P: buffered
  end
  par first
    P->>A: x
  and second
    P->>B: y
  end`);
assert.deepEqual(mer.errors, []);
assert.equal(mer.from, 'mermaid');
assert.deepEqual(mer.doc.participants.map(x => [x.id, x.name, x.type]), [['U', 'Merchant', 'actor'], ['P', 'payment-upload-proxy', undefined], ['Q', 'Q', undefined], ['A', 'A', undefined], ['B', 'B', undefined]]);
assert.deepEqual(mer.doc.rows.filter(r => r.t === 'msg').map(r => r.t === 'msg' && r.style), ['sync', 'reply', 'async', 'sync', 'sync']);
assert.ok(printSeq(mer.doc).includes('and second'), 'par branches print as "and"');

// ---- PlantUML ----
const pu = parseSeq(`@startuml
actor "Merchant" as M
participant Proxy
database "payments-db" as DB
M -> Proxy : upload
Proxy -[#red]> DB : insert
DB --> Proxy
Proxy <-- DB : late
group retry
  Proxy ->> M : notify
end
note over Proxy
  two lines
  of note
end note
@enduml`);
assert.deepEqual(pu.errors, []);
assert.deepEqual(pu.doc.participants.map(x => [x.id, x.name, x.type]), [['M', 'Merchant', 'actor'], ['Proxy', 'Proxy', undefined], ['DB', 'payments-db', 'db']]);
const pm = pu.doc.rows.filter(r => r.t === 'msg') as Extract<SeqDoc['rows'][number], { t: 'msg' }>[];
assert.deepEqual(pm.map(r => `${r.from}${r.style === 'reply' ? '-->' : r.style === 'async' ? '->>' : '->'}${r.to}`), ['M->Proxy', 'Proxy->DB', 'DB-->Proxy', 'DB-->Proxy', 'Proxy->>M']);
assert.equal((pu.doc.rows.find(r => r.t === 'note') as any).text, 'two lines of note');

// ---- layout: lifelines spread to fit labels, blocks wrap what they contain, activations pair calls and replies ----
const g = layoutSeq(p.doc);
assert.equal(g.cols.length, 5);
for (let i = 1; i < g.cols.length; i++) assert.ok(g.cols[i].x > g.cols[i - 1].x);
const alt = g.blocks.find(b => b.kind === 'alt')!;
assert.equal(alt.elses.length, 1);
assert.ok(alt.x1 < g.colX.proxy && alt.x2 > g.colX.legacy, 'alt covers proxy..legacy');
const loop = g.blocks.find(b => b.kind === 'loop')!;
assert.ok(loop.y1 > alt.y2, 'loop is below alt');
const acts = activations(p.doc, g.rows);
const legacyAct = acts.find(a => a.pid === 'legacy')!;
const reply = g.rows[p.doc.rows.findIndex(r => r.t === 'msg' && r.from === 'legacy')];
assert.equal(legacyAct.y2, reply.ay, 'the reply ends the activation');

// ---- timing and "made from a request path" against the example system ----
const sys = exampleDoc(); const res = compute(sys);
const fromPath = sequenceFromPath(sys, sys.nodes.find(n => n.kind === 'entry')!.id, new Set(['queue', 'sqs']), { title: 'Checkout example' });
assert.ok(fromPath.participants.length >= 4, 'follows the edges');
assert.ok(fromPath.participants.every(x => x.ref && sys.nodes.some(n => n.id === x.ref)), 'every lifeline is linked');
assert.ok(balanced(fromPath.rows));
const msgs = fromPath.rows.filter(r => r.t === 'msg') as any[];
assert.ok(msgs.some(m => m.style === 'async' && m.label.startsWith('publish')), 'queue hand-off is async');
assert.ok(msgs.some(m => m.style === 'reply'), 'calls are answered');
assert.ok(msgs.some(m => /^(GET|POST|PUT|DELETE|PATCH) \//.test(m.label)), 'labelled with endpoints');
const tm = timing(fromPath, sys, res);
assert.ok(tm.total > 0 && tm.linked === fromPath.participants.length, JSON.stringify(tm));

// ---- ids survive text edits; slugs are unique ----
const a = parseSeq('a -> b: one\nb --> a: two').doc;
const b2 = keepIds(a, parseSeq('a -> b: one!\nb --> a: two').doc);
assert.deepEqual(b2.rows.map(r => r.id), a.rows.map(r => r.id));
assert.equal(slugId('Payment Upload', ['payment-upload']), 'payment-upload2');
assert.equal(slugId('3ds', []), 'p3ds');

console.log('seq tests passed');

// ---- sequence files validate against the schema; a system-looking model doesn't pass as a sequence ----
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { seqToFile, readAny } from '../src/domain/document';
{
  const schema = JSON.parse(readFileSync(new URL('../schema/cistem.schema.json', import.meta.url), 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false }); addFormats(ajv);
  const validate = ajv.compile(schema);
  const f = seqToFile(fromPath, { title: 'flow' });
  assert.ok(validate(f), JSON.stringify(validate.errors, null, 1));
  const back = readAny(JSON.parse(JSON.stringify(f)));
  assert.equal(back.kind, 'sequence');
  assert.ok(!validate({ ...f, model: { nodes: [], edges: [] } }), 'a sequence needs participants and rows');
  console.log('seq schema ok');
}

// ---- hostile sequence files are made safe; labels keep # and // ----
import { sanitizeSeq } from '../src/domain/seq';
{
  const s = sanitizeSeq({ participants: [{ id: 'a' }, { id: '"><img>', name: 'x' }, null, { id: 'a' }], rows: [{ t: 'msg', id: '"><b>', from: 'a', to: '"><img>', style: '"><img onerror=1>', label: 7 }, { t: 'open', kind: '<svg>' }, { t: 'else' }, { t: 'msg', from: 'a', to: 'ghost' }, { t: 'note', over: ['ghost'] }] });
  assert.ok(s.participants.every(p => /^[A-Za-z_$][\w.$-]*$/.test(p.id)));
  assert.equal(new Set(s.participants.map(p => p.id)).size, s.participants.length, 'unique ids');
  const msg = s.rows.find(r => r.t === 'msg') as any;
  assert.equal(msg.style, 'sync'); assert.equal(msg.label, '7'); assert.ok(/^[\w.$-]+$/.test(msg.id));
  assert.ok(balanced(s.rows)); assert.ok(!s.rows.some(r => r.t === 'else'), 'stray else dropped (opt has no branches)');
  assert.equal((s.rows.find(r => r.t === 'open') as any).kind, 'opt');
  assert.equal(s.rows.filter(r => r.t === 'msg').length, 1, 'message to a missing lifeline dropped');
  const p2 = parseSeq('a -> b: Order #42 // see https://x.io\n# comment\n// comment');
  assert.deepEqual(p2.errors, []);
  assert.equal((p2.doc.rows[0] as any).label, 'Order #42 // see https://x.io');
  console.log('seq hostile ok');
}
