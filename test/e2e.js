// Browser tests for the editor. Drives the real UI (mouse, keys, buttons) against a built app.
// Run: node test/e2e.js [baseUrl]   (default http://localhost:4173)
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:4173';
const OUT = process.env.E2E_OUT || '/tmp/e2e';
require('fs').mkdirSync(OUT, { recursive: true });

const results = [];
async function test(name, fn) {
  if (process.env.E2E_ONLY && !name.includes(process.env.E2E_ONLY)) return;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const t = new T(page);
  try {
    await page.goto(BASE); await page.waitForTimeout(300);
    await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('cistem'); }); await page.reload(); await page.waitForTimeout(600);
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
/** In the page: the open tab's document from IndexedDB. */
function idbDoc() {
  return new Promise((ok, fail) => {
    const key = document.querySelector('.dtab.on')?.dataset.key;
    const r = indexedDB.open('cistem'); r.onerror = fail;
    r.onsuccess = () => { const g = r.result.transaction('docs').objectStore('docs').get(key); g.onsuccess = () => ok(g.result?.file ?? null); g.onerror = fail; };
  });
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'expected equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

class T {
  constructor(page) { this.page = page; }
  /** The open diagram as this browser stored it (IndexedDB). */
  async doc() { await this.page.waitForTimeout(60); return this.page.evaluate(idbDoc, null); }
  /** Change the stored copy of the open diagram (then reload to see it). */
  editStored(fn, arg) { return this.page.evaluate(([src, a]) => new Promise((ok, fail) => {
    const key = document.querySelector('.dtab.on').dataset.key;
    const r = indexedDB.open('cistem'); r.onerror = fail;
    r.onsuccess = () => { const s = r.result.transaction('docs', 'readwrite').objectStore('docs'); const g = s.get(key);
      g.onsuccess = () => { const rec = g.result; new Function('d', 'a', src)(rec.file, a); const p = s.put(rec, key); p.onsuccess = () => ok(); p.onerror = fail; }; };
  }), [fn, arg]); }
  async node(id) { const d = await this.doc(); const n = d.model.nodes.find(n => n.id === id); if (!n) return null; return { ...n, ...d.layout.positions[id] }; }
  async nodeByName(name) { const d = await this.doc(); const n = d.model.nodes.find(n => n.name === name); return n && { ...n, ...d.layout.positions[n.id] }; }
  async box(sel) { const el = await this.page.$(sel); if (!el) throw new Error('no element ' + sel); return el.boundingBox(); }
  async center(sel) { const b = await this.box(sel); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
  async clickNode(id, mods = []) { const b = await this.box(`[data-node="${id}"] rect.body`); for (const m of mods) await this.page.keyboard.down(m); await this.page.mouse.click(b.x + 20, b.y + 50); for (const m of mods) await this.page.keyboard.up(m); await this.page.waitForTimeout(500); /* inspector slide + reveal pan */ }
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
    eq(await t.page.title(), 'Renamed system · cistem.dev', 'document.title');
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
    await t.editStored('d.layout.positions.n4 = { x: a[0], y: a[1] }; d.layout.detail = {};', [db.x, db.y + 110]);
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
  await test('the example opens in a new tab; the diagram you had stays in its tab', async t => {
    await t.page.fill('#title', 'My payments'); await t.page.keyboard.press('Enter');
    await t.clickNode('n2'); await t.page.keyboard.press('Delete'); await t.page.waitForTimeout(150);
    const before = await t.page.$$eval('.dtab', els => els.length);
    await t.page.click('#resetBtn'); await t.page.waitForTimeout(400);
    eq(await t.page.$$eval('.dtab', els => els.length), before + 1, 'one more tab');
    eq((await t.doc()).meta.title, 'Checkout example'); assert(await t.node('n2'), 'example loaded');
    await t.page.click('.dtab:has-text("My payments")'); await t.page.waitForTimeout(300);
    const back = await t.doc();
    eq(back.meta.title, 'My payments'); assert(!back.model.nodes.some(n => n.id === 'n2'), 'my edits are still there');
    eq(await t.page.inputValue('#title'), 'My payments', 'title box shows it');
  });

  // ---- tabs ----
  await test('+ System opens a blank diagram in a new tab; each tab keeps its own undo', async t => {
    const p = await t.emptyCanvasPoint(); await t.dragNodeTo('n3', p.x + 120, p.y);   // an undoable edit in tab A
    await t.page.click('#newTabBtn'); await t.page.waitForTimeout(150);
    assert(await t.page.isVisible('#newMenu'), 'menu open');
    assert(!(await t.page.isDisabled('[data-new="sequence"]')), 'sequence available');
    assert(!(await t.page.isDisabled('[data-new="class"]')), 'class available');
    await t.page.click('[data-new="system"]'); await t.page.waitForTimeout(300);
    const d = await t.doc(); eq(d.model.nodes.length, 1, 'blank: just clients'); eq(d.meta.title, 'Untitled system');
    eq(await t.page.$eval('.dtab.on .tt', e => e.textContent), 'Untitled system');
    assert(await t.page.isDisabled('#undoBtn'), 'a new tab starts with no history');
    await t.page.keyboard.press('Alt+1'); await t.page.waitForTimeout(300);
    eq(await t.page.$eval('.dtab.on', e => [...e.parentNode.children].indexOf(e)), 0, 'Alt+1 goes to the first tab');
    await t.page.keyboard.press('Alt+2'); await t.page.waitForTimeout(300);
    eq((await t.doc()).meta.title, 'Checkout example', 'Alt+2: the tab we edited');
    assert(!(await t.page.isDisabled('#undoBtn')), 'its history came back with it');
  });

  await test('renaming shows on the tab; tabs and their order survive a reload', async t => {
    await t.page.fill('#title', 'Alpha'); await t.page.waitForTimeout(100);
    await t.page.keyboard.press('Enter');
    await t.page.click('#newTabBtn'); await t.page.click('[data-new="system"]'); await t.page.waitForTimeout(250);
    await t.page.fill('#title', 'Beta'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(100);
    const titles = () => t.page.$$eval('.dtab .tt', els => els.map(e => e.textContent));
    const before = await titles();
    assert(before.indexOf('Alpha') >= 0 && before.indexOf('Beta') === before.indexOf('Alpha') + 1, 'new tab opens right after the current one: ' + before);
    // drag Beta to the front
    const b = await t.box('.dtab:has-text("Beta")'), f = await t.box('.dtab');
    await t.page.mouse.move(b.x + 20, b.y + 10); await t.page.mouse.down();
    await t.page.mouse.move(b.x - 40, b.y + 10, { steps: 4 }); await t.page.mouse.move(f.x + 4, f.y + 10, { steps: 6 }); await t.page.mouse.up();
    await t.page.waitForTimeout(200);
    eq((await titles())[0], 'Beta', 'dragged to the front');
    await t.page.reload(); await t.page.waitForTimeout(700);
    eq((await titles()).join('|'), (await (async () => ['Beta', ...before.filter(x => x !== 'Beta')])()).join('|'), 'same tabs, same order');
    eq(await t.page.inputValue('#title'), 'Beta', 'the active tab is reopened');
  });

  await test('projects: closing a tab keeps the diagram in the project; the last tab has no close button', async t => {
    const n = await t.page.$$eval('.dtab', els => els.length);
    while (await t.page.$$eval('.dtab', els => els.length) > 1) { await t.page.keyboard.press('Alt+w'); await t.page.waitForTimeout(250); }
    eq(await t.page.$$eval('.dtab [data-close]', els => els.length), 0, 'the last tab can\'t be closed');
    await t.page.keyboard.press('Alt+w'); await t.page.waitForTimeout(250);
    eq(await t.page.$$eval('.dtab', els => els.length), 1, 'still one tab');
    await t.page.click('#drawerBtn'); await t.page.waitForTimeout(250);
    eq(await t.page.$$eval('#drawer .prow.on .ditem', els => els.length), n, 'every diagram is still in the project');
  });

  // ---- sequence diagrams ----
  const newSeq = async t => { await t.page.click('#newTabBtn'); await t.page.click('[data-new="sequence"]'); await t.page.waitForTimeout(350); };
  const addParts = async (t, names) => { for (const n of names) { await t.page.keyboard.press('p'); await t.page.waitForTimeout(150); await t.page.keyboard.type(n); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(120); } await t.page.keyboard.press('Escape'); await t.page.waitForTimeout(150); };
  const heads = t => t.page.$$eval('[data-head]', els => Object.fromEntries(els.map(e => { const r = e.getBoundingClientRect(); return [e.dataset.head, { x: r.x + r.width / 2, y: r.y + r.height }]; })));
  const dragLife = async (t, a, b, y) => { await t.page.mouse.move(a.x, y); await t.page.mouse.down(); await t.page.mouse.move((a.x + b.x) / 2, y + 2, { steps: 4 }); await t.page.mouse.move(b.x, y + 2, { steps: 3 }); await t.page.mouse.up(); await t.page.waitForTimeout(200); };
  const msgs = async t => (await t.doc()).model.rows.filter(r => r.t === 'msg').map(r => `${r.from}>${r.to}:${r.label}`);

  await test('sequence: drag between lifelines adds a message where you let go, then type its label', async t => {
    await newSeq(t);
    assert(await t.page.isVisible('#seqEmpty'), 'empty state explains what to do');
    eq(await t.page.getAttribute('#app', 'data-kind'), 'sequence');
    await addParts(t, ['Browser', 'API', 'Database']);
    const h = await heads(t);
    eq(Object.keys(h).join(','), 'browser,api,database', 'ids follow the names');
    await dragLife(t, h.browser, h.api, h.browser.y + 60);
    await t.page.keyboard.type('POST /orders'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(150);
    await dragLife(t, h.api, h.database, h.browser.y + 160);
    await t.page.keyboard.type('insert order'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(150);
    // a third one dropped above the first goes first
    // onto its own lifeline: out and back
    await t.page.mouse.move(h.browser.x, h.browser.y + 12); await t.page.mouse.down(); await t.page.mouse.move(h.browser.x + 50, h.browser.y + 14, { steps: 4 }); await t.page.mouse.move(h.browser.x + 3, h.browser.y + 14, { steps: 4 }); await t.page.mouse.up(); await t.page.waitForTimeout(200);
    await t.page.keyboard.type('validate'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(150);
    eq((await msgs(t)).join(' | '), 'browser>browser:validate | browser>api:POST /orders | api>database:insert order');
    await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(150);
    eq((await msgs(t)).length, 3, 'undo takes back the label first');
    await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(150);
    eq((await msgs(t)).length, 2, 'then the message');
  });

  await test('sequence: drag a message to move it; drag a lifeline head to reorder', async t => {
    await newSeq(t); await addParts(t, ['A', 'B', 'C']);
    const h = await heads(t);
    await dragLife(t, h.a, h.b, h.a.y + 50); await t.page.keyboard.type('one'); await t.page.keyboard.press('Enter');
    await dragLife(t, h.b, h.c, h.a.y + 150); await t.page.keyboard.type('two'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(150);
    const two = await t.box('.sq-msg:has-text("two") .sq-label');
    await t.page.mouse.move(two.x + 10, two.y + two.height + 6); await t.page.mouse.down();
    await t.page.mouse.move(two.x + 10, two.y - 40, { steps: 4 }); await t.page.mouse.move(two.x + 10, h.a.y + 5, { steps: 4 }); await t.page.mouse.up(); await t.page.waitForTimeout(200);
    eq((await msgs(t)).join(' | '), 'b>c:two | a>b:one', 'moved above');
    const hc = (await heads(t)).c;
    await t.page.mouse.move(hc.x, hc.y - 20); await t.page.mouse.down(); await t.page.mouse.move(hc.x - 100, hc.y - 20, { steps: 4 }); await t.page.mouse.move(h.a.x - 80, hc.y - 20, { steps: 6 }); await t.page.mouse.up(); await t.page.waitForTimeout(200);
    eq((await t.doc()).model.participants.map(p => p.id).join(','), 'c,a,b', 'C dragged to the front');
  });

  await test('sequence: shift-select messages and wrap them in a loop; deleting the block keeps them', async t => {
    await newSeq(t); await addParts(t, ['A', 'B']);
    const h = await heads(t);
    for (const [y, l] of [[50, 'one'], [120, 'two'], [190, 'three']]) { await dragLife(t, h.a, h.b, h.a.y + y); await t.page.keyboard.type(l); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(120); }
    await t.page.click('.sq-msg:has-text("one") .sq-label'); await t.page.click('.sq-msg:has-text("two") .sq-label', { modifiers: ['Shift'] });
    await t.page.click('[data-seqtool="loop"]'); await t.page.waitForTimeout(200);
    await t.page.keyboard.type('for each item'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(150);
    const rows = (await t.doc()).model.rows.map(r => r.t === 'msg' ? r.label : r.t === 'open' ? `loop[${r.guard}]` : r.t);
    eq(rows.join(','), 'loop[for each item],one,two,close,three');
    assert(await t.page.$('.sq-block .sq-bkind'), 'block drawn');
    await t.page.click('.sq-bkind'); await t.page.keyboard.press('Delete'); await t.page.waitForTimeout(150);
    eq((await t.doc()).model.rows.map(r => r.label ?? r.t).join(','), 'one,two,three', 'unwrapped, messages kept');
  });

  await test('sequence: the Code tab converts pasted Mermaid; a typo keeps the last good drawing', async t => {
    await newSeq(t);
    await t.page.keyboard.press('i'); await t.page.waitForTimeout(250);
    await t.page.click('[data-sqtab="code"]'); await t.page.waitForSelector('.sq-cm .cm-content');
    await t.page.click('.sq-cm .cm-content');
    await t.page.evaluate(() => {
      const text = 'sequenceDiagram\n  actor U as User\n  U->>S: GET /items\n  S-->>U: 200 OK\n';
      const dt = new DataTransfer(); dt.setData('text/plain', text);
      document.querySelector('.sq-cm .cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await t.page.waitForTimeout(500);
    const code = await t.page.textContent('.sq-cm .cm-content');
    assert(code.includes('U -> S: GET /items') && code.includes('S --> U: 200 OK'), 'converted to this format: ' + code);
    eq((await msgs(t)).join(' | '), 'U>S:GET /items | S>U:200 OK', 'drawing follows the code');
    await t.page.keyboard.press('Control+End'); await t.page.keyboard.type('\nU -> : oops'); await t.page.waitForTimeout(600);
    assert((await t.page.textContent('.sq-status')).includes('1 problem'), 'says there is a problem');
    eq((await msgs(t)).length, 2, 'drawing keeps the last valid version');
    eq(await t.page.$$eval('.sq-msg', e => e.length), 2);
  });

  await test('sequence: made from a request path is linked and timed; the component says where it appears', async t => {
    await t.clickNode('n3'); // checkout-api
    await t.page.click('#newTabBtn'); await t.page.waitForTimeout(100);
    assert((await t.page.textContent('#nmPathSub')).includes('checkout-api'));
    await t.page.click('[data-nm="seq-path"]'); await t.page.waitForTimeout(600);
    eq(await t.page.getAttribute('#app', 'data-kind'), 'sequence');
    const d = await t.doc();
    eq(d.kind, 'sequence'); assert(d.model.uses, 'uses the system diagram');
    assert(d.model.participants.length >= 4 && d.model.participants.every(p => p.ref), 'all lifelines linked');
    assert((await t.page.textContent('#verdict')).startsWith('End to end ~'), 'end-to-end time from the model');
    assert(await t.page.$$eval('.sq-time', e => e.length) > 0, 'running time per call');
    // back on the system diagram the component links to the sequence
    await t.page.keyboard.press('Alt+2'); await t.page.waitForTimeout(300);   // the system tab it was made from (setup opens the example twice)
    await t.clickNode('n3');
    const chip = await t.page.$('.appears [data-opentab]'); assert(chip, 'appears in');
    await chip.click(); await t.page.waitForTimeout(300);
    eq(await t.page.getAttribute('#app', 'data-kind'), 'sequence', 'the chip opens the sequence');
  });

  await test('sequence: survives a reload; the panel edits a message and adds its reply', async t => {
    await newSeq(t); await addParts(t, ['Web', 'Api']);
    const h = await heads(t);
    await dragLife(t, h.web, h.api, h.web.y + 60); await t.page.keyboard.type('GET /x'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(200);
    await t.page.click('.sq-msg .sq-label'); await t.page.waitForTimeout(300);
    await t.page.click('[data-sq="add-reply"]'); await t.page.waitForTimeout(200);
    await t.page.keyboard.type('200 OK'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(200);
    await t.page.click('.sq-msg:has-text("GET /x") .sq-label'); await t.page.waitForTimeout(250);
    await t.page.click('[data-sqstyle="async"]'); await t.page.waitForTimeout(150);
    const rows = (await t.doc()).model.rows;
    eq(rows.map(r => `${r.from}${r.style === 'reply' ? '-->' : r.style === 'async' ? '->>' : '->'}${r.to}:${r.label}`).join(' | '), 'web->>api:GET /x | api-->web:200 OK');
    await t.page.reload(); await t.page.waitForTimeout(800);
    eq(await t.page.getAttribute('#app', 'data-kind'), 'sequence', 'reopens as a sequence');
    eq(await t.page.$$eval('.sq-msg', e => e.length), 2);
  });

  // ---- class diagrams ----
  const newCls = async t => { await t.page.click('#newTabBtn'); await t.page.click('[data-new="class"]'); await t.page.waitForTimeout(350); };
  const pasteOnCanvas = (t, text) => t.page.evaluate(x => { const dt = new DataTransfer(); dt.setData('text/plain', x); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, text);
  const JAVA = `public class Order extends Entity implements Auditable {
  private final UUID id;
  private List<LineItem> items;
  public Money total() { return null; }
}
public record LineItem(String sku, Money price) {}
public record Money(long amountMinor, String currency) {}
public interface Auditable { Instant createdAt(); }
abstract class Entity { protected long version; }`;

  await test('class: pasting Java anywhere reads classes, members and relations', async t => {
    await newCls(t);
    assert(await t.page.isVisible('#clsEmpty'));
    await pasteOnCanvas(t, JAVA); await t.page.waitForTimeout(500);
    const d = await t.doc();
    eq(d.kind, 'class');
    eq(d.model.classes.map(c => `${c.kind}:${c.name}`).join(','), 'class:Order,record:LineItem,record:Money,interface:Auditable,abstract:Entity');
    const rels = d.model.relations.map(r => `${r.from} ${r.type} ${r.to}`).sort();
    eq(rels.join(' | '), ['LineItem assoc Money', 'Order assoc LineItem', 'Order implement Auditable', 'Order inherit Entity'].sort().join(' | '));
    eq(Object.keys(d.layout.positions).length, 5, 'every class placed');
    eq(await t.page.$$eval('.cl-box', e => e.length), 5);
    // boxes don't overlap
    const boxes = await t.page.$$eval('.cl-box .cl-body', els => els.map(e => e.getBoundingClientRect()).map(r => ({ x: r.x, y: r.y, w: r.width, h: r.height })));
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) { const A = boxes[a], B = boxes[b]; assert(A.x + A.w <= B.x || B.x + B.w <= A.x || A.y + A.h <= B.y || B.y + B.h <= A.y, 'no overlap'); }
    eq((await t.page.textContent('#verdict')), '5 classes · 4 relations');
  });

  await test('class: drag a box\'s dot onto another class and pick the relation', async t => {
    await newCls(t);
    await t.page.click('[data-clstool="class"]'); await t.page.waitForTimeout(200); await t.page.keyboard.type('Card'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(150);
    await t.page.click('[data-clstool="interface"]'); await t.page.waitForTimeout(200); await t.page.keyboard.type('Chargeable'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(150);
    eq((await t.doc()).model.classes.map(c => c.name).join(','), 'Card,Chargeable');
    await t.page.hover('[data-class="Card"] .cl-body');
    const port = await t.center('[data-class="Card"] .cl-port'), target = await t.center('[data-class="Chargeable"] .cl-body');
    await t.page.mouse.move(port.x, port.y); await t.page.mouse.down(); await t.page.mouse.move((port.x + target.x) / 2, (port.y + target.y) / 2, { steps: 5 }); await t.page.mouse.move(target.x, target.y, { steps: 5 }); await t.page.mouse.up(); await t.page.waitForTimeout(200);
    assert(await t.page.isVisible('#clsRelPick'), 'picker shows');
    assert((await t.page.textContent('#clsRelPick .sug')).includes('implements'), 'implements suggested for an interface');
    await t.page.click('#clsRelPick .sug'); await t.page.waitForTimeout(200);
    const r = (await t.doc()).model.relations; eq(r.length, 1); eq(`${r[0].from} ${r[0].type} ${r[0].to}`, 'Card implement Chargeable');
    await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(150);
    eq((await t.doc()).model.relations.length, 0, 'undoable');
  });

  await test('class: add members by typing one line; renaming a class updates its references', async t => {
    await newCls(t); await pasteOnCanvas(t, JAVA); await t.page.waitForTimeout(400);
    await t.page.click('[data-class="Order"] .cl-name'); await t.page.waitForTimeout(300);
    await t.page.fill('[data-cladd="f"]', '- discount: Money'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(200);
    await t.page.fill('[data-cladd="m"]', 'cancel(reason: String)'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(200);
    const o = (await t.doc()).model.classes.find(c => c.name === 'Order');
    assert(o.fields.some(f => f.name === 'discount' && f.type === 'Money' && f.vis === '-'), JSON.stringify(o.fields));
    assert(o.methods.some(m => m.name === 'cancel' && m.params === 'reason: String' && m.vis === '+'), JSON.stringify(o.methods));
    await t.page.dblclick('[data-class="Money"] .cl-name'); await t.page.waitForTimeout(150);
    await t.page.keyboard.press('Control+a'); await t.page.keyboard.type('Amount'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(250);
    const d = await t.doc();
    assert(d.model.classes.some(c => c.name === 'Amount') && !d.model.classes.some(c => c.name === 'Money'));
    assert(d.model.classes.find(c => c.name === 'Order').fields.some(f => f.type === 'Amount'), 'member types follow the rename');
    assert(d.model.relations.some(r => r.to === 'Amount'), 'relations follow the rename');
    assert(d.layout.positions.Amount, 'position kept');
  });

  await test('class: the Code tab edits the diagram and converts pasted Mermaid', async t => {
    await newCls(t);
    await t.page.keyboard.press('i'); await t.page.waitForTimeout(200);
    await t.page.click('[data-cltab="code"]'); await t.page.waitForSelector('.cl-cm .cm-content');
    await t.page.click('.cl-cm .cm-content');
    await t.page.keyboard.insertText('class Basket {\n  - id: UUID\n}\nBasket *-- "*" Item : items\n');
    await t.page.waitForTimeout(500);
    let d = await t.doc();
    eq(d.model.classes.map(c => c.name).join(','), 'Basket,Item'); eq(d.model.relations[0].type, 'composition'); eq(d.model.relations[0].toMult, '*');
    eq(await t.page.$$eval('.cl-box', e => e.length), 2, 'drawn');
    await t.page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'classDiagram\n  class Item {\n    +String sku\n    +price() Money\n  }\n  Item <|-- GiftCard'); document.querySelector('.cl-cm .cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    await t.page.waitForTimeout(500);
    d = await t.doc();
    const item = d.model.classes.find(c => c.name === 'Item');
    assert(item.fields.some(f => f.name === 'sku' && f.type === 'String'), JSON.stringify(item));
    assert(d.model.relations.some(r => r.from === 'GiftCard' && r.type === 'inherit' && r.to === 'Item'));
    assert((await t.page.textContent('.cl-cm .cm-content')).includes('GiftCard --|> Item'), 'printed in this format');
    await t.page.keyboard.press('Control+End'); await t.page.keyboard.type('\nBasket ~~ x'); await t.page.waitForTimeout(500);
    assert((await t.page.textContent('.sq-status')).includes('1 problem'));
  });

  await test('class: generated from the example\'s database tables; survives a reload', async t => {
    await t.page.click('#newTabBtn'); await t.page.waitForTimeout(150);
    await t.page.click('#nmFromExtra button:has-text("payments-db tables")'); await t.page.waitForTimeout(500);
    let d = await t.doc();
    eq(d.kind, 'class'); eq(d.model.classes.map(c => c.name).join(','), 'Payments,Refunds');
    assert(d.model.relations.some(r => r.from === 'Refunds' && r.to === 'Payments' && r.label === 'paymentId'));
    await t.page.reload(); await t.page.waitForTimeout(800);
    eq(await t.page.getAttribute('#app', 'data-kind'), 'class');
    eq(await t.page.$$eval('.cl-box', e => e.length), 2);
  });

  // ---- regressions found by persona testing ----
  await test('regression: sequence and class exports import back as new tabs', async t => {
    for (const kind of ['sequence', 'class']) {
      await t.page.click('#newTabBtn'); await t.page.click(`[data-new="${kind}"]`); await t.page.waitForTimeout(300);
      await t.page.keyboard.press(kind === 'sequence' ? 'p' : '1'); await t.page.waitForTimeout(200); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(150);
      const tabs = await t.page.$$eval('.dtab', e => e.length);
      await t.page.click('#ioBtn'); await t.page.click('#loadJson'); await t.page.waitForTimeout(400);
      eq(await t.page.$$eval('.dtab', e => e.length), tabs + 1, kind + ' import opened a tab');
      eq(await t.page.getAttribute('#app', 'data-kind'), kind);
    }
  });

  await test('regression: changing an environment kind keeps the editor working', async t => {
    await t.page.keyboard.press('e'); await t.page.waitForTimeout(300);
    await t.page.selectOption('#sheetBody [data-path="kind"]', 'vpc'); await t.page.waitForTimeout(200);
    eq((await t.doc()).model.containers.slice(-1)[0].kind, 'vpc', 'stores the key');
    const n0 = (await t.doc()).model.nodes.length;
    await t.page.click('[data-add="service"]'); await t.page.waitForTimeout(250);
    eq((await t.doc()).model.nodes.length, n0 + 1, 'still editable');
  });

  await test('regression: title renames undo; focusing a field keeps redo', async t => {
    await t.page.fill('#title', 'Renamed'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(150);
    await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(150);
    eq(await t.page.inputValue('#title'), 'Checkout example', 'one undo restores the title');
    await t.page.click('[data-add="service"]'); await t.page.waitForTimeout(200);
    const n = (await t.doc()).model.nodes.length;
    await t.page.keyboard.press('Escape'); await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(150);
    await t.page.click('#title'); await t.page.keyboard.press('Escape'); await t.page.waitForTimeout(100);
    await t.page.keyboard.press('Control+Shift+z'); await t.page.waitForTimeout(200);
    eq((await t.doc()).model.nodes.length, n, 'redo still works after just focusing the title');
    await t.page.click('#title'); await t.page.keyboard.press('Enter'); await t.page.keyboard.press('o'); await t.page.waitForTimeout(100);
    eq(await t.page.inputValue('#title'), 'Checkout example', 'Enter leaves the title box');
  });

  await test('regression: blank names revert, negatives read as 0, stat tiles follow edits', async t => {
    await t.clickNode('n3');
    await t.page.fill('#sheetBody [data-path="name"]', ''); await t.page.keyboard.press('Tab'); await t.page.waitForTimeout(150);
    eq((await t.node('n3')).name, 'checkout-api', 'blank name reverted');
    const util = () => t.page.$eval('#sheetBody .stat-tile.ok .v, #sheetBody .stat-tile.warn .v, #sheetBody .stat-tile.crit .v', e => e.textContent);
    const before = await util();
    await t.page.fill('#sheetBody [data-path="instances"]', '20'); await t.page.waitForTimeout(150);
    assert(await util() !== before, 'utilisation tile updated while typing');
    await t.page.fill('#sheetBody [data-path="latency"]', '-100'); await t.page.keyboard.press('Tab'); await t.page.waitForTimeout(150);
    eq((await t.node('n3')).latency, 0, 'stored as 0');
    eq(await t.page.inputValue('#sheetBody [data-path="latency"]'), '0', 'field shows 0');
    assert(!/(^|[\s/(])[-−]\d/.test(await t.page.textContent('[data-node="n3"]')), 'no negative numbers on the canvas');
  });

  await test('regression: double-clicking a lifeline head renames it; panel Label takes a click after drawing', async t => {
    await t.page.click('#newTabBtn'); await t.page.click('[data-new="sequence"]'); await t.page.waitForTimeout(300);
    for (const n of ['A', 'B']) { await t.page.keyboard.press('p'); await t.page.waitForTimeout(150); await t.page.keyboard.type(n); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(120); }
    await t.page.keyboard.press('Escape');
    const ha = await t.center('[data-head="a"] rect'); await t.page.mouse.dblclick(ha.x, ha.y); await t.page.waitForTimeout(200);
    assert(await t.page.isVisible('#seqEdit'), 'rename opened');
    await t.page.keyboard.press('Control+a'); await t.page.keyboard.type('Alpha'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(150);
    assert((await t.doc()).model.participants.some(p => p.name === 'Alpha'));
    const h = await t.page.$$eval('[data-head]', els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height }; }));
    await t.page.mouse.move(h[0].x, h[0].y + 60); await t.page.mouse.down(); await t.page.mouse.move(h[1].x, h[0].y + 62, { steps: 6 }); await t.page.mouse.up(); await t.page.waitForTimeout(250);
    await t.page.click('#sheetBody [data-sqf="label"]'); await t.page.waitForTimeout(150);
    await t.page.keyboard.type('POST /settle'); await t.page.waitForTimeout(150);
    eq((await t.doc()).model.rows.find(r => r.t === 'msg').label, 'POST /settle');
    eq((await t.doc()).model.participants.length, 2, 'no shortcut fired');
  });

  await test('regression: renaming a table moves its foreign keys', async t => {
    const dbId = (await t.doc()).model.nodes.find(n => n.kind === 'db').id;
    await t.clickNode(dbId);
    await t.page.click('#sheetBody [data-tab="schema"]').catch(() => {}); await t.page.waitForTimeout(200);
    const input = await t.page.$('#sheetBody [data-path="tables.0.name"]');
    assert(input, 'table name field');
    await input.fill('charges'); await t.page.waitForTimeout(150);
    const db = await t.node(dbId);
    assert(db.tables[1].columns.some(c => c.references === 'charges.id'), JSON.stringify(db.tables[1].columns));
  });

  await test('regression: signed-out drawer explains instead of leaving for GitHub', async t => {
    await t.page.click('#drawerBtn'); await t.page.waitForTimeout(200);
    assert(t.page.url().startsWith(BASE), 'stayed on the app');
    assert(await t.page.isVisible('#drawer [data-signin]'), 'offers sign-in');
  });

  await test('regression: phone header and toolbar fit the screen', async t => {
    const { devices } = require('playwright');
    const ctx = await t.page.context().browser().newContext({ ...devices['iPhone 13'] });
    const p = await ctx.newPage(); await p.goto(BASE); await p.waitForTimeout(700);
    const w = await p.evaluate(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth, top: document.getElementById('top').getBoundingClientRect().height, stage: document.getElementById('stage').getBoundingClientRect().height }));
    await ctx.close();
    eq(w.inner, 390, 'no zoom-out'); assert(w.scroll <= 390, 'no sideways scroll: ' + w.scroll);
    assert(w.top < 130, 'header stays compact: ' + w.top);
    assert(w.stage > 300, 'canvas has room: ' + w.stage);
  });

  await test('regression: hostile files never run script (system, sequence, class)', async t => {
    await t.page.evaluate(() => { window.__alerts = 0; window.alert = () => { window.__alerts++; }; });
    const x = '"><img src=x onerror=alert(1)>';
    const files = [
      { version: 4, kind: 'system', meta: { title: 'h' }, model: { nodes: [{ id: 'a', kind: x, name: x }, { id: 'b', kind: 'service', name: 'b' }], edges: [{ id: x, from: 'a', to: 'b', calls: x }], containers: [{ id: 'c', kind: x, name: x }], links: [] }, layout: { positions: { a: { x: 'abc', y: null } } } },
      { version: 4, kind: 'sequence', meta: null, model: { participants: [{ id: x, name: x }, { id: 'b', name: 'b' }], rows: [{ t: 'msg', id: x, from: x, to: 'b', style: x, label: x }, { t: 'open', id: 'o', kind: x, guard: x }, { t: 'close', id: 'c' }] }, layout: {} },
      { version: 4, kind: 'class', meta: { title: x }, model: { classes: [{ name: x, kind: x, fields: [{ vis: x, name: 'f', type: x }], methods: [] }, { name: 'B', kind: 'class', fields: [], methods: [] }], relations: [{ id: x, from: 'B', to: 'B', type: x, label: x }] }, layout: { positions: {} } },
    ];
    for (const f of files) {
      await t.page.click('#ioBtn'); await t.page.fill('#json', JSON.stringify(f)); await t.page.click('#loadJson'); await t.page.waitForTimeout(400);
      // select everything selectable to render panels too
      for (const sel of ['g.node', '.sq-msg', '.sq-block .sq-bkind', '[data-class]', '[data-rel]']) { const el = await t.page.$(sel); if (el) { await el.click({ force: true }).catch(() => {}); await t.page.waitForTimeout(150); } }
    }
    eq(await t.page.evaluate(() => window.__alerts), 0, 'no script ran');
    eq(await t.page.evaluate(() => document.querySelectorAll('#app img[src="x"]').length), 0, 'no injected elements');
    assert(!(await t.page.textContent('#zoomPct')).includes('NaN'), 'no NaN view');
  });

  await test('regression: the same node ids in different tabs never wedge the canvas', async t => {
    await t.page.click('#newTabBtn'); await t.page.click('[data-new="sequence"]'); await t.page.waitForTimeout(250);
    await t.page.click('#newTabBtn'); await t.page.click('[data-new="system"]'); await t.page.waitForTimeout(250);
    await t.page.reload(); await t.page.waitForTimeout(700);
    await t.page.click('.dtab:nth-child(2)'); await t.page.waitForTimeout(400);
    const n0 = (await t.doc()).model.nodes.length;
    await t.page.click('[data-add="service"]'); await t.page.waitForTimeout(250);
    eq((await t.doc()).model.nodes.length, n0 + 1, 'still editable');
    eq(await t.page.$$eval('#nodes g.node', e => e.length), n0 + 1, 'drawing matches the model');
  });

  await test('regression: ⌘A then drag moves everything; Delete or undo mid-drag waits', async t => {
    await t.page.keyboard.press('Control+a');
    const before = await t.node('n3'), b = await t.box('[data-node="n3"] rect.body');
    await t.page.mouse.move(b.x + 40, b.y + 40); await t.page.mouse.down(); await t.page.mouse.move(b.x + 80, b.y + 60, { steps: 5 });
    await t.page.keyboard.press('Delete'); await t.page.keyboard.press('Control+z');
    await t.page.mouse.move(b.x + 120, b.y + 80, { steps: 5 }); await t.page.mouse.up(); await t.page.waitForTimeout(200);
    const after = await t.node('n3');
    assert(after, 'not deleted mid-drag'); assert(after.x > before.x, 'moved');
    const n2 = await t.node('n2'); assert(n2.x !== undefined, 'others still there');
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


  // ---- copy / cut / paste ----
  const clip = async t => { await t.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }); };
  const press = async (t, k) => { await t.page.keyboard.press(k); await t.page.waitForTimeout(200); };
  const clipText = t => t.page.evaluate(() => navigator.clipboard.readText());

  await test('copy: ⌘C/⌘V copies components with the connections between them; one undo removes the paste', async t => {
    await clip(t);
    const before = await t.doc();
    const e = before.model.edges[0];
    await t.clickNode(e.from); await t.clickNode(e.to, ['Shift']);
    await press(t, 'Control+c');
    const text = await clipText(t);
    assert(text.includes('"cistem-clipboard"') && text.includes(e.from), 'readable JSON on the system clipboard: ' + e.from + ' ' + JSON.stringify(text.slice(0, 400)));
    await t.page.mouse.move(5, 5);   // off the canvas: lands stepped from the originals
    await press(t, 'Control+v');
    let d = await t.doc();
    eq(d.model.nodes.length, before.model.nodes.length + 2, 'two components pasted');
    eq(d.model.edges.length, before.model.edges.length + 1, 'with the connection between them');
    const src = await t.node(e.from), copy = d.model.nodes.find(n => !before.model.nodes.some(o => o.id === n.id) && n.name === src.name);
    assert(copy, 'same name'); eq(d.layout.positions[copy.id].x, src.x + 32, 'offset right'); eq(d.layout.positions[copy.id].y, src.y + 32, 'offset down');
    eq(copy.container ?? null, src.container ?? null, 'kept in the same environment');
    await press(t, 'Control+v');
    d = await t.doc(); eq(d.model.nodes.length, before.model.nodes.length + 4, 'pasting again pastes again');
    assert(d.model.nodes.some(n => d.layout.positions[n.id].x === src.x + 64), 'stepped further');
    await press(t, 'Control+z');
    eq((await t.doc()).model.nodes.length, before.model.nodes.length + 2, 'one undo per paste');
  });

  await test('copy: paste lands at the pointer; ⌘X cuts', async t => {
    await clip(t);
    const n0 = (await t.doc()).model.nodes.length;
    await t.clickNode('n4');
    await press(t, 'Control+x');
    assert(!(await t.doc()).model.nodes.some(n => n.id === 'n4'), 'cut removes it');
    const p = await t.emptyCanvasPoint();
    await t.page.mouse.move(p.x, p.y); await press(t, 'Control+v');
    const d = await t.doc(); eq(d.model.nodes.length, n0, 'back');
    const pasted = d.model.nodes[d.model.nodes.length - 1];
    const box = await t.box(`[data-node="${pasted.id}"] rect.body`);
    // (near the bottom edge the view then scrolls it fully into sight, so allow for that vertically)
    assert(Math.abs(box.x - p.x) < 20 && Math.abs(box.y - p.y) < 60, `at the pointer (${box.x},${box.y} vs ${p.x},${p.y})`);
    eq((await t.sel()) !== null, true, 'the pasted component is selected');
  });

  await test('copy: components paste into another tab; typing in a field is left alone', async t => {
    await clip(t);
    await t.clickNode('n4'); await press(t, 'Control+c');
    await t.page.click('#newTabBtn'); await t.page.click('[data-new="system"]'); await t.page.waitForTimeout(350);
    const n0 = (await t.doc()).model.nodes.length;
    await t.page.mouse.move(5, 5); await press(t, 'Control+v');
    eq((await t.doc()).model.nodes.length, n0 + 1, 'pasted into the new tab');
    await t.page.click('#title'); await press(t, 'Control+v');
    eq((await t.doc()).model.nodes.length, n0 + 1, 'pasting into the title field pastes text, not components');
  });

  await test('copy: sequence messages and lifelines copy, paste below the selection, and paste as text from elsewhere', async t => {
    await clip(t);
    await newSeq(t); await addParts(t, ['A', 'B']);
    const h = await heads(t);
    await dragLife(t, h.a, h.b, h.a.y + 50); await t.page.keyboard.type('one'); await t.page.keyboard.press('Enter');
    await dragLife(t, h.b, h.a, h.a.y + 150); await t.page.keyboard.type('two'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(150);
    await t.page.click('.sq-msg:has-text("one") .sq-label'); await t.page.waitForTimeout(150);
    await press(t, 'Control+c');
    assert((await clipText(t)).includes('a -> b: one'), 'text format on the clipboard');
    await press(t, 'Control+v');
    eq((await msgs(t)).join(' | '), 'a>b:one | a>b:one | b>a:two', 'pasted right below');
    await t.page.click('[data-head="b"]'); await t.page.waitForTimeout(150);
    await press(t, 'Control+c'); await press(t, 'Control+v');
    eq((await t.doc()).model.participants.map(p => p.id).join(','), 'a,b,b2', 'a lifeline pastes as a new lifeline');
    await pasteOnCanvas(t, 'web -> a: GET /x\na --> web: 200'); await t.page.waitForTimeout(200);
    const d = await t.doc();
    assert(d.model.participants.some(p => p.id === 'web'), 'missing lifelines added');
    eq((await msgs(t)).slice(-2).join(' | '), 'web>a:GET /x | a>web:200');
  });

  await test('copy: classes copy with their relations; taken names get "Copy"', async t => {
    await clip(t);
    await newCls(t);
    await pasteOnCanvas(t, JAVA); await t.page.waitForTimeout(400);
    await t.page.click('.cl-box[data-class="Order"] .cl-body', { position: { x: 20, y: 10 } }); await t.page.waitForTimeout(150);
    await t.page.click('.cl-box[data-class="Entity"] .cl-body', { position: { x: 20, y: 10 }, modifiers: ['Shift'] }); await t.page.waitForTimeout(150);
    await press(t, 'Control+c');
    await press(t, 'Control+v');
    const d = await t.doc();
    assert(d.model.classes.some(c => c.name === 'OrderCopy') && d.model.classes.some(c => c.name === 'EntityCopy'), d.model.classes.map(c => c.name).join());
    assert(d.model.relations.some(r => r.from === 'OrderCopy' && r.to === 'EntityCopy' && r.type === 'inherit'), 'relation between the copies');
    eq(d.model.classes.find(c => c.name === 'OrderCopy').fields.length, d.model.classes.find(c => c.name === 'Order').fields.length, 'members copied');
    await press(t, 'Control+v');
    assert((await t.doc()).model.classes.some(c => c.name === 'OrderCopy2'), 'again → OrderCopy2');
  });

  await test('copy: right-click menu copies, pastes where you clicked, duplicates and deletes', async t => {
    const n0 = (await t.doc()).model.nodes.length;
    const b = await t.box('[data-node="n4"] rect.body');
    await t.page.mouse.click(b.x + 20, b.y + 40, { button: 'right' }); await t.page.waitForTimeout(150);
    assert(await t.page.isVisible('#ctxMenu'), 'menu opens');
    await t.page.click('[data-ctx="copy"]'); await t.page.waitForTimeout(150);
    assert(!(await t.page.isVisible('#ctxMenu')), 'closes after choosing');
    const p = await t.emptyCanvasPoint(); p.y -= 150;   // room below so the pasted box needn't be panned into view
    await t.page.mouse.click(p.x, p.y, { button: 'right' }); await t.page.waitForTimeout(150);
    assert(await t.page.isDisabled('[data-ctx="copy"]'), 'nothing selected on empty canvas: Copy is off');
    await t.page.click('[data-ctx="paste"]'); await t.page.waitForTimeout(200);
    let d = await t.doc(); eq(d.model.nodes.length, n0 + 1, 'pasted');
    const pasted = d.model.nodes[d.model.nodes.length - 1];
    const pb = await t.box(`[data-node="${pasted.id}"] rect.body`);
    assert(Math.abs(pb.x - p.x) < 20 && Math.abs(pb.y - p.y) < 20, 'where you clicked');
    await t.page.mouse.click(pb.x + 20, pb.y + 40, { button: 'right' }); await t.page.waitForTimeout(150);
    await t.page.click('[data-ctx="dup"]'); await t.page.waitForTimeout(200);
    eq((await t.doc()).model.nodes.length, n0 + 2, 'duplicated');
    const b4 = await t.box('[data-node="n4"] rect.body');
    await t.page.mouse.click(b4.x + 20, b4.y + 40, { button: 'right' }); await t.page.waitForTimeout(150);
    await t.page.click('[data-ctx="del"]'); await t.page.waitForTimeout(200);
    assert(!(await t.doc()).model.nodes.some(n => n.id === 'n4'), 'deleted');
    await t.page.mouse.click(p.x, p.y, { button: 'right' }); await t.page.waitForTimeout(150);
    await t.page.keyboard.press('Escape'); await t.page.waitForTimeout(100);
    assert(!(await t.page.isVisible('#ctxMenu')), 'Escape closes it');
  });


  // ---- found testing the React rewrite ----
  await test('regression: undo and redo in a sequence while its Code tab is open', async t => {
    await t.page.click('#newTabBtn'); await t.page.click('[data-new="sequence"]'); await t.page.waitForTimeout(300);
    await t.page.click('#panelBtn'); await t.page.waitForTimeout(300);
    await t.page.click('[data-sqtab="code"]'); await t.page.waitForTimeout(600);
    await t.page.click('.sq-cm .cm-content'); await t.page.keyboard.type('a -> b: one'); await t.page.waitForTimeout(300);
    await t.page.mouse.click(400, 600); await t.page.waitForTimeout(200);
    const rows = async () => (await t.doc()).model.rows.length;
    eq(await rows(), 1);
    await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(250);
    eq(await rows(), 0, 'undone');
    assert(await t.page.isDisabled('#undoBtn'), 'nothing left to undo');
    await t.page.keyboard.press('Control+Shift+z'); await t.page.waitForTimeout(250);
    eq(await rows(), 1, 'redo brings it back');
  });

  await test('regression: the + menu draws above the details panel', async t => {
    await t.clickNode('n3');
    await t.page.click('#newTabBtn'); await t.page.waitForTimeout(200);
    const onTop = await t.page.$eval('#newMenu', el => { const r = el.getBoundingClientRect(); return [[r.right - 12, r.top + 40], [r.left + 12, r.bottom - 12]].every(([x, y]) => el.contains(document.elementFromPoint(x, y))); });
    assert(onTop, 'nothing covers the menu');
  });

  await test('regression: a diagram is fitted to the view when the page opens', async t => {
    await t.page.reload(); await t.page.waitForTimeout(900);
    const svg = await t.box('#svg');
    for (const id of ['n1', 'n2', 'n3']) {
      const b = await t.box(`[data-node="${id}"] rect.body`);
      assert(b.x >= svg.x && b.x + b.width <= svg.x + svg.width && b.y >= svg.y && b.y + b.height <= svg.y + svg.height, id + ' is in view');
    }
  });


  // ---- notes ----
  const notesIn = async t => { const d = await t.doc(); return (d.model.notes ?? []).map(n => ({ ...n, ...(d.layout.notes?.[n.id] ?? {}) })); };
  const typeNote = async (t, lines) => { for (const [i, l] of lines.entries()) { if (i) await t.page.keyboard.press('Enter'); await t.page.keyboard.type(l); } await t.page.waitForTimeout(150); };
  const leave = async t => { await t.page.mouse.click(t.page.viewportSize().width - 420, 140); await t.page.waitForTimeout(300); };

  await test('notes: a canvas note formats as you type and is saved as markdown', async t => {
    await t.page.click('#addNote'); await t.page.waitForSelector('.cnote.editing .ProseMirror-focused');
    await typeNote(t, ['## Launch plan', 'Hold **4,000 rps** with ==headroom== and `p99`', '[ ] load test', 'sign-off']);
    await t.page.keyboard.press('Enter'); await t.page.keyboard.press('Enter');
    await t.page.keyboard.type('> quoted'); await t.page.keyboard.press('Enter'); await t.page.keyboard.press('Enter');
    await t.page.keyboard.type('/warn'); await t.page.waitForSelector('.note-suggest button'); await t.page.keyboard.press('Enter');
    await t.page.keyboard.type('Ordering per merchant');
    await t.page.keyboard.press('Enter'); await t.page.keyboard.press('Enter');
    await t.page.keyboard.type('see @check'); await t.page.waitForSelector('.note-suggest button'); await t.page.keyboard.press('Enter');
    await leave(t);
    const [n] = await notesIn(t);
    assert(n, 'note saved');
    for (const piece of ['## Launch plan', '**4,000 rps**', '==headroom==', '`p99`', '- [ ] load test', '- [ ] sign-off', '> quoted', '> [!WARNING]\n> Ordering per merchant', '(#cistem:node:'])
      assert(n.text.includes(piece), `has ${JSON.stringify(piece)} in ${JSON.stringify(n.text)}`);
    eq(await t.page.$$eval('.cnote h2', e => e.map(x => x.textContent)).then(x => x[0]), 'Launch plan', 'drawn formatted');
    await t.page.reload(); await t.page.waitForSelector('.cnote .ProseMirror');
    eq((await notesIn(t))[0].text, n.text, 'survives a reload');
  });

  await test('notes: ticking a checkbox works without editing, and undoes in one step', async t => {
    await t.page.click('#addNote'); await t.page.waitForSelector('.cnote.editing .ProseMirror-focused');
    await typeNote(t, ['[ ] first', 'second']); await leave(t);
    await t.page.click('.cnote li[data-checked] input >> nth=1'); await t.page.waitForTimeout(250);
    assert(!(await t.page.$('.cnote.editing')), 'not in edit mode');
    assert((await notesIn(t))[0].text.includes('- [x] second'), 'ticked: ' + JSON.stringify((await notesIn(t))[0]?.text));
    await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(250);
    assert((await notesIn(t))[0].text.includes('- [ ] second'), 'undo unticks');
    await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(250);
    eq((await notesIn(t))[0]?.text, '', 'the next undo takes back all the typing: one step');
    await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(250);
    eq((await notesIn(t)).length, 0, 'and the next removes the note');
  });

  await test('notes: the floating toolbar styles a selection (highlight colour, text colour, bold)', async t => {
    await t.page.click('#addNote'); await t.page.waitForSelector('.cnote.editing .ProseMirror-focused');
    await typeNote(t, ['important bit']);
    await t.page.keyboard.press('Shift+Home'); await t.page.waitForSelector('.note-toolbar.floating');
    await t.page.click('.note-toolbar [data-fmt="highlight"]'); await t.page.click('.note-pop [data-colour="green"]');
    await t.page.click('.note-toolbar [data-fmt="color"]'); await t.page.click('.note-pop [data-colour="red"]');
    await t.page.click('.note-toolbar [data-fmt="bold"]');
    await leave(t);
    const text = (await notesIn(t))[0].text;
    assert(text.includes('<mark data-color="#bbf7d0">') && text.includes('color: #c73a3a') && text.includes('**'), text);
  });

  await test('notes: move, resize, recolour, copy/paste and delete a note', async t => {
    await t.page.click('#addNote'); await t.page.waitForSelector('.cnote.editing .ProseMirror-focused');
    await typeNote(t, ['Drag me']); await leave(t);
    const before = (await notesIn(t))[0];
    const b = await t.box('.cnote');
    await t.page.mouse.move(b.x + 20, b.y + b.height - 12); await t.page.mouse.down();
    await t.page.mouse.move(b.x + 120, b.y + b.height + 68, { steps: 5 }); await t.page.mouse.up(); await t.page.waitForTimeout(200);
    let n = (await notesIn(t))[0];
    assert(n.x > before.x + 60 && n.y > before.y + 40, `moved ${before.x},${before.y} → ${n.x},${n.y}`);
    const h = await t.box('.cnote [data-resize]');
    await t.page.mouse.move(h.x + 6, h.y + 6); await t.page.mouse.down(); await t.page.mouse.move(h.x + 106, h.y + 86, { steps: 4 }); await t.page.mouse.up(); await t.page.waitForTimeout(200);
    n = (await notesIn(t))[0];
    assert(n.w > before.w + 50 && n.h > 0, 'resized');
    await t.page.click('[data-note-color="blue"]'); await t.page.waitForTimeout(150);
    eq((await notesIn(t))[0].color, 'blue');
    await t.page.keyboard.press('Control+d'); await t.page.waitForTimeout(250);
    eq((await notesIn(t)).length, 2, 'duplicated');
    await t.page.keyboard.press('Delete'); await t.page.waitForTimeout(200);
    eq((await notesIn(t)).length, 1, 'deleted the copy');
    await t.page.keyboard.press('Control+z'); await t.page.waitForTimeout(200);
    eq((await notesIn(t)).length, 2, 'undo brings it back');
  });

  await test('notes: notes paste into another kind of diagram', async t => {
    await t.page.click('#addNote'); await t.page.waitForSelector('.cnote.editing .ProseMirror-focused');
    await typeNote(t, ['Portable']); await leave(t);
    const b = await t.box('.cnote'); await t.page.mouse.click(b.x + 20, b.y + 20); await t.page.waitForTimeout(150);
    const text = await t.page.evaluate(() => { document.execCommand('copy'); return localStorage.getItem('cistem.clip'); });
    assert(text && text.includes('cistem-notes'), 'copied');
    await newCls(t);
    await t.page.mouse.move(5, 5); await t.page.keyboard.press('Control+v'); await t.page.waitForTimeout(400);
    const notes = await notesIn(t);
    eq(notes.length, 1, 'pasted into the class diagram'); assert(notes[0].text.includes('Portable'));
  });

  await test('notes: a component gets notes in the panel and a badge on the canvas', async t => {
    await t.clickNode('n3');
    await t.page.click('[data-tab="notes"]'); await t.page.waitForSelector('.item-notes .ProseMirror');
    await t.page.click('.item-notes .ProseMirror');
    await typeNote(t, ['# Runbook', '[ ] idempotency keys', 'timeouts']);
    await t.page.click('.item-notes li[data-checked] input >> nth=1');
    await leave(t);
    const n = (await t.doc()).model.nodes.find(x => x.id === 'n3');
    assert(n.notes.includes('# Runbook') && n.notes.includes('- [x] timeouts'), n.notes);
    eq(await t.page.textContent('[data-node="n3"] .note-badge text'), '1/2', 'badge shows checklist progress');
    await t.clickNode('n3');
    eq((await t.page.textContent('[data-tab="notes"]')).replace(/\s/g, ''), 'Notes1/2');
  });

  await test('notes: lifelines and classes take notes too', async t => {
    await newSeq(t); await addParts(t, ['web']);
    await t.page.click('[data-head="web"]'); await t.page.waitForTimeout(300);
    await t.page.click('.notes-section .ProseMirror'); await typeNote(t, ['the browser']); await leave(t);
    eq((await t.doc()).model.participants[0].notes, 'the browser');
    await newCls(t); await pasteOnCanvas(t, 'class Order {}'); await t.page.waitForTimeout(400);
    await t.page.click('.cl-box[data-class="Order"] .cl-body', { position: { x: 20, y: 10 } }); await t.page.waitForTimeout(300);
    await t.page.click('.notes-section .ProseMirror'); await typeNote(t, ['aggregate root']); await leave(t);
    eq((await t.doc()).model.classes[0].notes, 'aggregate root');
  });

  await test('notes: markup from a hostile file is dropped', async t => {
    await t.page.evaluate(() => { window.__pwned = 0; });
    const f = await t.doc();
    f.model.notes = [{ id: 'x', color: 'yellow', text: '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=2</script> <a href="javascript:window.__pwned=3">link</a> <span style="color: red; background: url(x)">styled</span> fine' }];
    f.layout.notes = { x: { x: 100, y: 100, w: 300 } };
    await t.page.click('#ioBtn'); await t.page.fill('#json', JSON.stringify(f)); await t.page.click('#loadJson');
    await t.page.waitForSelector('.cnote .ProseMirror'); await t.page.waitForTimeout(300);
    await t.page.click('.cnote a').catch(() => {});
    eq(await t.page.evaluate(() => window.__pwned), 0, 'nothing ran');
    assert(!(await t.page.$('.cnote img, .cnote script')), 'no img or script');
    eq(await t.page.$eval('.cnote span[style]', e => e.getAttribute('style')).catch(() => null), null, 'unknown colours are dropped');
  });

  await test('regression: the Note button is on screen on a laptop-height window', async t => {
    await t.page.setViewportSize({ width: 1440, height: 800 }); await t.page.waitForTimeout(200);
    const b = await t.box('#addNote');
    assert(b.y >= 0 && b.y + b.height <= 800, `note button at ${b.y}..${b.y + b.height}`);
  });

  // ---- projects ----
  /**
   * A fake account server (the /api contract) inside the test: signed in as `me`, keeping projects and diagrams
   * in memory for the whole test (reloads included).
   */
  async function fakeAccount(page, { signedIn = true } = {}) {
    const db = { user: signedIn ? { id: 'u1', login: 'murtu' } : null, projects: [], diagrams: [], n: 0 };
    const id = p => `${p}-${++db.n}`;
    const now = () => new Date(Date.now() + db.n * 1000).toISOString();
    const summary = d => ({ id: d.id, projectId: d.projectId, title: d.title, kind: d.kind, version: d.version, shared: !!d.shareToken, createdAt: d.createdAt, updatedAt: d.updatedAt });
    const project = p => ({ ...p, shared: !!p.shareToken, diagrams: db.diagrams.filter(d => d.projectId === p.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summary) });
    const touch = pid => { const p = db.projects.find(x => x.id === pid); if (p) p.updatedAt = now(); };
    const ensure = () => { if (!db.projects.length) db.projects.push({ id: id('p'), title: 'My diagrams', createdAt: now(), updatedAt: now() }); };
    await page.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname, m = req.method();
      const body = () => { try { return JSON.parse(req.postData() || '{}'); } catch { return {}; } };
      const json = (status, b) => route.fulfill({ status, contentType: 'application/json', body: b === undefined ? '' : JSON.stringify(b), headers: b && b.version ? { ETag: `"${b.version}"` } : {} });
      let r;
      if (path === '/api/me') return db.user ? json(200, db.user) : json(401, { error: 'no' });
      if (path === '/api/logout') { db.user = null; return json(204); }
      if ((r = /^\/api\/share\/project\/(.+)$/.exec(path))) {
        const p = db.projects.find(x => x.shareToken === r[1]); if (!p) return json(404, { error: 'No such project' });
        return json(200, { title: p.title, diagrams: db.diagrams.filter(d => d.projectId === p.id).map(({ shareToken, ...d }) => d) });
      }
      if ((r = /^\/api\/share\/(.+)$/.exec(path))) {
        const d = db.diagrams.find(x => x.shareToken === r[1]); if (!d) return json(404, { error: 'No such diagram' });
        const { shareToken, ...rest } = d; return json(200, rest);
      }
      if (!db.user) return json(401, { error: 'Sign in' });
      if (path === '/api/projects' && m === 'GET') { ensure(); return json(200, [...db.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(project)); }
      if (path === '/api/projects' && m === 'POST') { const p = { id: id('p'), title: body().title.trim(), createdAt: now(), updatedAt: now() }; db.projects.push(p); return json(201, project(p)); }
      if ((r = /^\/api\/projects\/([^/]+)(\/share)?$/.exec(path))) {
        const p = db.projects.find(x => x.id === r[1]); if (!p) return json(404, { error: 'No such project' });
        if (r[2]) { if (m === 'POST') { p.shareToken = 'tok-' + p.id; return json(200, project(p)); } delete p.shareToken; return json(204); }
        if (m === 'PATCH') { p.title = body().title.trim(); touch(p.id); return json(200, project(p)); }
        if (m === 'DELETE') { db.projects = db.projects.filter(x => x !== p); db.diagrams = db.diagrams.filter(d => d.projectId !== p.id); return json(204); }
      }
      if (path === '/api/diagrams' && m === 'GET') return json(200, db.diagrams.map(summary));
      if (path === '/api/diagrams' && m === 'POST') {
        ensure(); const b = body(); const pid = b.projectId ?? db.projects[0].id;
        if (!db.projects.some(p => p.id === pid)) return json(404, { error: 'No such project' });
        const d = { id: id('d'), projectId: pid, title: b.document.meta.title, kind: b.document.kind, document: b.document, version: 1, createdAt: now(), updatedAt: now() };
        db.diagrams.push(d); touch(pid); return json(201, d);
      }
      if ((r = /^\/api\/diagrams\/([^/]+)(\/share|\/project)?$/.exec(path))) {
        const d = db.diagrams.find(x => x.id === r[1]); if (!d) return json(404, { error: 'No such diagram' });
        if (r[2] === '/share') { if (m === 'POST') { d.shareToken = 'dtok-' + d.id; return json(200, d); } delete d.shareToken; return json(204); }
        if (r[2] === '/project') { d.projectId = body().projectId; touch(d.projectId); return json(200, summary(d)); }
        if (m === 'GET') return json(200, d);
        if (m === 'DELETE') { db.diagrams = db.diagrams.filter(x => x !== d); return json(204); }
        if (m === 'PUT') { const b = body(); d.document = b.document; d.title = b.document.meta.title; d.version++; d.updatedAt = now(); touch(d.projectId); return json(200, d); }
      }
      return json(404, { error: 'not faked: ' + m + ' ' + path });
    });
    return db;
  }
  const drawer = async t => { if (!(await t.page.$('#drawer'))) { await t.page.click('#drawerBtn'); await t.page.waitForTimeout(250); } };
  const tabTitles = t => t.page.$$eval('.dtab .tt', els => els.map(e => e.textContent));
  const newProject = async (t, name) => { await drawer(t); await t.page.click('#newProject'); await t.page.fill('#dlgInput', name); await t.page.click('#dlgOk'); await t.page.waitForTimeout(600); };

  await test('projects: create, switch, and each project keeps its own tabs across a reload', async t => {
    eq(await t.page.textContent('#drawerBtn .sw-title'), 'My diagrams', 'starts in My diagrams');
    const mine = await tabTitles(t);
    await newProject(t, 'Pay at table');
    eq(await t.page.textContent('#drawerBtn .sw-title'), 'Pay at table', 'the new project is open');
    eq((await tabTitles(t)).join('|'), 'Untitled system', 'with one blank diagram');
    await t.page.click('#newTabBtn'); await t.page.click('[data-new="sequence"]'); await t.page.waitForTimeout(300);
    await t.page.reload(); await t.page.waitForTimeout(900);
    eq(await t.page.textContent('#drawerBtn .sw-title'), 'Pay at table', 'still open after a reload');
    eq((await tabTitles(t)).join('|'), 'Untitled system|Untitled sequence', 'its tabs came back');
    await drawer(t); await t.page.click('.prow:has-text("My diagrams") [data-open-project]'); await t.page.waitForTimeout(600);
    eq((await tabTitles(t)).join('|'), mine.join('|'), 'My diagrams tabs came back');
  });

  await test('projects: move a diagram to another project, delete a diagram, delete a project after typing its name', async t => {
    const title = (await tabTitles(t))[0];
    await newProject(t, 'Target');
    await drawer(t); await t.page.click('.prow:has-text("My diagrams") [data-open-project]'); await t.page.waitForTimeout(600);
    const n = (await tabTitles(t)).length;
    await t.page.click('.dtab', { button: 'right' }); await t.page.click('[data-menu="t-move"]'); await t.page.click('.popmenu button:has-text("Target")'); await t.page.waitForTimeout(500);
    eq((await tabTitles(t)).length, n - 1, 'its tab closed here');
    await drawer(t);
    assert((await t.page.textContent('.prow:has-text("Target")')).includes(title) || (await t.page.click('.prow:has-text("Target") .ptoggle'), (await t.page.textContent('.prow:has-text("Target")')).includes(title)), 'it is in Target now');
    // delete the open diagram from its tab
    const before = await tabTitles(t);
    await t.page.click('.dtab.on', { button: 'right' }); await t.page.click('[data-menu="t-delete"]'); await t.page.click('#dlgOk'); await t.page.waitForTimeout(500);
    eq((await tabTitles(t)).length, Math.max(1, before.length - 1), 'deleted');
    // delete the Target project: needs its name typed
    await drawer(t); await t.page.click('.prow:has-text("Target") [data-project-menu]'); await t.page.click('[data-menu="p-delete"]');
    assert(await t.page.isDisabled('#dlgOk'), 'not until the name is typed');
    await t.page.fill('#dlgInput', 'Target'); await t.page.click('#dlgOk'); await t.page.waitForTimeout(500);
    assert(!(await t.page.$('.prow:has-text("Target")')), 'gone');
  });

  await test('projects: export a project and import it back as a new project, with the sequence still linked', async t => {
    // a sequence drawing on the example system
    await t.page.click('#newTabBtn'); await t.page.click('[data-nm="seq-path"]'); await t.page.waitForTimeout(500);
    const seq = await t.doc(); assert(seq.model.uses?.tab, 'the sequence draws on the system tab');
    const [dl] = await Promise.all([t.page.waitForEvent('download'), (async () => { await drawer(t); await t.page.click('.prow.on [data-project-menu]'); await t.page.click('[data-menu="p-export"]'); })()]);
    const text = require('fs').readFileSync(await dl.path(), 'utf8'); const file = JSON.parse(text);
    eq(file.format, 'cistem-project', 'a project file');
    await t.page.click('#ioBtn'); await t.page.fill('#json', text.replace('"My diagrams"', '"Copied"')); await t.page.click('#loadJson'); await t.page.waitForTimeout(900);
    eq(await t.page.textContent('#drawerBtn .sw-title'), 'Copied', 'opened as a new project');
    await t.page.click('.dtab:has(.k-sequence)'); await t.page.waitForTimeout(400);
    const copied = await t.doc();
    const sysKeys = await t.page.$$eval('.dtab', els => els.filter(e => e.querySelector('.k-system')).map(e => e.dataset.key));
    assert(sysKeys.includes(copied.model.uses.tab), 'the copy points at the copied system: ' + JSON.stringify(copied.model.uses));
  });

  await test('projects: tabs from before projects become "My diagrams"', async t => {
    await t.page.evaluate(() => {
      indexedDB.deleteDatabase('cistem');
      const doc = { version: 4, kind: 'system', meta: { title: 'Old one', created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z' }, model: { nodes: [], edges: [], containers: [], links: [] }, layout: { positions: {}, frames: {} } };
      localStorage.setItem('cistem.tabs', JSON.stringify({ tabs: [{ key: 'tOld', kind: 'system', title: 'Old one' }], active: 'tOld' }));
      localStorage.setItem('cistem.doc.tOld', JSON.stringify(doc));
    });
    await t.page.reload(); await t.page.waitForTimeout(900);
    eq(await t.page.textContent('#drawerBtn .sw-title'), 'My diagrams');
    eq((await tabTitles(t)).join('|'), 'Old one', 'the old tab is there');
    eq(await t.page.evaluate(() => localStorage.getItem('cistem.tabs')), null, 'moved out of localStorage');
  });

  await test('projects: a diagram deleted in another window closes here and isn\'t brought back', async t => {
    const [b] = await Promise.all([t.page.waitForEvent('popup'), t.page.evaluate(u => { window.open(u); }, BASE)]); await b.setViewportSize({ width: 1400, height: 900 }); await b.waitForTimeout(1200);
    const key = await t.page.$eval('.dtab.on', e => e.dataset.key);
    const n = (await tabTitles(t)).length;
    await b.click(`.dtab[data-key="${key}"]`); await b.waitForTimeout(300);
    await b.click('.dtab.on', { button: 'right' }); await b.click('[data-menu="t-delete"]'); await b.click('#dlgOk'); await b.waitForTimeout(600);
    await t.page.waitForTimeout(400);
    eq((await tabTitles(t)).length, n - 1, 'its tab closed in the other window too');
    await t.page.reload(); await t.page.waitForTimeout(900);
    assert(!(await t.page.$(`.dtab[data-key="${key}"]`)), 'still gone after a reload');
    await b.close();
  });

  await test('account: signed in, projects come from the account; share a project; the link opens read-only and can be copied', async t => {
    const db = await fakeAccount(t.page);
    await t.page.reload(); await t.page.waitForTimeout(1000);
    eq(await t.page.textContent('#drawerBtn .sw-title'), 'My diagrams', 'the account default project');
    eq(db.diagrams.length, 1, 'an empty project opens with a new blank diagram, saved to the account');
    await t.page.click('#newTabBtn'); await t.page.click('[data-new="system"]'); await t.page.waitForTimeout(500);
    eq(db.diagrams.length, 2, 'new diagrams are saved to the account');
    await t.page.click('.dtab.on', { button: 'right' }); await t.page.click('[data-menu="t-delete"]'); await t.page.click('#dlgOk'); await t.page.waitForTimeout(500);
    eq(db.diagrams.length, 1, 'deleted from the account');
    await t.page.fill('#title', 'Upload pipeline'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(1500);
    eq(db.diagrams[0].title, 'Upload pipeline', 'autosaved');
    assert(await t.page.isVisible('#leftovers') || (await drawer(t), await t.page.isVisible('#leftovers')), 'offers the browser diagrams');
    // share the project
    await t.page.click('#shareBtn'); await t.page.click('#shareProjectTab'); await t.page.click('#shareSwitch'); await t.page.waitForSelector('#shareLink');
    const link = await t.page.inputValue('#shareLink');
    assert(link.includes('?p=tok-'), link);
    await t.page.click('#shareDone');
    // open the link signed out
    db.user = null;
    await t.page.goto(link); await t.page.waitForTimeout(1000);
    assert(await t.page.isVisible('.tag.viewonly'), 'view only');
    eq((await tabTitles(t)).join('|'), 'Upload pipeline', 'the shared diagrams');
    await t.page.click('#copyView'); await t.page.waitForTimeout(800);
    assert(!(await t.page.$('.tag.viewonly')), 'a copy of your own');
    eq(await t.page.textContent('#drawerBtn .sw-title'), 'My diagrams', 'named after the project');
    eq((await tabTitles(t)).join('|'), 'Upload pipeline', 'with its diagram, in this browser');
  });

  await test('account: diagrams made signed out can be added to the account', async t => {
    await t.page.fill('#title', 'Made offline'); await t.page.keyboard.press('Enter'); await t.page.waitForTimeout(300);
    const db = await fakeAccount(t.page);
    await t.page.reload(); await t.page.waitForTimeout(1000);
    await drawer(t);
    await t.page.click('#importLocal'); await t.page.waitForTimeout(1200);
    assert(db.diagrams.some(d => d.title === 'Made offline'), 'copied to the account: ' + db.diagrams.map(d => d.title));
    eq(await t.page.textContent('#drawerBtn .sw-title'), 'My diagrams (from this browser)', 'in its own project');
    assert(!(await t.page.$('#leftovers')), 'nothing left to offer');
  });

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — screenshots in ' + OUT : ''}`);
  process.exit(failed.length ? 1 : 0);
})();
