import './style.css';
import { makeNode, adopt, type Kind } from './model';
import { state, current, restore, loadExample, renderAll } from './state';
import { fit, zoomAt, setConnect, hint, addNodeAtCentre } from './canvas';
import { layeredLayout, type Positions } from './layout';
import './sheet';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = $<HTMLElement>('svg');
const rpsInput = $<HTMLInputElement>('rps');

// ---------- toolbar ----------
$('palette').addEventListener('click', ev => {
  const b = (ev.target as Element).closest('[data-add]') as HTMLElement | null;
  if (!b) return;
  forgetLayoutUndo();
  addNodeAtCentre(b.dataset.add as Kind, (k, x, y) => makeNode(k, x, y));
});
$('connectBtn').onclick = () => setConnect(!state.connectMode);
$('deleteBtn').onclick = () => {
  const s = state.sel; if (!s) return;
  if (s.type === 'node') {
    const n = current();
    if (n && (n as any).kind === 'entry') { hint('The entry point stays'); setTimeout(() => hint(null), 1200); return; }
    state.doc.nodes = state.doc.nodes.filter(x => x.id !== s.id);
    state.doc.edges = state.doc.edges.filter(e => e.from !== s.id && e.to !== s.id);
  } else state.doc.edges = state.doc.edges.filter(e => e.id !== s.id);
  state.sel = null; renderAll();
};
// ---------- auto-organise ----------
const layoutBtn = $<HTMLButtonElement>('layoutBtn');
let layoutUndo: Positions | null = null;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function moveTo(target: Positions, then?: () => void) {
  const from: Positions = {};
  state.doc.nodes.forEach(n => (from[n.id] = { x: n.x, y: n.y }));
  const apply = (t: number) => {
    state.doc.nodes.forEach(n => {
      const a = from[n.id], b = target[n.id] ?? a;
      n.x = a.x + (b.x - a.x) * t; n.y = a.y + (b.y - a.y) * t;
    });
    renderAll();
  };
  if (reduceMotion()) { apply(1); then?.(); return; }
  const dur = 260, t0 = performance.now();
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const tick = (now: number) => {
    const t = Math.min(1, (now - t0) / dur);
    apply(ease(t));
    if (t < 1) requestAnimationFrame(tick); else then?.();
  };
  requestAnimationFrame(tick);
}
layoutBtn.onclick = () => {
  if (layoutUndo) {
    const back = layoutUndo; layoutUndo = null; layoutBtn.textContent = 'Auto-organise';
    moveTo(back, fit); return;
  }
  const prev: Positions = {};
  state.doc.nodes.forEach(n => (prev[n.id] = { x: n.x, y: n.y }));
  const next = layeredLayout(state.doc);
  const unchanged = state.doc.nodes.every(n => next[n.id].x === n.x && next[n.id].y === n.y);
  if (unchanged) { hint('Already organised'); setTimeout(() => hint(null), 1200); return; }
  layoutUndo = prev; layoutBtn.textContent = 'Undo layout';
  moveTo(next, fit);
};
const forgetLayoutUndo = () => { if (layoutUndo) { layoutUndo = null; layoutBtn.textContent = 'Auto-organise'; } };
svg.addEventListener('pointerdown', ev => { if ((ev.target as Element).closest('[data-node]')) forgetLayoutUndo(); });

$('zin').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.2); };
$('zout').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.2); };
$('zfit').onclick = fit;
rpsInput.addEventListener('input', () => { state.doc.targetRps = +rpsInput.value || 0; renderAll(); });
$('resetBtn').onclick = () => { forgetLayoutUndo(); loadExample(); rpsInput.value = String(state.doc.targetRps); renderAll(); fit(); };

document.addEventListener('keydown', ev => {
  const t = (ev.target as Element).tagName;
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
  if (ev.key === 'Delete' || ev.key === 'Backspace') $('deleteBtn').click();
  if (ev.key === 'c') setConnect(!state.connectMode);
  if (ev.key === 'o') layoutBtn.click();
  if (ev.key === 'Escape') { setConnect(false); state.sel = null; renderAll(); }
});

// ---------- save / load ----------
const io = $('io'), jta = $<HTMLTextAreaElement>('json');
const msg = (t: string) => { const m = $('ioMsg'); m.textContent = t; setTimeout(() => { m.textContent = ''; }, 1800); };
$('ioBtn').onclick = () => { io.classList.toggle('open'); if (io.classList.contains('open')) jta.value = JSON.stringify(state.doc, null, 1); };
$('copyJson').onclick = () => {
  jta.value = JSON.stringify(state.doc, null, 1);
  const fb = () => { jta.select(); msg('Select and copy manually'); };
  try { navigator.clipboard.writeText(jta.value).then(() => msg('Copied'), fb); } catch { fb(); }
};
$('loadJson').onclick = () => {
  try { forgetLayoutUndo(); state.doc = adopt(JSON.parse(jta.value)); state.sel = null; rpsInput.value = String(state.doc.targetRps); renderAll(); fit(); msg('Loaded'); }
  catch { msg('Not valid Loadmap JSON'); }
};

// ---------- boot ----------
if (!restore()) loadExample();
rpsInput.value = String(state.doc.targetRps);
renderAll();
requestAnimationFrame(fit);
