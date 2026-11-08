import assert from 'node:assert/strict';
import { toProjectFile, readProjectFile, isProjectFile, inDependencyOrder, relink } from '../src/domain/project';
import { toFile, seqToFile, readAny } from '../src/domain/document';
import { exampleDoc } from '../src/domain/model';
import { blankSeq } from '../src/domain/seq';

const sys = toFile(exampleDoc(), { title: 'Checkout' });
const seq = seqToFile({ ...blankSeq(), uses: { id: 'old-sys', title: 'Checkout' } }, { title: 'Pay' });
const localSeq = seqToFile({ ...blankSeq(), uses: { tab: 'l123' } }, { title: 'Local' });

// ---- a project file round-trips and is recognised ----
const pf = toProjectFile('Payment upload', [{ id: 'old-seq', file: seq }, { id: 'old-sys', file: sys }]);
assert.ok(isProjectFile(JSON.parse(JSON.stringify(pf))));
assert.ok(!isProjectFile(sys), 'a diagram file is not a project file');
const read = readProjectFile(JSON.parse(JSON.stringify(pf)));
assert.equal(read.title, 'Payment upload');
assert.deepEqual(read.diagrams.map(d => d.kind), ['sequence', 'system']);

// ---- bad input says why ----
assert.throws(() => readProjectFile({ format: 'cistem-project', version: 99, diagrams: [] }), /newer/);
assert.throws(() => readProjectFile({ format: 'cistem-project', version: 1 }), /Malformed/);
assert.throws(() => readProjectFile({ format: 'cistem-project', version: 1, diagrams: [{ id: 'x', file: { kind: 'class', model: {} } }] }), /Diagram 1/);
assert.equal(readProjectFile({ format: 'cistem-project', version: 1, title: '   ', diagrams: [] }).title, 'Imported project');

// ---- sequences come after what they draw on ----
assert.deepEqual(inDependencyOrder(read.diagrams).map(d => d.kind), ['system', 'sequence']);

// ---- links are pointed at the new copies; links outside the project stay ----
const moved = relink(seq, old => (old === 'old-sys' ? { id: 'new-sys' } : undefined)) as typeof seq;
assert.deepEqual(moved.model.uses, { id: 'new-sys', title: 'Checkout' });
assert.equal(seq.model.uses?.id, 'old-sys', 'the original is untouched');
assert.equal(relink(seq, () => undefined), seq, 'unknown target: unchanged');
const toTab = relink(localSeq, old => (old === 'l123' ? { tab: 'l999' } : undefined)) as typeof localSeq;
assert.deepEqual(toTab.model.uses, { tab: 'l999' });
assert.equal(relink(sys, () => ({ id: 'x' })), sys, 'only sequences carry links');
assert.equal(readAny(moved).kind, 'sequence', 'still a readable sequence');

console.log('project: ok');
