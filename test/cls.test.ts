import assert from 'node:assert/strict';
import { parseCls, parseClsAny, printCls, parseJavaKotlin, parseMermaidCls, fromTables, fromAvro, layoutCls, boxSize, mergeCls, renameClass, parseMember, typeRefs, blankCls, type ClassDoc } from '../src/cls';
import { exampleDoc } from '../src/model';

const noIds = (d: ClassDoc) => ({ classes: d.classes, relations: d.relations.map(({ id: _i, ...r }) => r) });

// ---- the text format round-trips ----
const text = `class PaymentUpload <<aggregate root>> {
  - id: UUID
  - status: UploadStatus
  + submit(): void
  + {static} of(merchantId: String): PaymentUpload
}
enum UploadStatus { RECEIVED, PROCESSING, DONE }
interface CardRef { + id(): String }
record Money { amountMinor: long; currency: Currency }
abstract class Card
class UploadItem {
  - amount: Money
  - card: CardRef
}

PaymentUpload "1" *-- "1..*" UploadItem : items
UploadItem --> CardRef : card
VirtualCard ..|> CardRef
Card <|-- VirtualCard
Service ..> Clock
`;
const p = parseCls(text);
assert.deepEqual(p.errors, []);
assert.deepEqual(p.doc.classes.map(c => `${c.kind}:${c.name}`), ['class:PaymentUpload', 'enum:UploadStatus', 'interface:CardRef', 'record:Money', 'abstract:Card', 'class:UploadItem', 'class:VirtualCard', 'class:Service', 'class:Clock']);
const pu = p.doc.classes[0];
assert.equal(pu.stereo, 'aggregate root');
assert.deepEqual(pu.methods[1], { vis: '+', name: 'of', params: 'merchantId: String', type: 'PaymentUpload', static: true });
assert.deepEqual(p.doc.classes[1].fields.map(f => f.name), ['RECEIVED', 'PROCESSING', 'DONE']);
assert.deepEqual(p.doc.classes[3].fields.map(f => `${f.name}:${f.type}`), ['amountMinor:long', 'currency:Currency']);
assert.deepEqual(noIds(p.doc).relations, [
  { from: 'PaymentUpload', to: 'UploadItem', type: 'composition', label: 'items', fromMult: '1', toMult: '1..*' },
  { from: 'UploadItem', to: 'CardRef', type: 'assoc', label: 'card' },
  { from: 'VirtualCard', to: 'CardRef', type: 'implement' },
  { from: 'VirtualCard', to: 'Card', type: 'inherit' },
  { from: 'Service', to: 'Clock', type: 'depend' },
]);
const printed = printCls(p.doc);
assert.deepEqual(noIds(parseCls(printed).doc), noIds(p.doc), 'print → parse is the same diagram');
assert.equal(printCls(parseCls(printed).doc), printed, 'stable');

// ---- problems carry their line ----
const bad = parseCls('class A {\n  - ok: int\n  ??? nope\n}\nA ~~ B\nclass Open {');
assert.deepEqual(bad.errors.map(e => e.line), [2, 4, 5], JSON.stringify(bad.errors));

// ---- members ----
assert.deepEqual(parseMember('- fee: Money'), { vis: '-', name: 'fee', type: 'Money' });
assert.deepEqual(parseMember('+ retry(n: int): void'), { vis: '+', name: 'retry', params: 'n: int', type: 'void' });
assert.equal(parseMember('1bad'), null);
assert.deepEqual(typeRefs('List<UploadItem>'), [{ name: 'UploadItem', many: true }]);
assert.deepEqual(typeRefs('Money?'), [{ name: 'Money', many: false }]);

// ---- Java ----
const java = `package com.teya.upload;
import java.util.*;
/** An upload. */
@Entity
public class PaymentUpload extends AggregateRoot implements Auditable {
  private final UUID id;
  private UploadStatus status = UploadStatus.RECEIVED;
  private List<UploadItem> items = new ArrayList<>();
  protected static int MAX = 100;
  public PaymentUpload(UUID id) { this.id = id; }
  public void submit() { if (items.isEmpty()) { throw new IllegalStateException("empty"); } status = UploadStatus.PROCESSING; }
  public Optional<UploadItem> item(UUID itemId, @NotNull String reason) { return items.stream().findFirst(); }
}
public enum UploadStatus { RECEIVED, PROCESSING("p"), DONE; UploadStatus() {} UploadStatus(String s) {} }
public record Money(long amountMinor, Currency currency) { public Money { } }
public interface Auditable { Instant createdAt(); }
abstract class AggregateRoot { protected long version; }
class UploadItem { private Money amount; }`;
const j = parseClsAny(java);
assert.equal(j.from, 'code');
const byName = (d: ClassDoc, n: string) => d.classes.find(c => c.name === n)!;
assert.deepEqual(j.doc.classes.map(c => `${c.kind}:${c.name}`), ['class:PaymentUpload', 'enum:UploadStatus', 'record:Money', 'interface:Auditable', 'abstract:AggregateRoot', 'class:UploadItem']);
assert.deepEqual(byName(j.doc, 'PaymentUpload').fields.map(f => `${f.vis}${f.name}:${f.type}${f.static ? ' static' : ''}`), ['-id:UUID', '-status:UploadStatus', '-items:List<UploadItem>', '#MAX:int static']);
assert.deepEqual(byName(j.doc, 'PaymentUpload').methods.map(m => `${m.vis}${m.name}(${m.params}):${m.type}`), ['+submit():void', '+item(itemId: UUID, reason: String):Optional<UploadItem>']);
assert.deepEqual(byName(j.doc, 'UploadStatus').fields.map(f => f.name), ['RECEIVED', 'PROCESSING', 'DONE']);
assert.deepEqual(byName(j.doc, 'Money').fields.map(f => `${f.name}:${f.type}`), ['amountMinor:long', 'currency:Currency']);
assert.deepEqual(byName(j.doc, 'Auditable').methods.map(m => `${m.vis}${m.name}:${m.type}`), ['+createdAt:Instant']);
const rels = noIds(j.doc).relations.map(r => `${r.from} ${r.type} ${r.to}${r.label ? ' ' + r.label : ''}${r.toMult ? ' ' + r.toMult : ''}`);
assert.deepEqual(rels.sort(), ['PaymentUpload assoc UploadItem items *', 'PaymentUpload assoc UploadStatus status', 'PaymentUpload implement Auditable', 'PaymentUpload inherit AggregateRoot', 'UploadItem assoc Money amount'].sort());

// ---- Kotlin ----
const kt = `package x
data class UploadItem(val id: UUID, val amount: Money, private var attempts: Int = 0) : Retryable {
  fun authorise(card: CardRef): AuthResult = TODO()
  private val log = 1
}
sealed class AuthResult
interface Retryable { fun retry(times: Int) }
enum class Currency { GBP, EUR }
class Money(val amountMinor: Long, val currency: Currency)`;
const k = parseClsAny(kt);
assert.equal(k.from, 'code');
assert.deepEqual(k.doc.classes.map(c => `${c.kind}:${c.name}`), ['class:UploadItem', 'abstract:AuthResult', 'interface:Retryable', 'enum:Currency', 'class:Money']);
const ui = byName(k.doc, 'UploadItem');
assert.equal(ui.stereo, 'data');
assert.deepEqual(ui.fields.map(f => `${f.vis}${f.name}:${f.type}`).slice(0, 3), ['+id:UUID', '+amount:Money', '-attempts:Int']);
assert.deepEqual(ui.methods.map(m => `${m.name}(${m.params}):${m.type}`), ['authorise(card: CardRef):AuthResult']);
assert.deepEqual(byName(k.doc, 'Currency').fields.map(f => f.name), ['GBP', 'EUR']);
assert.ok(noIds(k.doc).relations.some(r => r.from === 'UploadItem' && r.to === 'Retryable' && r.type === 'implement'), JSON.stringify(k.doc.relations));
assert.ok(noIds(k.doc).relations.some(r => r.from === 'Money' && r.to === 'Currency' && r.type === 'assoc'));

// ---- Mermaid ----
const mer = parseClsAny(`classDiagram
  class Animal {
    <<abstract>>
    +String name
    +int age
    +makeSound()* void
  }
  class Duck
  Animal <|-- Duck
  Animal "1" --> "*" Food : eats
  Duck : +swim()
  <<interface>> Food`);
assert.equal(mer.from, 'mermaid'); assert.deepEqual(mer.errors, []);
assert.equal(byName(mer.doc, 'Animal').kind, 'abstract');
assert.deepEqual(byName(mer.doc, 'Animal').fields.map(f => `${f.name}:${f.type}`), ['name:String', 'age:int']);
assert.deepEqual(byName(mer.doc, 'Animal').methods.map(m => `${m.name}:${m.type}:${!!m.abstract}`), ['makeSound:void:true']);
assert.equal(byName(mer.doc, 'Food').kind, 'interface');
assert.deepEqual(noIds(mer.doc).relations, [{ from: 'Duck', to: 'Animal', type: 'inherit' }, { from: 'Animal', to: 'Food', type: 'assoc', label: 'eats', fromMult: '1', toMult: '*' }]);

// ---- from tables / Avro (the example's payments-db and Kafka topic) ----
const ex = exampleDoc();
const db = ex.nodes.find(n => n.kind === 'db')!;
const t = fromTables(db.tables!, db.name);
assert.deepEqual(t.classes.map(c => c.name), ['Payments', 'Refunds']);
assert.ok(t.classes[0].fields.some(f => f.name === 'merchantId' && f.type === 'UUID'));
assert.deepEqual(noIds(t).relations.map(r => `${r.from}->${r.to}:${r.label}`), ['Refunds->Payments:paymentId']);
const topic = ex.nodes.find(n => n.kind === 'queue')!;
const av = fromAvro(topic.schema as string);
assert.ok(av.classes.length >= 1 && av.classes[0].kind === 'record', JSON.stringify(av.classes));
const nested = fromAvro(JSON.stringify({ type: 'record', name: 'Upload', fields: [{ name: 'items', type: { type: 'array', items: { type: 'record', name: 'Item', fields: [{ name: 'at', type: { type: 'long', logicalType: 'timestamp-millis' } }, { name: 'kind', type: { type: 'enum', name: 'Kind', symbols: ['A', 'B'] } }] } } }, { name: 'note', type: ['null', 'string'] }] }));
assert.deepEqual(nested.classes.map(c => `${c.kind}:${c.name}`), ['record:Upload', 'record:Item', 'enum:Kind']);
assert.deepEqual(byName(nested, 'Upload').fields.map(f => `${f.name}:${f.type}`), ['items:List<Item>', 'note:String?']);
assert.equal(byName(nested, 'Item').fields[0].type, 'Instant');
assert.deepEqual(noIds(nested).relations.map(r => `${r.from} ${r.type} ${r.to} ${r.toMult ?? ''}`.trim()), ['Item assoc Kind', 'Upload composition Item *']);

// ---- layout: supertypes above subtypes, no overlaps ----
const L = layoutCls(p.doc);
assert.ok(L.Card.y < L.VirtualCard.y && L.CardRef.y < L.VirtualCard.y, 'parents above');
assert.ok(L.PaymentUpload.y < L.UploadItem.y, 'owner above owned');
const boxes = p.doc.classes.map(c => ({ ...L[c.name], ...boxSize(c) }));
for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
  const A = boxes[a], B = boxes[b];
  assert.ok(A.x + A.w <= B.x || B.x + B.w <= A.x || A.y + A.h <= B.y || B.y + B.h <= A.y, `overlap ${p.doc.classes[a].name} ${p.doc.classes[b].name}`);
}

// ---- merge and rename ----
const m = blankCls(); mergeCls(m, p.doc); m.pos = layoutCls(m);
const before = m.relations.length;
const r = mergeCls(m, parseCls('class Money { amountMinor: long; currency: Currency; scale: int }\nUploadItem --> CardRef : card').doc);
assert.deepEqual(r, { added: [], updated: ['Money'] });
assert.equal(m.relations.length, before, 'duplicate relation not added');
renameClass(m, 'Money', 'Amount');
assert.ok(m.pos.Amount && !m.pos.Money);
assert.equal(byName(m, 'UploadItem').fields[0].type, 'Amount');

console.log('cls tests passed');

// ---- class files validate against the schema ----
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { clsToFile, readAny } from '../src/document';
{
  const schema = JSON.parse(readFileSync(new URL('../schema/cistem.schema.json', import.meta.url), 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false }); addFormats(ajv);
  const validate = ajv.compile(schema);
  const f = clsToFile(m, { title: 'model' });
  assert.ok(validate(f), JSON.stringify(validate.errors, null, 1));
  const back = readAny(JSON.parse(JSON.stringify(f)));
  assert.equal(back.kind, 'class');
  assert.ok(!validate({ ...f, model: { participants: [], rows: [] } }), 'a class model needs classes and relations');
  console.log('cls schema ok');
}
