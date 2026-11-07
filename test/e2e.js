// Browser tests for the editor. Drives the real UI (mouse, keys, buttons) against a built app.
// Run: node test/e2e.js [baseUrl]   (default http://localhost:4173)
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:4173';
const OUT = process.env.E2E_OUT || '/tmp/e2e';
require('fs').mkdirSync(OUT, { recursive: true });

const results = [];
async function test(name, fn) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const t = new T(page);
  try {
    await page.goto(BASE); await page.waitForTimeout(300);
    await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(500);
    await page.click('#resetBtn'); await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await fn(t);
    if (errors.length) throw new Error(errors.join('\n'));
    results.push({ name, ok: true }); process.stdout.write(`  ok   ${name}\n`);
  } catch (e) {
    await page.screenshot({ path: `${OUT}/${name.replace(/[^a-z0-9]+/gi, '_')}.png` }).catch(() => {});
    results.push({ name, ok: false, error: e.message }); process.stdout.write(`  FAIL ${name}\n       ${e.message.split('\n')[0]}\n`);
  } finally { await browser.close(); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'expected equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

class T {
  constructor(page) { this.page = page; }
  doc() { return this.page.evaluate(() => JSON.parse(localStorage.getItem('cistem.doc'))); }
  async node(id) { const d = await this.doc(); const n = d.model.nodes.find(n => n.id === id); if (!n) return null; return { ...n, ...d.layout.positions[id] }; }
  async nodeByName(name) { const d = await this.doc(); const n = d.model.nodes.find(n => n.name === name); return n && { ...n, ...d.layout.positions[n.id] }; }
  async box(sel) { const el = await this.page.$(sel); if (!el) throw new Error('no element ' + sel); return el.boundingBox(); }
  async center(sel) { const b = await this.box(sel); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
  async clickNode(id, mods = []) { const b = await this.box(`[data-node="${id}"] rect.body`); await this.page.mouse.click(b.x + 20, b.y + 50, { modifiers: mods }); await this.page.waitForTimeout(500); /* inspector slide + reveal pan */ }
  async dragNodeTo(id, x, y) {
    const b = await this.box(`[data-node="${id}"] rect.body`);
    const sx = b.x + 20, sy = b.y + 50;
    await this.page.mouse.move(sx, sy); await this.page.mouse.down();
    await this.page.mouse.move(sx + 5, sy + 5); await this.page.mouse.move(x, y, { steps: 12 }); await this.page.waitForTimeout(80);
    await this.page.mouse.up(); await this.page.waitForTimeout(200);
  }
  async frameBox(id) { return this.box(`[data-container="${id}"] rect.fbody`); }
  async sel() { return this.page.evaluate(() => document.querySelector('#sheetBody .head strong')?.textContent ?? null); }
  async emptyCanvasPoint() { const b = await this.box('#svg'); return { x: b.x + 60, y: b.y + b.height - 60 }; }
}

(async () => {
  // ---------- reported bugs ----------
  await test('drag a node out of its environment removes it from the container', async t => {
    const before = await t.node('n2'); assert(before.container, 'ALB starts inside acq-edge');
    const p = await t.emptyCanvasPoint();
    await t.dragNodeTo('n2', p.x, p.y);
    const after = await t.node('n2');
    eq(after.container, null, 'ALB should be outside any container after dragging to empty canvas');
  });

  await test('drag a node into an environment places it there', async t => {
    const target = await t.frameBox('c10'); // acq-core
    const svg = await t.box('#svg'); // keep the drop point on the visible canvas (not under the inspector)
    await t.dragNodeTo('n1', Math.min(target.x + target.width - 150, svg.x + svg.width - 60), target.y + target.height - 60);
    const n = await t.node('n1');
    assert(['c10', 'c8'].includes(n.container), 'clients should now be in an AWS container, got ' + n.container);
  });

  await test('Delete key removes the selected node and its edges', async t => {
    await t.clickNode('n4');
    await t.page.keyboard.press('Delete'); await t.page.waitForTimeout(200);
    const d = await t.doc();
    assert(!d.model.nodes.some(n => n.id === 'n4'), 'cache should be gone');
    assert(!d.model.edges.some(e => e.from === 'n4' || e.to === 'n4'), 'edges touching cache should be gone');
  });

  await test('Backspace removes the selected node', async t => {
    await t.clickNode('n5'); await t.page.keyboard.press('Backspace'); await t.page.waitForTimeout(200);
    assert(!(await t.node('n5')), 'db should be gone');
  });

  await test('inspector trash button removes the node', async t => {
    await t.clickNode('n6');
    await t.page.click('#sheetBody [data-action="delete-node"]'); await t.page.waitForTimeout(200);
    assert(!(await t.node('n6')), 'queue should be gone');
  });

  await test('the client (entry) node can be deleted', async t => {
    await t.clickNode('n1'); await t.page.keyboard.press('Delete'); await t.page.waitForTimeout(200);
    assert(!(await t.node('n1')), 'entry should be gone');
    // and the app keeps working (verdict shows no load)
    const v = await t.page.textContent('#verdict'); assert(v, 'verdict still rendered');
  });

  await test('Delete key removes the selected edge', async t => {
    const hit = await t.page.$('[data-edge="e2"] path.hit'); const b = await hit.boundingBox();
    await t.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await t.page.waitForTimeout(150);
    eq(await t.page.evaluate(() => document.querySelector('#sheetBody .head .k')?.textContent), 'Edge', 'edge selected');
    await t.page.keyboard.press('Delete'); await t.page.waitForTimeout(200);
    const d = await t.doc(); assert(!d.model.edges.some(e => e.id === 'e2'), 'edge e2 should be gone');
  });

  await test('Delete key removes the selected container, members stay', async t => {
    const f = await t.frameBox('c9'); // acq-edge
    await t.page.mouse.click(f.x + f.width - 30, f.y + 12); await t.page.waitForTimeout(150);
    eq(await t.sel(), 'acq-edge', 'container selected');
    await t.page.keyboard.press('Delete'); await t.page.waitForTimeout(200);
    const d = await t.doc();
    assert(!d.model.containers.some(c => c.id === 'c9'), 'container gone');
    const alb = d.model.nodes.find(n => n.id === 'n2'); eq(alb.container, 'c8', 'members move up to the parent (AWS)');
  });

  await test('inspector trash deletes a container', async t => {
    const f = await t.frameBox('c10'); await t.page.mouse.click(f.x + f.width - 30, f.y + 12); await t.page.waitForTimeout(150);
    await t.page.click('#sheetBody [data-action="delete-container"]'); await t.page.waitForTimeout(200);
    const d = await t.doc(); assert(!d.model.containers.some(c => c.id === 'c10'), 'container gone');
  });

  await test('the "in" dropdown moves a node out of all environments', async t => {
    await t.clickNode('n3');
    await t.page.selectOption('#sheetBody select[data-path="container"]', ''); await t.page.waitForTimeout(200);
    eq((await t.node('n3')).container, null, 'api should be unplaced');
  });

  await test('selecting a node under where the inspector opens pans it into view', async t => {
    // ledger-worker is the right-most node; after selecting it, it must not be under the inspector
    await t.clickNode('n7');
    const nb = await t.box('[data-node="n7"] rect.body'), ib = await t.box('#inspector');
    assert(nb.x + nb.width <= ib.x + 1, `node right edge ${nb.x + nb.width} overlaps inspector at ${ib.x}`);
  });

  // ---------- core interactions ----------
  await test('add from rail by click, then undo removes it', async t => {
    const before = (await t.doc()).model.nodes.length;
    await t.page.click('#rail [data-add="cache"]'); await t.page.waitForTimeout(200);
    eq((await t.doc()).model.nodes.length, before + 1, 'one more node');
    await t.page.keyboard.press('Escape');
    await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(200);
    eq((await t.doc()).model.nodes.length, before, 'undo removed it');
    await t.page.keyboard.press('Control+Shift+z'); await t.page.waitForTimeout(200);
    eq((await t.doc()).model.nodes.length, before + 1, 'redo restored it');
  });

  await test('drag from rail drops a node where released', async t => {
    const p = await t.emptyCanvasPoint();
    await t.page.dragAndDrop('#rail [data-add="service"]', '#svg', { targetPosition: { x: 60, y: 800 } }); await t.page.waitForTimeout(200);
    const d = await t.doc(); const added = d.model.nodes[d.model.nodes.length - 1];
    eq(added.kind, 'service', 'service added'); eq(added.container, null, 'unplaced when dropped on empty canvas');
    void p;
  });

  await test('connect by dragging a port onto another node', async t => {
    const edges = (await t.doc()).model.edges.length;
    await t.clickNode('n7');
    const h = await t.box('[data-node="n7"] [data-handle="n"]'); const tgt = await t.box('[data-node="n4"] rect.body');
    await t.page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await t.page.mouse.down();
    await t.page.mouse.move(tgt.x + 40, tgt.y + 40, { steps: 10 }); await t.page.waitForTimeout(80); await t.page.mouse.up(); await t.page.waitForTimeout(200);
    eq((await t.doc()).model.edges.length, edges + 1, 'edge added');
  });

  await test('double-click renames a node', async t => {
    const b = await t.box('[data-node="n3"] rect.body');
    await t.page.mouse.dblclick(b.x + 60, b.y + 30); await t.page.waitForTimeout(150);
    await t.page.keyboard.press('Control+a'); await t.page.keyboard.type('orders-api'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(200);
    eq((await t.node('n3')).name, 'orders-api', 'renamed');
  });

  await test('title edits persist and update the document title', async t => {
    await t.page.fill('#title', 'Renamed system'); await t.page.waitForTimeout(200);
    eq((await t.doc()).meta.title, 'Renamed system', 'meta title');
    eq(await t.page.title(), 'Renamed system · cistem.io', 'document.title');
  });

  await test('editing a property in the inspector updates the model and the verdict', async t => {
    await t.clickNode('n3');
    await t.page.fill('#sheetBody input[data-path="instances"]', '2'); await t.page.waitForTimeout(200);
    eq((await t.node('n3')).instances, 2, 'instances');
    const v = await t.page.textContent('#verdict'); assert(/Breaks/.test(v), 'verdict should break with 2 instances, got ' + v);
  });

  await test('marquee selects multiple nodes and Delete removes them all', async t => {
    const a = await t.box('[data-node="n4"] rect.body'), b = await t.box('[data-node="n6"] rect.body');
    const x0 = Math.min(a.x, b.x) - 20, y0 = Math.min(a.y, b.y) - 20, x1 = Math.max(a.x + a.width, b.x + b.width) + 20, y1 = Math.max(a.y + a.height, b.y + b.height) + 20;
    await t.page.keyboard.down('Shift'); await t.page.mouse.move(x0, y0); await t.page.mouse.down(); await t.page.mouse.move(x1, y1, { steps: 8 }); await t.page.mouse.up(); await t.page.keyboard.up('Shift'); await t.page.waitForTimeout(150);
    await t.page.keyboard.press('Delete'); await t.page.waitForTimeout(200);
    const d = await t.doc(); assert(!d.model.nodes.some(n => n.id === 'n4' || n.id === 'n6'), 'both removed');
  });

  await test('duplicate (Ctrl+D) copies the selected node', async t => {
    const before = (await t.doc()).model.nodes.length;
    await t.clickNode('n3'); await t.page.keyboard.press('Control+d'); await t.page.waitForTimeout(200);
    eq((await t.doc()).model.nodes.length, before + 1, 'duplicated');
  });

  await test('arrow keys nudge the selected node', async t => {
    await t.clickNode('n3'); const before = await t.node('n3');
    await t.page.keyboard.press('ArrowRight'); await t.page.keyboard.press('ArrowDown'); await t.page.waitForTimeout(150);
    const after = await t.node('n3'); eq(after.x, before.x + 8, 'x'); eq(after.y, before.y + 8, 'y');
  });

  await test('auto-organise keeps every node inside its container frame', async t => {
    await t.page.keyboard.press('o'); await t.page.waitForTimeout(700);
    const d = await t.doc();
    for (const n of d.model.nodes) if (n.container) {
      const nb = await t.box(`[data-node="${n.id}"] rect.body`), fb = await t.frameBox(n.container);
      assert(nb.x >= fb.x - 1 && nb.y >= fb.y - 1 && nb.x + nb.width <= fb.x + fb.width + 1 && nb.y + nb.height <= fb.y + fb.height + 1, `${n.name} outside its frame`);
    }
  });

  await test('expand a db node, FK lines appear, collapse again', async t => {
    await t.page.click('[data-node="n5"] [data-toggle]'); await t.page.waitForTimeout(200);
    // example starts with db expanded; after click it is compact
    eq((await t.doc()).layout.detail?.n5, undefined, 'collapsed');
    await t.page.click('[data-node="n5"] [data-toggle]'); await t.page.waitForTimeout(200);
    eq((await t.doc()).layout.detail?.n5, 'expanded', 'expanded');
    eq(await t.page.$$eval('#fks path', p => p.length), 1, 'one FK line');
  });

  await test('expand-all toggles every schema node and back', async t => {
    await t.page.click('#expandAll'); await t.page.waitForTimeout(200);
    const d1 = await t.doc(); assert(d1.layout.detail.n3 === 'expanded' && d1.layout.detail.n6 === 'expanded', 'service and kafka expanded');
    await t.page.click('#expandAll'); await t.page.waitForTimeout(200);
    eq(Object.keys((await t.doc()).layout.detail ?? {}).length, 0, 'all compact');
  });

  await test('adding an environment and deleting it from the inspector', async t => {
    await t.page.click('#rail [data-add-container]'); await t.page.waitForTimeout(200);
    const d = await t.doc(); const c = d.model.containers[d.model.containers.length - 1];
    eq(await t.sel(), c.name, 'new container selected');
    await t.page.click('#sheetBody [data-action="delete-container"]'); await t.page.waitForTimeout(200);
    assert(!(await t.doc()).model.containers.some(x => x.id === c.id), 'container removed');
  });

  await test('clicking empty canvas clears the selection and closes the inspector', async t => {
    await t.clickNode('n3'); assert(!(await t.page.$eval('#inspector', e => e.classList.contains('closed'))), 'inspector open');
    const p = await t.emptyCanvasPoint(); await t.page.mouse.click(p.x, p.y); await t.page.waitForTimeout(250);
    assert(await t.page.$eval('#inspector', e => e.classList.contains('closed')), 'inspector closed');
  });

  await test('JSON export/import round-trips the diagram', async t => {
    await t.page.click('#ioBtn'); await t.page.waitForTimeout(150);
    const text = await t.page.inputValue('#json');
    const parsed = JSON.parse(text); eq(parsed.version, 3, 'v3 file');
    parsed.meta.title = 'Imported'; await t.page.fill('#json', JSON.stringify(parsed));
    await t.page.click('#loadJson'); await t.page.waitForTimeout(300);
    eq((await t.doc()).meta.title, 'Imported', 'imported title');
  });

  await test('reload restores the diagram from the browser', async t => {
    await t.page.fill('#title', 'Persisted'); await t.page.waitForTimeout(200);
    await t.page.reload(); await t.page.waitForTimeout(600);
    eq(await t.page.inputValue('#title'), 'Persisted', 'title after reload');
  });

  await test('undo after a drag restores the position', async t => {
    const before = await t.node('n3'); const p = await t.emptyCanvasPoint();
    await t.dragNodeTo('n3', p.x + 200, p.y - 100);
    assert((await t.node('n3')).x !== before.x, 'moved');
    await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(200);
    eq((await t.node('n3')).x, before.x, 'x restored');
  });

  await test('dragging a frame moves its members with it', async t => {
    const f = await t.frameBox('c9'); const alb = await t.node('n2');
    await t.page.mouse.move(f.x + 60, f.y + 12); await t.page.mouse.down(); await t.page.mouse.move(f.x + 65, f.y + 17); await t.page.mouse.move(f.x + 60, f.y + 212, { steps: 10 });
    const mid = await t.frameBox('c9'); assert(mid.y > f.y + 100, `frame follows the pointer while dragging (was ${f.y}, now ${mid.y})`);
    await t.page.mouse.up(); await t.page.waitForTimeout(200);
    const after = await t.node('n2'); assert(after.y > alb.y + 100, 'member moved down with the frame');
    eq(after.container, 'c9', 'still in the same container');
    const fin = await t.frameBox('c9'); assert(Math.abs(fin.y - mid.y) < 8, 'frame stays where it was dropped');
  });

  // ---- structured editors ----
  const openSchema = async (t, id) => { await t.clickNode(id); await t.page.click('[data-tab="schema"]'); await t.page.waitForTimeout(200); };
  const fe = (path) => `[data-fe="${path}"]`;

  await test('body editor shows existing JSON as fields and edits write JSON back', async t => {
    await openSchema(t, 'n3');
    const rows = await t.page.$$eval(fe('endpoints.0.req') + ' [data-fpath] input.fname', els => els.map(e => e.value));
    assert(rows.includes('amount') && rows.includes('currency'), 'fields parsed from the stored JSON: ' + rows);
    // add a field, name it, set an example
    await t.page.click(fe('endpoints.0.req') + ' [data-feact="add"][data-flist=""]'); await t.page.waitForTimeout(100);
    await t.page.keyboard.type('reference'); // focus landed on the new row's name
    const newRow = (await t.page.$$(fe('endpoints.0.req') + ' [data-fpath]')).at(-1);
    await (await newRow.$('input.fex')).fill('ORD-42'); await t.page.waitForTimeout(100);
    const d = await t.doc(); const req = JSON.parse(d.model.nodes.find(n => n.id === 'n3').endpoints[0].req);
    eq(req.reference, 'ORD-42', 'new string field in the JSON'); eq(req.amount, 1299, 'existing field kept');
  });

  await test('changing a field type to object nests children; array picks an item type', async t => {
    await openSchema(t, 'n3');
    const row = (await t.page.$$(fe('endpoints.0.req') + ' [data-fpath]'))[0]; // amount
    await (await row.$('select[data-fk="type"]')).selectOption('object'); await t.page.waitForTimeout(150);
    await t.page.click(fe('endpoints.0.req') + ' [data-feact="add"][data-flist="0"]'); await t.page.waitForTimeout(100);
    await t.page.keyboard.type('minor');
    const child = await t.page.$(fe('endpoints.0.req') + ' [data-fpath="0.0"]');
    await (await child.$('select[data-fk="type"]')).selectOption('integer'); await t.page.waitForTimeout(150);
    await (await t.page.$(fe('endpoints.0.req') + ' [data-fpath="0.0"] input.fex')).fill('1200'); await t.page.waitForTimeout(100);
    let req = JSON.parse((await t.node('n3')).endpoints[0].req);
    eq(req.amount.minor, 1200, 'nested integer');
    // array of strings
    const cur = (await t.page.$$(fe('endpoints.0.req') + ' [data-fpath="1"]'))[0];
    await (await cur.$('select[data-fk="type"]')).selectOption('array'); await t.page.waitForTimeout(150);
    req = JSON.parse((await t.node('n3')).endpoints[0].req);
    assert(Array.isArray(req.currency) && typeof req.currency[0] === 'string', 'array<string> written: ' + JSON.stringify(req.currency));
  });

  await test('JSON tab accepts pasted JSON and Fields view reflects it', async t => {
    await openSchema(t, 'n3');
    await t.page.click(fe('endpoints.1.req') + ' [data-femode="json"]'); await t.page.waitForTimeout(100);
    await t.page.fill(fe('endpoints.1.req') + ' textarea', '{"merchantId": "m_1", "items": [{"sku": "A", "qty": 2}], "test": true}'); await t.page.waitForTimeout(100);
    await t.page.click(fe('endpoints.1.req') + ' [data-femode="fields"]'); await t.page.waitForTimeout(150);
    const names = await t.page.$$eval(fe('endpoints.1.req') + ' [data-fpath] input.fname', els => els.map(e => e.value));
    assert(names.join(',') === 'merchantId,items,sku,qty,test', 'tree from pasted JSON: ' + names);
    const types = await t.page.$$eval(fe('endpoints.1.req') + ' [data-fpath] select[data-fk="type"]', els => els.map(e => e.value));
    assert(types.join(',') === 'string,array,string,integer,boolean', 'types inferred: ' + types);
  });

  await test('invalid JSON stays editable as text with Fields disabled', async t => {
    await openSchema(t, 'n3');
    await t.page.click(fe('endpoints.1.res') + ' [data-femode="json"]'); await t.page.waitForTimeout(100);
    await t.page.fill(fe('endpoints.1.res') + ' textarea', '{ not json'); await t.page.waitForTimeout(100);
    assert(await t.page.$eval(fe('endpoints.1.res') + ' textarea', e => e.classList.contains('bad')), 'marked invalid');
    await t.clickNode('n2'); await openSchema(t, 'n3');
    assert(await t.page.$eval(fe('endpoints.1.res') + ' [data-femode="fields"]', e => e.disabled), 'Fields disabled for unparseable text');
    eq((await t.node('n3')).endpoints[1].res, '{ not json', 'raw text preserved');
  });

  await test('Avro editor: nullable, logical type, enum symbols and a nested record', async t => {
    await openSchema(t, 'n6');
    const p = 'topics.0.schema';
    await t.page.check(fe(p) + ' [data-fpath="2"] input[data-fk="nullable"]'); await t.page.waitForTimeout(100); // currency nullable
    await t.page.selectOption(fe(p) + ' [data-fpath="0"] select[data-fk="type"]', 'uuid'); await t.page.waitForTimeout(150);
    await t.page.click(fe(p) + ' [data-feact="add"][data-flist=""]'); await t.page.waitForTimeout(100); await t.page.keyboard.type('status');
    await t.page.selectOption(fe(p) + ' [data-fpath="3"] select[data-fk="type"]', 'enum'); await t.page.waitForTimeout(150);
    await t.page.fill(fe(p) + ' [data-fpath="3"] input[data-fk="symbols"]', 'NEW, PAID'); await t.page.waitForTimeout(100);
    await t.page.click(fe(p) + ' [data-feact="add"][data-flist=""]'); await t.page.waitForTimeout(100); await t.page.keyboard.type('lines');
    await t.page.selectOption(fe(p) + ' [data-fpath="4"] select[data-fk="type"]', 'array'); await t.page.waitForTimeout(150);
    await t.page.selectOption(fe(p) + ' [data-fpath="4"] select[data-fk="items"]', 'record'); await t.page.waitForTimeout(150);
    await t.page.click(fe(p) + ' [data-feact="add"][data-flist="4"]'); await t.page.waitForTimeout(100); await t.page.keyboard.type('sku');
    const s = JSON.parse((await t.node('n6')).topics[0].schema);
    eq(s.type, 'record'); eq(s.name, 'PaymentAuthorised');
    assert(Array.isArray(s.fields[2].type) && s.fields[2].type[0] === 'null' && s.fields[2].default === null, 'nullable union with default null');
    eq(s.fields[0].type.logicalType, 'uuid', 'logical type');
    eq(s.fields[3].type.type, 'enum'); assert(s.fields[3].type.symbols.join() === 'NEW,PAID', 'enum symbols');
    eq(s.fields[4].type.type, 'array'); eq(s.fields[4].type.items.type, 'record'); eq(s.fields[4].type.items.fields[0].name, 'sku', 'nested record field');
    // the canvas can render it
    await t.page.keyboard.press('Escape'); await t.clickNode('n6'); await t.page.keyboard.press('Space'); await t.page.waitForTimeout(300);
    const txt = await t.page.$eval('[data-node="n6"]', g => g.textContent);
    assert(txt.includes('enum(2)') && txt.includes('array<Lines>'), 'expanded node shows the new types: ' + txt);
  });

  await test('topic partition key is saved and tagged on the expanded node', async t => {
    await openSchema(t, 'n6');
    const opts = await t.page.$$eval('#tk-0 option', os => os.map(o => o.value));
    assert(opts.includes('paymentId'), 'key suggestions come from the schema fields: ' + opts);
    await t.page.fill('input[data-path="topics.0.key"]', 'paymentId'); await t.page.waitForTimeout(100);
    eq((await t.node('n6')).topics[0].key, 'paymentId');
    await t.page.keyboard.press('Escape'); await t.clickNode('n6'); await t.page.keyboard.press('Space'); await t.page.waitForTimeout(300);
    assert((await t.page.$eval('[data-node="n6"]', g => g.textContent)).includes('KEY'), 'KEY tag drawn');
  });

  await test('header name and value fields offer suggestions', async t => {
    await openSchema(t, 'n3');
    const names = await t.page.$$eval('#hdrNames option', os => os.map(o => o.value));
    assert(names.includes('Idempotency-Key') && names.includes('Content-Type'), 'common header names listed');
    const vals = await t.page.$$eval('#hv-0-0 option', os => os.map(o => o.value)); // Authorization
    assert(vals.includes('Bearer <token>'), 'values suggested for Authorization: ' + vals);
    eq(await t.page.$eval('input[data-path="endpoints.0.headers.0.k"]', e => e.getAttribute('list')), 'hdrNames');
  });

  await test('undo reverts a field-editor change', async t => {
    await openSchema(t, 'n3');
    const before = (await t.node('n3')).endpoints[0].req;
    await t.page.click(fe('endpoints.0.req') + ' [data-fpath="0"] [data-feact="rm"]'); await t.page.waitForTimeout(150);
    assert(!JSON.parse((await t.node('n3')).endpoints[0].req).amount, 'amount removed');
    await t.page.keyboard.press('Escape'); await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(200);
    eq((await t.node('n3')).endpoints[0].req, before, 'restored');
  });

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — screenshots in ' + OUT : ''}`);
  process.exit(failed.length ? 1 : 0);
})();
