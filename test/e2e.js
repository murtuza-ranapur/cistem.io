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
    const parsed = JSON.parse(text); eq(parsed.version, 4, 'current file version');
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

  await test('the dot grid moves and zooms with the diagram', async t => {
    const grid = () => t.page.evaluate(() => { const g = document.getElementById('grid'); return { x: +g.getAttribute('x'), y: +g.getAttribute('y'), w: +g.getAttribute('width') }; });
    const g0 = await grid(); const n0 = await t.box('[data-node="n3"] rect.body');
    const p = await t.emptyCanvasPoint();
    await t.page.mouse.move(p.x, p.y); await t.page.mouse.down(); await t.page.mouse.move(p.x + 50, p.y + 30, { steps: 4 }); await t.page.mouse.move(p.x + 120, p.y + 70, { steps: 6 }); await t.page.mouse.up(); await t.page.waitForTimeout(100);
    const g1 = await grid(); const n1 = await t.box('[data-node="n3"] rect.body');
    assert(Math.abs((g1.x - g0.x) - (n1.x - n0.x)) < 1 && Math.abs((g1.y - g0.y) - (n1.y - n0.y)) < 1, `grid moved with the diagram (grid ${g1.x - g0.x},${g1.y - g0.y} vs node ${n1.x - n0.x},${n1.y - n0.y})`);
    await t.page.mouse.move(p.x, p.y); await t.page.keyboard.down('Control'); await t.page.mouse.wheel(0, -300); await t.page.keyboard.up('Control'); await t.page.waitForTimeout(200);
    const g2 = await grid(); assert(g2.w !== g1.w, `grid spacing follows zoom (${g1.w} → ${g2.w})`);
  });

  const overlaps = t => t.page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-node] rect.body')].map(r => ({ id: r.closest('[data-node]').dataset.node, b: r.getBoundingClientRect() }));
    const out = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].b, c = boxes[j].b;
      if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) out.push(boxes[i].id + '×' + boxes[j].id);
    }
    return out;
  });

  await test('the example opens without overlapping boxes', async t => {
    eq((await overlaps(t)).join(','), '', 'overlaps');
  });

  await test('expanding a node pushes its neighbours out of the way; collapsing brings them back', async t => {
    // stack a node right under the database first, then expand the database
    const db = await t.node('n5'); const before = (await t.doc()).layout.positions;
    await t.page.evaluate(([x, y]) => { const d = JSON.parse(localStorage.getItem('cistem.doc')); d.layout.positions.n4 = { x, y }; d.layout.detail = {}; localStorage.setItem('cistem.doc', JSON.stringify(d)); }, [db.x, db.y + 110]);
    await t.page.reload(); await t.page.waitForTimeout(500);
    eq((await overlaps(t)).length, 0, 'no overlaps to start with');
    const n4 = (await t.doc()).layout.positions.n4;
    await t.clickNode('n5'); await t.page.keyboard.press('Escape'); await t.clickNode('n5');
    await t.page.keyboard.press('Space'); await t.page.waitForTimeout(400);
    eq((await overlaps(t)).join(','), '', 'expanded database overlaps nothing');
    const pushed = (await t.doc()).layout.positions.n4; assert(pushed.y > n4.y, 'node below moved down');
    await t.page.keyboard.press('Space'); await t.page.waitForTimeout(400);
    eq(JSON.stringify((await t.doc()).layout.positions.n4), JSON.stringify(n4), 'collapsing put it back');
    await t.page.keyboard.press('Shift+Space'); await t.page.waitForTimeout(500);
    eq((await overlaps(t)).join(','), '', 'expand all overlaps nothing');
  });

  // ---- load on the clients ----
  await test('load is set on each client; the top bar shows the total', async t => {
    eq((await t.page.textContent('#totalVal')).trim(), '5.0k', 'example total');
    await t.page.click('#totalRps'); await t.page.waitForTimeout(500);
    const focused = await t.page.evaluate(() => document.activeElement?.dataset?.path);
    eq(focused, 'rps', 'the chip takes you to the client\'s rps');
    await t.page.keyboard.type('2000'); await t.page.waitForTimeout(200);
    eq((await t.node('n1')).rps, 2000);
    eq((await t.page.textContent('#totalVal')).trim(), '2.0k', 'total follows');
    assert(!/Breaks/.test(await t.page.textContent('#verdict')), 'at 2k the example no longer breaks: ' + await t.page.textContent('#verdict'));
    // a second client adds to the load
    await t.page.keyboard.press('Escape'); await t.page.keyboard.press('Escape');
    await t.page.keyboard.press('1'); await t.page.waitForTimeout(300); // add Clients
    const doc = await t.doc(); const added = doc.model.nodes.find(n => n.kind === 'entry' && n.id !== 'n1');
    assert(added && added.rps === 1000, 'new clients start at 1000 rps');
    eq((await t.page.textContent('#totalVal')).trim(), '3.0k', 'total is the sum');
    assert((await t.page.textContent('[data-node="n1"]')).includes('2.0k rps peak'), 'client shows its peak on the canvas');
  });

  await test('environments can be recoloured, filled solid or outlined', async t => {
    const f = await t.box('[data-container="c9"] rect.fhead'); await t.page.mouse.click(f.x + 120, f.y + 10); await t.page.waitForTimeout(400);
    await t.page.click('[data-cstyle="color:teal"]'); await t.page.click('[data-cstyle="fill:solid"]'); await t.page.click('[data-cstyle="border:solid"]'); await t.page.waitForTimeout(150);
    const c = (await t.doc()).model.containers.find(c => c.id === 'c9');
    eq(c.color, 'teal'); eq(c.fill, 'solid'); eq(c.border, 'solid');
    const cls = await t.page.$eval('[data-container="c9"]', g => g.getAttribute('class'));
    assert(cls.includes('fill-solid') && cls.includes('border-solid'), cls);
    await t.page.click('[data-cstyle="fill:outline"]'); await t.page.click('[data-cstyle="color:"]'); await t.page.waitForTimeout(150);
    const c2 = (await t.doc()).model.containers.find(c => c.id === 'c9');
    eq(c2.fill, 'outline'); eq(c2.color, undefined, 'back to the kind\'s default colour');
    await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(150);
    eq((await t.doc()).model.containers.find(c => c.id === 'c9').color, 'teal', 'undo');
  });

  await test('a Kafka node is one topic', async t => {
    const q = await t.node('n6');
    eq(q.name, 'payments.authorised'); eq(q.partitions, 12); assert(!('topics' in q), 'no topic list');
    assert((await t.page.textContent('[data-node="n6"]')).includes('12 partitions'), 'partitions on the node');
  });

  await test('labels are sentence case and fields look editable', async t => {
    await t.clickNode('n3');
    const upper = await t.page.evaluate(() => [...document.querySelectorAll('#inspector *')].filter(e => getComputedStyle(e).textTransform === 'uppercase').map(e => e.className).slice(0, 5));
    eq(upper.length, 0, 'nothing forced to uppercase: ' + upper);
    const lower = await t.page.$$eval('#sheetBody label', ls => ls.map(l => (l.childNodes[0]?.textContent || '').trim()).filter(x => x && /^[a-z]/.test(x)));
    eq(lower.join(','), '', 'labels start with a capital');
    const bg = await t.page.$eval('#sheetBody input[data-path="name"]', e => getComputedStyle(e).backgroundColor);
    const panel = await t.page.$eval('#inspector', e => getComputedStyle(e).backgroundColor);
    eq(bg, panel, 'inputs are the panel colour, not the grey page colour');
  });

  // ---- details panel ----
  const panelOpen = t => t.page.$eval('#inspector', e => !e.classList.contains('closed'));

  await test('dragging a node does not pop the details panel open; a click does', async t => {
    assert(!(await panelOpen(t)), 'starts closed');
    const b = await t.node('n2');
    await t.dragNodeTo('n2', 400, 300); await t.page.waitForTimeout(300);
    assert(!(await panelOpen(t)), 'drag left the panel closed');
    await t.clickNode('n3'); assert(await panelOpen(t), 'click opened it');
  });

  await test('close hides the panel and it stays hidden; I brings it back pinned', async t => {
    await t.clickNode('n3'); assert(await panelOpen(t));
    await t.page.click('#inspBar [data-panel="close"]'); await t.page.waitForTimeout(300);
    assert(!(await panelOpen(t)), 'closed');
    await t.clickNode('n2'); assert(!(await panelOpen(t)), 'selecting no longer opens it');
    await t.page.reload(); await t.page.waitForTimeout(500);
    await t.clickNode('n2'); assert(!(await panelOpen(t)), 'remembered across reload');
    await t.page.keyboard.press('i'); await t.page.waitForTimeout(300);
    assert(await panelOpen(t), 'I opens it');
    await t.page.keyboard.press('Escape'); await t.page.waitForTimeout(200);
    assert(await panelOpen(t), 'reopened panel is pinned — deselecting keeps it');
    assert((await t.page.textContent('#sheetBody')).includes('Nothing selected'), 'placeholder');
  });

  await test('pin keeps the panel open; unpin returns to open-on-select', async t => {
    await t.clickNode('n3');
    await t.page.click('#inspBar [data-panel="pin"]'); await t.page.waitForTimeout(100);
    await t.page.keyboard.press('Escape'); await t.page.waitForTimeout(200);
    assert(await panelOpen(t), 'pinned stays open');
    await t.page.click('#inspBar [data-panel="pin"]'); await t.page.waitForTimeout(250);
    assert(!(await panelOpen(t)), 'unpinned with nothing selected closes');
    await t.page.click('#panelBtn'); await t.page.waitForTimeout(250); assert(await panelOpen(t), 'toolbar button opens');
    await t.page.click('#panelBtn'); await t.page.waitForTimeout(250); assert(!(await panelOpen(t)), 'toolbar button hides');
  });

  await test('clients have a delete button in the panel', async t => {
    await t.clickNode('n1');
    await t.page.click('#sheetBody [data-action="delete-node"]'); await t.page.waitForTimeout(200);
    assert(!(await t.node('n1')), 'client deleted');
  });

  // ---- example / import ----
  await test('opening the example is undoable as a whole, title included (signed out)', async t => {
    await t.page.fill('#title', 'My payments'); await t.page.keyboard.press('Enter');
    await t.clickNode('n2'); await t.page.keyboard.press('Delete'); await t.page.waitForTimeout(150);
    const mine = await t.doc(); eq(mine.meta.title, 'My payments');
    await t.page.click('#resetBtn'); await t.page.waitForTimeout(400);
    eq((await t.doc()).meta.title, 'Checkout example'); assert(await t.node('n2'), 'example loaded');
    await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(300);
    const back = await t.doc();
    eq(back.meta.title, 'My payments', 'title restored with the undo');
    assert(!back.model.nodes.some(n => n.id === 'n2'), 'my edits restored');
    eq(await t.page.inputValue('#title'), 'My payments', 'title box shows it');
  });

  // ---- tooltips ----
  await test('toolbar tooltips appear quickly', async t => {
    const b = await t.box('#layoutBtn');
    await t.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await t.page.waitForTimeout(300);
    const tip = await t.page.$('.tip.on'); assert(tip, 'tooltip shown within 300ms');
    assert((await tip.textContent()).includes('Auto-organise'));
    eq(await t.page.$eval('#layoutBtn', e => e.getAttribute('title')), null, 'native title removed so the slow browser tooltip never fires');
    const z = await t.box('#zfit'); await t.page.mouse.move(z.x + z.width / 2, z.y + z.height / 2); await t.page.waitForTimeout(40);
    assert((await t.page.textContent('.tip.on')).includes('Fit'), 'moving to the neighbour shows its tip at once');
  });

  const completions = t => t.page.$$eval('.cm-tooltip-autocomplete li .cm-completionLabel', els => els.map(e => e.textContent));
  const setCodeDb = async (t, text) => { await t.page.click('.cm-host[data-cmdb] .cm-content'); await t.page.keyboard.press('Control+a'); await t.page.keyboard.press('Delete'); if (text) await t.page.keyboard.insertText(text); await t.page.waitForTimeout(150); };
  // ---- table editor (rows + code) ----
  const dbId = async t => (await t.doc()).model.nodes.find(n => n.kind === 'db').id;
  const openTables = async t => { const id = await dbId(t); await t.clickNode(id); await t.page.click('[data-tab="schema"]'); await t.page.waitForTimeout(200); return id; };

  await test('tables: rows read like the canvas node; click a row to edit it', async t => {
    const id = await openTables(t);
    const rows = await t.page.$$eval('.tcard[data-t="0"] .trow .tnm', els => els.map(e => e.textContent));
    assert(rows[0] === 'id' && rows.includes('merchant_id'), 'rows listed: ' + rows);
    assert(await t.page.$('.tcard[data-t="0"] .trow .tkey svg'), 'key icon on the pk');
    await t.page.click(`[data-opencol="${id}:0:1"]`); await t.page.waitForTimeout(150);
    assert(await t.page.$('.tedit .cname'), 'editor opened'); eq(await t.page.evaluate(() => document.activeElement.className), 'cname', 'name focused');
    await t.page.click('.tedit [data-flip$=".unique"]'); await t.page.waitForTimeout(100);
    await t.page.selectOption('.tedit select[data-path$=".references"]', 'refunds.id'); await t.page.waitForTimeout(100);
    await t.page.fill('.tedit input[data-path$=".default"]', 'gen_random_uuid()');
    await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(150);
    assert(!(await t.page.$('.tedit')), 'Enter closes the row');
    const c = (await t.node(id)).tables[0].columns[1];
    eq(c.unique, true); eq(c.references, 'refunds.id'); eq(c.default, 'gen_random_uuid()');
    const tags = await t.page.textContent(`[data-opencol="${id}:0:1"] .ttags`);
    assert(tags.includes('→ refunds.id') && tags.includes('UQ') && tags.includes('= gen_random_uuid()'), 'tags on the row: ' + tags);
  });

  await test('tables: PK implies NOT NULL; allowing NULL drops PK', async t => {
    const id = await openTables(t);
    await t.page.click(`[data-opencol="${id}:0:2"]`); await t.page.waitForTimeout(150);
    let c = (await t.node(id)).tables[0].columns[2];
    if (!c.nullable) { await t.page.click('.tedit [data-flip$=".nullable"]'); await t.page.waitForTimeout(100); }
    await t.page.click('.tedit [data-flip$=".pk"]'); await t.page.waitForTimeout(100);
    c = (await t.node(id)).tables[0].columns[2]; eq(c.pk, true); eq(c.nullable, false, 'PK → not null');
    await t.page.click('.tedit [data-flip$=".nullable"]'); await t.page.waitForTimeout(100);
    c = (await t.node(id)).tables[0].columns[2]; eq(c.nullable, true); eq(c.pk, false, 'nullable → not a PK');
  });

  await test('tables: add columns by typing one line each', async t => {
    const id = await openTables(t);
    const before = (await t.node(id)).tables[0].columns.length;
    await t.page.click('[data-addcol="0"]');
    await t.page.keyboard.type('refunded_at timestamptz?'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(150);
    eq(await t.page.evaluate(() => document.activeElement.dataset.addcol), '0', 'focus stays for the next one');
    await t.page.keyboard.type('code char(3) [unique]'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(150);
    await t.page.keyboard.type('justaname'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(150);
    assert((await t.page.textContent('[data-adderr="0"]')).includes('needs a type'), 'explains a bad line');
    const cols = (await t.node(id)).tables[0].columns;
    eq(cols.length, before + 2);
    eq(cols[before].name, 'refunded_at'); eq(cols[before].nullable, true);
    eq(cols[before + 1].unique, true);
  });

  await test('tables: Code view edits the schema as text, with suggestions', async t => {
    const id = await openTables(t);
    await t.page.click('[data-tblmode="code"]'); await t.page.waitForSelector('.cm-host[data-cmdb] .cm-content');
    const text = await t.page.textContent('.cm-host[data-cmdb] .cm-content');
    assert(text.includes('Table payments {') && text.includes('[ref: > payments.id]'), 'shows the tables as text');
    // add a column at the end of the first table
    await t.page.click('.cm-host[data-cmdb] .cm-content');
    await t.page.keyboard.press('Control+Home');
    for (let i = 0; i < 7; i++) await t.page.keyboard.press('ArrowDown'); // on created_at (last column of payments)
    await t.page.keyboard.press('End'); await t.page.keyboard.press('Enter');
    await t.page.keyboard.type('refunded_at times'); await t.page.waitForSelector('.cm-tooltip-autocomplete'); await t.page.waitForTimeout(200);
    eq((await completions(t))[0], 'timestamptz', 'type suggestions');
    await t.page.keyboard.press('Enter'); await t.page.keyboard.type('? ['); await t.page.waitForSelector('.cm-tooltip-autocomplete'); await t.page.waitForTimeout(200);
    assert((await completions(t)).includes('ref: >'), 'flag suggestions');
    await t.page.keyboard.type('ref: > ref'); await t.page.waitForTimeout(200);
    assert((await completions(t)).includes('refunds.id'), 'FK targets: ' + await completions(t));
    await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(500); // pick the first target (the pk)
    const col = (await t.node(id)).tables[0].columns.at(-1);
    eq(col.name, 'refunded_at'); eq(col.type, 'timestamptz'); eq(col.nullable, true);
    assert(col.references?.startsWith('refunds.'), 'ref saved: ' + col.references);
  });

  await test('tables: invalid text keeps the last valid version and says so', async t => {
    const id = await openTables(t);
    await t.page.click('[data-tblmode="code"]'); await t.page.waitForSelector('.cm-host[data-cmdb] .cm-content');
    const good = JSON.stringify((await t.node(id)).tables);
    await t.page.click('.cm-host[data-cmdb] .cm-content'); await t.page.keyboard.press('Control+Home');
    await t.page.keyboard.press('ArrowDown'); await t.page.keyboard.press('End'); await t.page.keyboard.press('Enter');
    await t.page.keyboard.type('broken'); await t.page.waitForTimeout(500);
    eq(JSON.stringify((await t.node(id)).tables), good, 'model untouched while text is invalid');
    assert((await t.page.textContent('[data-tblstatus]')).includes('1 problem'), 'status says so');
    assert(await t.page.$('.cm-host[data-cmdb] .cm-lintRange-error'), 'line underlined');
  });

  await test('tables: pasting CREATE TABLE converts it', async t => {
    const id = await openTables(t);
    await t.page.click('[data-tblmode="code"]'); await t.page.waitForSelector('.cm-host[data-cmdb] .cm-content');
    await setCodeDb(t, '');
    await t.page.evaluate(() => {
      const el = document.querySelector('.cm-host[data-cmdb] .cm-content');
      const dt = new DataTransfer(); dt.setData('text/plain', 'CREATE TABLE ledger (id bigserial PRIMARY KEY, account text NOT NULL, amount numeric(18,2) NOT NULL, note text);');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await t.page.waitForTimeout(300);
    const ts = (await t.node(id)).tables;
    eq(ts.length, 1); eq(ts[0].name, 'ledger');
    assert((await t.page.textContent('.cm-host[data-cmdb] .cm-content')).includes('Table ledger {'), 'shown as text');
    eq(ts[0].columns.find(c => c.name === 'note').nullable, true);
  });

  // ---- structured editors ----
  const openSchema = async (t, id) => { await t.clickNode(id); await t.page.click('[data-tab="schema"]'); await t.page.waitForTimeout(200); };
  const fe = (path) => `[data-fe="${path}"]`;
  const fieldsMode = async (t, path) => { await t.page.click(fe(path) + ' [data-femode="fields"]'); await t.page.waitForTimeout(150); };
  const cm = (path) => fe(path) + ' .cm-content';
  /** replace the code editor's text (insertText bypasses auto-closing brackets) */
  const setCode = async (t, path, text) => { await t.page.waitForSelector(cm(path)); await t.page.click(cm(path)); await t.page.keyboard.press('Control+a'); await t.page.keyboard.press('Delete'); if (text) await t.page.keyboard.insertText(text); await t.page.waitForTimeout(120); };


  await test('body editor shows existing JSON as fields and edits write JSON back', async t => {
    await openSchema(t, 'n3'); await fieldsMode(t, 'endpoints.0.req');
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
    await openSchema(t, 'n3'); await fieldsMode(t, 'endpoints.0.req');
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

  await test('Code is the default view; pasted JSON shows up as a field tree', async t => {
    await openSchema(t, 'n3');
    await t.page.waitForSelector(cm('endpoints.1.req'));
    assert(await t.page.$eval(fe('endpoints.1.req') + ' [data-femode="code"]', e => e.classList.contains('on')), 'Code tab on by default');
    await setCode(t, 'endpoints.1.req', '{"merchantId": "m_1", "items": [{"sku": "A", "qty": 2}], "test": true}');
    eq(JSON.parse((await t.node('n3')).endpoints[1].req).merchantId, 'm_1', 'saved as you type');
    assert(await t.page.$(fe('endpoints.1.req') + ' .cm-content .tok-propertyName, ' + fe('endpoints.1.req') + ' .cm-line span'), 'syntax highlighted');
    await fieldsMode(t, 'endpoints.1.req');
    const names = await t.page.$$eval(fe('endpoints.1.req') + ' [data-fpath] input.fname', els => els.map(e => e.value));
    assert(names.join(',') === 'merchantId,items,sku,qty,test', 'tree from pasted JSON: ' + names);
  });

  await test('invalid JSON is underlined, kept as typed, and Fields is disabled', async t => {
    await openSchema(t, 'n3');
    await setCode(t, 'endpoints.1.res', '{ "a": 1, nope }'); await t.page.waitForTimeout(600);
    assert(await t.page.$(fe('endpoints.1.res') + ' .cm-lintRange-error'), 'error underline');
    eq((await t.node('n3')).endpoints[1].res, '{ "a": 1, nope }', 'raw text preserved');
    await t.page.keyboard.press('Escape'); await t.clickNode('n2'); await openSchema(t, 'n3');
    assert(await t.page.$eval(fe('endpoints.1.res') + ' [data-femode="fields"]', e => e.disabled), 'Fields disabled for unparseable text');
  });

  await test('typing in the code editor never triggers canvas shortcuts', async t => {
    await openSchema(t, 'n3');
    await setCode(t, 'endpoints.1.req', '{"x": 1}');
    await t.page.keyboard.press('End'); for (let i = 0; i < 4; i++) await t.page.keyboard.press('Backspace');
    await t.page.keyboard.type('oei 1');
    assert(await t.node('n3'), 'Backspace did not delete the service');
    eq((await t.doc()).model.nodes.length, 7, 'o/e/1 did not add anything');
    assert(await t.page.$eval('#inspector', e => !e.classList.contains('closed')), 'i did not hide the panel');
  });

  await test('Avro code editor suggests keys and types, and inserts them', async t => {
    await openSchema(t, 'n6');
    const p = 'schema';
    await setCode(t, p, '{\n  "type": "record",\n  "name": "E",\n  "fields": [\n    { "name": "a", "type": ');
    await t.page.keyboard.press('Control+Space'); await t.page.waitForSelector('.cm-tooltip-autocomplete');
    const l = await completions(t);
    assert(l.slice(0, 3).includes('string') && l.includes('nullable string') && l.includes('uuid'), 'type suggestions: ' + l);
    await t.page.keyboard.type('"lo'); await t.page.waitForTimeout(150);
    eq((await completions(t))[0], 'long', 'narrowed by what was typed');
    await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(120);
    const text = (await t.node('n6')).schema;
    assert(/"type": "long"/.test(text), 'inserted the type: ' + text);
    // key suggestions in a fresh field object
    await t.page.keyboard.insertText(' }, '); await t.page.keyboard.type('{ "'); await t.page.waitForSelector('.cm-tooltip-autocomplete');
    const keys = await completions(t);
    assert(keys[0] === 'name' && keys.includes('type') && keys.includes('default'), 'field keys: ' + keys);
  });

  await test('Avro problems are underlined with an explanation', async t => {
    await openSchema(t, 'n6');
    await setCode(t, 'schema', JSON.stringify({ type: 'record', name: 'E', fields: [{ name: 'a', type: 'lnog' }, { name: 'b', type: ['null', 'string'] }] }, null, 2));
    await t.page.waitForTimeout(700);
    assert(await t.page.$(fe('schema') + ' .cm-lintRange-error'), 'unknown type underlined');
    assert(await t.page.$(fe('schema') + ' .cm-lintRange-warning'), 'nullable without default warned');
  });

  await test('body suggestions come from connected tables and other bodies', async t => {
    await openSchema(t, 'n3');
    await setCode(t, 'endpoints.1.req', '{ ');
    await t.page.keyboard.type('"'); await t.page.waitForSelector('.cm-tooltip-autocomplete');
    const l = await completions(t);
    assert(l.includes('idempotency_key') && l.includes('amount_minor'), 'columns of payments-db (connected): ' + l.slice(0, 12));
    await t.page.keyboard.type('idem'); await t.page.waitForTimeout(120);
    await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(120);
    const text = (await t.node('n3')).endpoints[1].req;
    assert(/"idempotency_key": "/.test(text), 'inserted key with a value slot: ' + text);
  });

  await test('expand opens a large editor that writes back; Esc closes it', async t => {
    await openSchema(t, 'n3');
    await t.page.click(fe('endpoints.0.res') + ' [data-feexpand]'); await t.page.waitForSelector('.cm-overlay .cm-content');
    assert(await t.page.$('.cm-overlay .cm-lineNumbers'), 'line numbers in the big editor');
    await t.page.click('.cm-overlay .cm-content'); await t.page.keyboard.press('Control+a'); await t.page.keyboard.press('Delete');
    await t.page.keyboard.insertText('{"big": true}'); await t.page.waitForTimeout(100);
    await t.page.keyboard.press('Escape'); await t.page.waitForTimeout(150);
    assert(!(await t.page.$('.cm-overlay')), 'closed');
    eq((await t.node('n3')).endpoints[0].res, '{"big": true}');
    assert((await t.page.textContent(fe('endpoints.0.res'))).includes('big'), 'panel editor shows the new text');
  });

  await test('Format re-indents JSON', async t => {
    await openSchema(t, 'n3');
    await setCode(t, 'endpoints.1.req', '{"a":1,"b":{"c":2}}');
    await t.page.click(fe('endpoints.1.req') + ' [data-feformat]'); await t.page.waitForTimeout(120);
    eq((await t.node('n3')).endpoints[1].req, '{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}');
  });

  await test('Avro editor: nullable, logical type, enum symbols and a nested record', async t => {
    await openSchema(t, 'n6');
    const p = 'schema'; await fieldsMode(t, p);
    await t.page.check(fe(p) + ' [data-fpath="2"] input[data-fk="nullable"]'); await t.page.waitForTimeout(100); // currency nullable
    await t.page.selectOption(fe(p) + ' [data-fpath="0"] select[data-fk="type"]', 'uuid'); await t.page.waitForTimeout(150);
    await t.page.click(fe(p) + ' [data-feact="add"][data-flist=""]'); await t.page.waitForTimeout(100); await t.page.keyboard.type('status');
    await t.page.selectOption(fe(p) + ' [data-fpath="3"] select[data-fk="type"]', 'enum'); await t.page.waitForTimeout(150);
    await t.page.fill(fe(p) + ' [data-fpath="3"] input[data-fk="symbols"]', 'NEW, PAID'); await t.page.waitForTimeout(100);
    await t.page.click(fe(p) + ' [data-feact="add"][data-flist=""]'); await t.page.waitForTimeout(100); await t.page.keyboard.type('lines');
    await t.page.selectOption(fe(p) + ' [data-fpath="4"] select[data-fk="type"]', 'array'); await t.page.waitForTimeout(150);
    await t.page.selectOption(fe(p) + ' [data-fpath="4"] select[data-fk="items"]', 'record'); await t.page.waitForTimeout(150);
    await t.page.click(fe(p) + ' [data-feact="add"][data-flist="4"]'); await t.page.waitForTimeout(100); await t.page.keyboard.type('sku');
    const s = JSON.parse((await t.node('n6')).schema);
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
    const opts = await t.page.$$eval('#tkeys option', os => os.map(o => o.value));
    assert(opts.includes('paymentId'), 'key suggestions come from the schema fields: ' + opts);
    await t.page.fill('input[data-path="key"]', 'paymentId'); await t.page.waitForTimeout(100);
    eq((await t.node('n6')).key, 'paymentId');
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
    await openSchema(t, 'n3'); await fieldsMode(t, 'endpoints.0.req');
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
