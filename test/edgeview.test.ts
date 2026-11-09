import assert from 'node:assert/strict';
import { wrap, labelBox, strokeOf } from '../src/diagrams/system/EdgeView';

assert.deepEqual(wrap('one two three', 40), ['one two three']);
const long = wrap('a '.repeat(200), 10, 3);
assert.equal(long.length, 3); assert.ok(long[2].endsWith('…'), 'cut lines end in an ellipsis');
assert.ok(wrap('x'.repeat(80), 20)[0].length <= 20, 'a very long word is cut');
const box = labelBox({ label: 'route payments', endpoint: 'POST /v1/payments', notes: ['a', 'b'] });
assert.ok(box.chipH > 0 && box.notesH > 0 && box.h > box.chipH);
assert.equal(strokeOf({}, false).dash, 'none'); assert.notEqual(strokeOf({}, true).dash, 'none', 'crossing is dashed by default');
assert.equal(strokeOf({ line: 'solid' }, true).dash, 'none', 'unless solid is picked');
assert.ok(strokeOf({ line: 'dotted', width: 'thick' }, false).dotted);
console.log('edge view helpers');

import { labelRows } from '../src/diagrams/system/EdgeView';
assert.deepEqual(labelRows('fraud check\nPOST /score'), ['fraud check', 'POST /score'], 'typed newlines');
assert.deepEqual(labelRows('a\n\nb'), ['a', 'b'], 'blank lines skipped');
assert.ok(labelRows('word '.repeat(30)).length > 1, 'a long line wraps');
assert.ok(labelRows(Array(10).fill('x').join('\n')).length === 6, 'at most 6 lines');
console.log('multi-line labels');
