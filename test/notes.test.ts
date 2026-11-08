import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { sanitizeNotes, taskProgress, notePreview, cleanNoteText, NOTE_MAX_CHARS, type CanvasNote } from '../src/domain/notes';
import { toFile, seqToFile, clsToFile, readAny } from '../src/domain/document';
import { exampleDoc } from '../src/domain/model';
import { blankSeq } from '../src/domain/seq';
import { blankCls } from '../src/domain/cls';

const schema = JSON.parse(readFileSync(new URL('../schema/cistem.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false }); addFormats(ajv);
const validate = ajv.compile(schema);

const notes: CanvasNote[] = [
  { id: 'note1', x: 10, y: 20, w: 300, color: 'yellow', text: '## Launch\n- [x] load test\n- [ ] ==sign-off==' },
  { id: 'note2', x: -40, y: 400, w: 240, h: 180, color: 'blue', text: 'Plain' },
];

// ---- canvas notes and item notes round-trip through every kind of file, and the files validate ----
{
  const sys = exampleDoc();
  sys.notes = notes;
  sys.nodes[0].notes = '**owner**: payments';
  sys.edges[0].notes = 'calls are idempotent';
  const f = toFile(sys, { title: 'With notes' });
  assert.ok(validate(f), JSON.stringify(validate.errors, null, 1));
  assert.deepEqual(f.layout.notes?.note1, { x: 10, y: 20, w: 300 }, 'geometry is layout');
  assert.equal((f.model.notes![0] as any).x, undefined, 'the model holds content only');
  const back = readAny(JSON.parse(JSON.stringify(f)));
  assert.equal(back.kind, 'system');
  if (back.kind === 'system') {
    assert.deepEqual(back.doc.notes, notes);
    assert.equal(back.doc.nodes[0].notes, '**owner**: payments');
    assert.equal(back.doc.edges[0].notes, 'calls are idempotent');
  }
  const plain = toFile(exampleDoc());
  assert.ok(!('notes' in plain.model) && !('notes' in plain.layout), 'no notes, no keys');

  const seq = { ...blankSeq(), participants: [{ id: 'a', name: 'A', notes: 'the client' }], notes };
  const sf = seqToFile(seq);
  assert.ok(validate(sf), JSON.stringify(validate.errors, null, 1));
  const sb = readAny(JSON.parse(JSON.stringify(sf)));
  assert.ok(sb.kind === 'sequence' && sb.seq.notes?.length === 2 && sb.seq.participants[0].notes === 'the client');

  const cls = { ...blankCls(), classes: [{ name: 'Order', kind: 'class' as const, fields: [], methods: [], notes: 'aggregate root' }], notes };
  const cf = clsToFile(cls);
  assert.ok(validate(cf), JSON.stringify(validate.errors, null, 1));
  const cb = readAny(JSON.parse(JSON.stringify(cf)));
  assert.ok(cb.kind === 'class' && cb.cls.notes?.length === 2 && cb.cls.classes[0].notes === 'aggregate root');
  console.log('notes round-trip ok');
}

// ---- hostile notes are made safe ----
{
  const s = sanitizeNotes(
    [{ id: '"><img>', text: 7 }, { id: 'a', color: 'neon', text: 'x\u0000y' }, null, { id: 'a', text: 'dup' }, { text: 'big'.repeat(40000) }],
    { '"><img>': { x: 'NaN', y: 1e99, w: 5 }, a: { x: 1, y: 2, w: 99999, h: -3 } },
  );
  assert.equal(s.length, 4, 'non-objects dropped');
  assert.ok(s.every(n => /^[\w.:-]+$/.test(n.id)), 'ids are safe');
  assert.equal(new Set(s.map(n => n.id)).size, 4, 'ids are unique');
  assert.equal(s[0].text, '', 'non-text dropped');
  assert.equal(s[0].x, 0); assert.equal(s[0].y, 1e6, 'positions clamped'); assert.equal(s[0].w, 160, 'width clamped');
  assert.equal(s[1].color, 'yellow', 'unknown colour → default');
  assert.equal(s[1].text, 'xy', 'control characters removed');
  assert.equal(s[1].w, 1200); assert.equal(s[1].h, undefined, 'a nonsense height means "fit the text"');
  assert.equal(s[3].text.length, NOTE_MAX_CHARS, 'long text is cut');
  assert.equal(cleanNoteText({}), '');
  const sys: any = toFile(exampleDoc());
  sys.model.nodes[0].notes = { evil: true };
  const r = readAny(sys);
  assert.ok(r.kind === 'system' && r.doc.nodes[0].notes === undefined, 'item notes must be text');
  console.log('notes hostile ok');
}

// ---- helpers ----
assert.deepEqual(taskProgress('- [x] a\n- [ ] b\n  * [X] c\ntext [ ] no'), { done: 2, total: 3 });
assert.deepEqual(taskProgress(undefined), { done: 0, total: 0 });
assert.equal(notePreview('## Title\n- [x] **done** ==hi==\n```\ncode\n```\n[link](http://x)'), 'Title done hi link');
assert.equal(notePreview('a'.repeat(300), 10).length, 10);
console.log('notes helpers ok');
