import './style.css';
import { makeNode, adopt, type Kind } from './model';
import { state, current, restore, loadExample, renderAll } from './state';
import { fit, zoomAt, setConnect, hint, addNodeAtCentre } from './canvas';
import './sheet';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = $<HTMLElement>('svg');
const rpsInput = $<HTMLInputElement>('rps');

// ---------- toolbar ----------
$('palette').addEventListener('click', ev => {
  const b = (ev.target as Element).closest('[data-add]') as HTMLElement | null;
  if (!b) return;
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
$('zin').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.2); };
$('zout').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.2); };
$('zfit').onclick = fit;
rpsInput.addEventListener('input', () => { state.doc.targetRps = +rpsInput.value || 0; renderAll(); });
$('resetBtn').onclick = () => { loadExample(); rpsInput.value = String(state.doc.targetRps); renderAll(); fit(); };

document.addEventListener('keydown', ev => {
  const t = (ev.target as Element).tagName;
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
  if (ev.key === 'Delete' || ev.key === 'Backspace') $('deleteBtn').click();
  if (ev.key === 'c') setConnect(!state.connectMode);
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
  try { state.doc = adopt(JSON.parse(jta.value)); state.sel = null; rpsInput.value = String(state.doc.targetRps); renderAll(); fit(); msg('Loaded'); }
  catch { msg('Not valid Loadmap JSON'); }
};

// ---------- boot ----------
if (!restore()) loadExample();
rpsInput.value = String(state.doc.targetRps);
renderAll();
requestAnimationFrame(fit);
