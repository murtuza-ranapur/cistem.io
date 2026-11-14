import assert from 'node:assert/strict';
import { searchItems, matchedAlias, type PaletteSection } from '../src/palette/types';
import { mostUsed } from '../src/palette/store';
import { TYPES } from '../src/domain/model';

const it = (key: string, label: string, aliases: string[] = [], about = '') => ({ key, label, aliases, about, icon: null, add() {} });
const S: PaletteSection[] = [{ title: 'Data', items: [it('cache', 'Redis', ['cache', 'memcached']), it('db', 'Postgres', ['sql', 'rds']), it('mongodb', 'MongoDB', ['nosql'])] },
  { title: 'Traffic', items: [it('lb', 'Load balancer', ['nginx']), it('apigw', 'API gateway', ['gateway'], 'Rate limits at the edge')] }];
const keys = (q: string) => searchItems(S, q).map(x => x.key);

assert.deepEqual(keys('post'), ['db'], 'name');
assert.deepEqual(keys('bal'), ['lb'], 'a word in the name');
assert.deepEqual(keys('sql'), ['db', 'mongodb'], 'aliases: starts-with before contains');
assert.deepEqual(keys('rate'), ['apigw'], 'about, last');
assert.deepEqual(keys('  '), []);
assert.equal(matchedAlias(S[0].items[1], 'rds'), 'rds');
assert.equal(matchedAlias(S[0].items[1], 'pos'), null, 'matched by name: nothing to explain');
assert.deepEqual(mostUsed(S[0].items, { mongodb: 3, db: 1 }, 2).map(x => x.key), ['mongodb', 'db']);
assert.deepEqual(mostUsed(S[0].items, {}, 2).map(x => x.key), ['cache', 'db'], 'nothing used yet: the first ones');
// every type is findable by something other than its name, and says what it is
for (const [k, t] of Object.entries(TYPES)) assert.ok(t.aliases?.length && t.about, k + ' has aliases and an about');
assert.equal(TYPES.flink.behaviour, 'scaled');
console.log('palette ok');
