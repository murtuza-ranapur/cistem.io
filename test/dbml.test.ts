import assert from 'node:assert/strict';
import { toDbml, parseDbml, parseSql, quickColumn } from '../src/dbml';
import { exampleDoc, type DbNode } from '../src/model';

const r = { nameToId: (n: string) => n === 'ledger-db' ? 'n9' : null, idToName: (id: string) => id === 'n9' ? 'ledger-db' : null };

// round trip of the example's tables
const db = exampleDoc().nodes.find(n => n.kind === 'db') as DbNode;
const text = toDbml(db.tables, r);
assert.ok(text.startsWith('Table payments {'), text);
const back = parseDbml(text, r);
assert.deepEqual(back.errors, []);
const norm = (ts: any[]) => JSON.parse(JSON.stringify(ts, (k, v) => (v === false || v === null || v === undefined) && ['unique', 'index', 'references'].includes(k) ? undefined : v));
assert.deepEqual(norm(back.tables), norm(db.tables), 'round trip');
assert.equal(toDbml(back.tables, r), text, 'stable');

// the sketching syntax
{
  const p = parseDbml(`Table orders {
  id uuid [pk, default: \`gen_random_uuid()\`]
  merchant_id uuid [index, ref: > merchants.id]
  status text [default: 'new']
  note text?
  ledger uuid [ref: > ledger-db.entries.id]
}
Table merchants {
  id uuid [pk]
}`, r);
  assert.deepEqual(p.errors, []);
  const [o] = p.tables;
  assert.deepEqual(o.columns.map(c => [c.name, c.type, c.pk, c.nullable]), [['id', 'uuid', true, false], ['merchant_id', 'uuid', false, false], ['status', 'text', false, false], ['note', 'text', false, true], ['ledger', 'uuid', false, false]]);
  assert.equal(o.columns[0].default, 'gen_random_uuid()');
  assert.equal(o.columns[1].references, 'merchants.id'); assert.equal(o.columns[1].index, true);
  assert.equal(o.columns[2].default, "'new'");
  assert.equal(o.columns[4].references, 'n9:entries.id', 'cross-database ref stored by node id');
  assert.ok(toDbml(p.tables, r).includes('ref: > ledger-db.entries.id'), 'and written back by name');
}
// real DBML: nullable unless "not null"
{
  const p = parseDbml('Table users {\n  id integer [primary key]\n  email varchar [not null, unique]\n  bio text\n}');
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.tables[0].columns.map(c => c.nullable), [false, false, true]);
}
// errors point at lines
{
  const p = parseDbml('Table a {\n  id uuid [pk]\n  broken\n  x int [wat]\n  y int [ref: > nope.id]\n');
  const lines = p.errors.map(e => e.line + ':' + e.message);
  assert.ok(lines.some(l => l.startsWith('2:') && l.includes('needs a type')), lines.join(' | '));
  assert.ok(lines.some(l => l.startsWith('3:') && l.includes('Unknown flag "wat"')), lines.join(' | '));
  assert.ok(lines.some(l => l.includes('missing its closing }')), lines.join(' | '));
  assert.ok(lines.some(l => l.startsWith('4:') && l.includes('no table "nope"')), lines.join(' | '));
}
// SQL
{
  const p = parseSql(`CREATE TABLE public.payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id),
    amount_minor bigint NOT NULL,
    currency character varying(3) NOT NULL,
    note text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT payments_key UNIQUE (merchant_id, amount_minor)
  );
  CREATE TABLE "refunds" ("id" bigserial, "payment_id" uuid NOT NULL, PRIMARY KEY ("id"), FOREIGN KEY ("payment_id") REFERENCES payments (id));
  CREATE INDEX payments_merchant ON payments (merchant_id);`);
  assert.deepEqual(p.errors, []);
  const [pay, ref] = p.tables;
  assert.equal(pay.name, 'payments');
  assert.deepEqual(pay.columns.map(c => c.type), ['uuid', 'uuid', 'bigint', 'varchar(3)', 'text', 'timestamptz']);
  assert.equal(pay.columns[0].pk, true); assert.equal(pay.columns[0].default, 'gen_random_uuid()');
  assert.equal(pay.columns[1].references, 'merchants.id'); assert.equal(pay.columns[1].index, true);
  assert.equal(pay.columns[4].nullable, true); assert.equal(pay.columns[5].default, 'now()');
  assert.equal(ref.columns[0].pk, true); assert.equal(ref.columns[1].references, 'payments.id');
  assert.deepEqual(parseDbml('CREATE TABLE t (a int);').tables[0].columns[0].name, 'a', 'parseDbml accepts SQL');
}
// the one-line adder
assert.deepEqual(quickColumn('refunded_at timestamptz?').col, { name: 'refunded_at', type: 'timestamptz', pk: false, nullable: true });
assert.equal(quickColumn('code char(3) [unique]').col!.unique, true);
assert.ok(quickColumn('justaname').error!.includes('needs a type'));
console.log('dbml tests passed');
