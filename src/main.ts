import './style.css';
import { type Kind } from './model';
import { state, current, restore, loadExample, loadFile, serialize, renderAll, renderCanvas, mutate, select, selectedNodeIds, undo, redo } from './state';
import { fit, zoomAt, hint, addNode, addContainer, nudge, toggleDetail, setAllDetail } from './canvas';
import { layeredLayout, type Positions } from './layout';
import * as history from './history';
import './sheet';
import { cloud, startPolling, scheduleSave, saveNow, resolveConflict, openDrawer, closeDrawer, newDiagram, saveAsNew, toggleShare, onSyncStatus, onUserChange, signIn, signOut, bootCloud } from './cloud';
import { onAfterRender } from './state';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = $<HTMLElement>('svg');
const rpsInput = $<HTMLInputElement>('rps');
const rpsRange = $<HTMLInputElement>('rpsRange');
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- target rps ----------
let rpsSnapshotted = false;
const setRps = (v: number) => { state.doc.targetRps = v; rpsInput.value = String(v); rpsRange.value = String(Math.min(50000, v)); renderAll(); };
const onRps = (v: number) => { if (!rpsSnapshotted) { history.snapshot(state.doc); rpsSnapshotted = true; } setRps(v); };
rpsInput.addEventListener('input', () => onRps(+rpsInput.value || 0));
rpsRange.addEventListener('input', () => onRps(+rpsRange.value));
[rpsInput, rpsRange].forEach(e => e.addEventListener('change', () => (rpsSnapshotted = false)));

// ---------- title ----------
const titleInput = $<HTMLInputElement>('title');
const syncTitle = () => { titleInput.value = state.meta.title; document.title = `${state.meta.title} · cistem.io`; };
titleInput.addEventListener('focus', () => history.snapshot(state.doc));
titleInput.addEventListener('input', () => { state.meta.title = titleInput.value || 'Untitled system'; document.title = `${state.meta.title} · cistem.io`; renderCanvas(); });

// ---------- undo / redo ----------
const undoBtn = $<HTMLButtonElement>('undoBtn'), redoBtn = $<HTMLButtonElement>('redoBtn');
const refreshHistory = () => { undoBtn.disabled = !history.canUndo(); redoBtn.disabled = !history.canRedo(); };
history.onHistoryChange(refreshHistory);
undoBtn.onclick = () => { undo(); refreshHistory(); };
redoBtn.onclick = () => { redo(); refreshHistory(); };

// ---------- delete / duplicate ----------
function deleteSelection() {
  const ids = selectedNodeIds().filter(id => state.doc.nodes.find(n => n.id === id)?.kind !== 'entry');
  if (state.sel?.type === 'container') {
    const id = state.sel.id;
    mutate(() => {
      const c = state.doc.containers.find(x => x.id === id)!; const parent = c.parent ?? null;
      state.doc.nodes.forEach(x => { if ((x.container ?? null) === id) x.container = parent; });
      state.doc.containers.forEach(x => { if ((x.parent ?? null) === id) x.parent = parent; });
      state.doc.links = state.doc.links.filter(l => l.from !== id && l.to !== id);
      delete state.doc.frames[id];
      state.doc.containers = state.doc.containers.filter(x => x.id !== id);
    });
  } else if (state.sel?.type === 'edge') {
    const id = state.sel.id;
    mutate(() => { state.doc.edges = state.doc.edges.filter(e => e.id !== id); });
  } else if (ids.length) {
    mutate(() => {
      state.doc.nodes = state.doc.nodes.filter(n => !ids.includes(n.id));
      state.doc.edges = state.doc.edges.filter(e => !ids.includes(e.from) && !ids.includes(e.to));
    });
  } else if (state.sel) { hint('The entry point stays', 1200); return; }
  else return;
  select(null); renderAll();
}
function duplicateSelection() {
  const ids = selectedNodeIds().filter(id => state.doc.nodes.find(n => n.id === id)?.kind !== 'entry');
  if (!ids.length) return;
  const map: Record<string, string> = {};
  mutate(() => {
    ids.forEach(id => {
      const src = state.doc.nodes.find(n => n.id === id)!;
      const copy = JSON.parse(JSON.stringify(src)); copy.id = 'n' + Math.random().toString(36).slice(2, 8); copy.x += 32; copy.y += 32;
      map[id] = copy.id; state.doc.nodes.push(copy);
    });
    // keep edges between duplicated nodes
    state.doc.edges.filter(e => map[e.from] && map[e.to]).forEach(e => state.doc.edges.push({ ...e, id: 'e' + Math.random().toString(36).slice(2, 8), from: map[e.from], to: map[e.to] }));
  });
  state.multi = new Set(Object.values(map).slice(1)); state.sel = { type: 'node', id: Object.values(map)[0] };
  renderAll();
}

// ---------- auto-organise ----------
function moveTo(target: Positions, then?: () => void) {
  const from: Positions = {};
  state.doc.nodes.forEach(n => (from[n.id] = { x: n.x, y: n.y }));
  const apply = (t: number) => {
    state.doc.nodes.forEach(n => { const a = from[n.id], b = target[n.id] ?? a; n.x = a.x + (b.x - a.x) * t; n.y = a.y + (b.y - a.y) * t; });
    renderCanvas();
  };
  if (reduceMotion()) { apply(1); then?.(); return; }
  const dur = 280, t0 = performance.now(), ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const tick = (now: number) => { const t = Math.min(1, (now - t0) / dur); apply(ease(t)); if (t < 1) requestAnimationFrame(tick); else then?.(); };
  requestAnimationFrame(tick);
}
function organise() {
  const res = layeredLayout(state.doc);
  const next = res.positions;
  if (state.doc.nodes.every(n => next[n.id].x === n.x && next[n.id].y === n.y)) { hint('Already organised', 1200); return; }
  history.snapshot(state.doc);
  // empty containers have no members to follow; give them their computed frame
  for (const id in res.frames) if (!state.doc.nodes.some(n => n.container === id) && !state.doc.containers.some(c => c.parent === id)) state.doc.frames[id] = res.frames[id];
  moveTo(next, () => fit());
}
$('layoutBtn').onclick = organise;

// ---------- view ----------
$('zin').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.2); };
$('zout').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.2); };
$('zfit').onclick = () => fit();
let allExpanded = false;
$('expandAll').onclick = () => { allExpanded = !allExpanded; setAllDetail(allExpanded ? 'expanded' : 'compact'); $('expandAll').classList.toggle('active', allExpanded); };
$('resetBtn').onclick = () => { loadExample(); setRps(state.doc.targetRps); syncTitle(); fit(); };

// ---------- keyboard ----------
document.addEventListener('keydown', ev => {
  const t = (ev.target as Element).tagName;
  const mod = ev.metaKey || ev.ctrlKey;
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') {
    if (mod && ev.key.toLowerCase() === 'z' && t !== 'TEXTAREA' && (ev.target as HTMLInputElement).type !== 'text') { /* let native undo work in fields */ }
    return;
  }
  if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); refreshHistory(); return; }
  if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); refreshHistory(); return; }
  if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); duplicateSelection(); return; }
  if (mod && ev.key.toLowerCase() === 'a') { ev.preventDefault(); state.multi = new Set(state.doc.nodes.map(n => n.id)); state.sel = null; renderCanvas(); return; }
  if (mod && ev.key === '0') { ev.preventDefault(); fit(); return; }
  if (mod && (ev.key === '=' || ev.key === '+')) { ev.preventDefault(); $('zin').click(); return; }
  if (mod && ev.key === '-') { ev.preventDefault(); $('zout').click(); return; }
  if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSelection(); return; }
  if (ev.key.toLowerCase() === 'o' && !mod) { organise(); return; }
  if (ev.key.toLowerCase() === 'e' && !mod) { addContainer(); return; }
  if (ev.key === ' ' && !mod) { ev.preventDefault(); if (ev.shiftKey) $('expandAll').click(); else if (state.sel?.type === 'node') toggleDetail(state.sel.id); return; }
  if (ev.key === 'Escape') { select(null); renderAll(); return; }
  const step = ev.shiftKey ? 32 : 8;
  if (ev.key === 'ArrowLeft') { ev.preventDefault(); nudge(-step, 0); }
  if (ev.key === 'ArrowRight') { ev.preventDefault(); nudge(step, 0); }
  if (ev.key === 'ArrowUp') { ev.preventDefault(); nudge(0, -step); }
  if (ev.key === 'ArrowDown') { ev.preventDefault(); nudge(0, step); }
  // quick-add: 1-6
  const kinds: Kind[] = ['entry', 'lb', 'service', 'cache', 'db', 'queue'];
  if (!mod && /^[1-6]$/.test(ev.key)) addNode(kinds[+ev.key - 1]);
});

// ---------- save / load ----------
const io = $('io'), jta = $<HTMLTextAreaElement>('json');
const msg = (t: string) => { const m = $('ioMsg'); m.textContent = t; setTimeout(() => { m.textContent = ''; }, 1800); };
const openIo = () => { io.hidden = false; jta.value = serialize(); jta.focus(); };
const closeIo = () => { io.hidden = true; };
$('ioBtn').onclick = openIo;
$('ioClose').onclick = closeIo;
io.addEventListener('click', ev => { if (ev.target === io) closeIo(); });
io.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeIo(); });
$('copyJson').onclick = () => {
  jta.value = serialize();
  const fb = () => { jta.select(); msg('Select and copy manually'); };
  try { navigator.clipboard.writeText(jta.value).then(() => msg('Copied'), fb); } catch { fb(); }
};
$('loadJson').onclick = () => {
  try { loadFile(JSON.parse(jta.value)); setRps(state.doc.targetRps); syncTitle(); fit(); closeIo(); }
  catch (e) { msg(e instanceof SyntaxError ? 'Not valid JSON' : (e as Error).message); }
};

// ---------- cloud ----------
onAfterRender(scheduleSave);
const syncEl = $('sync'), syncText = $('syncText'), conflictEl = $('conflict'), toastEl = $('toast');
let toastTimer = 0;
function toast(t: string, ms = 2200) { toastEl.textContent = t; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = window.setTimeout(() => (toastEl.hidden = true), ms); }
onSyncStatus((s, detail) => {
  syncEl.className = 'sync ' + s;
  syncText.textContent = { local: cloud.user ? 'save' : 'not saved', saved: 'saved', saving: 'saving…', dirty: 'unsaved', conflict: 'conflict', error: 'retry save', readonly: 'read-only' }[s];
  syncEl.title = detail || { local: cloud.user ? 'Save this diagram to your account' : 'Kept in this browser only. Sign in to save.', saved: 'All changes saved', saving: 'Saving…', dirty: 'Changes pending', conflict: 'Changed elsewhere', error: 'Save failed. Click to retry.', readonly: 'Shared link: you are viewing a copy' }[s];
  conflictEl.hidden = s !== 'conflict';
  if (s === 'error' && detail) toast(detail, 4000);
  if (s === 'local' && detail) toast(detail, 4000);
  titleInput.readOnly = s === 'readonly';
});
syncEl.onclick = () => { if (cloud.status === 'local' || cloud.status === 'dirty' || cloud.status === 'error') saveNow(); };
onUserChange(u => {
  $('signInBtn').hidden = !!u; $('accountBtn').hidden = !u;
  if (u) { ($('avatar') as HTMLImageElement).src = u.avatarUrl || ''; $('login').textContent = u.login; $('accountName').textContent = u.name || u.login; }
});
$('signInBtn').onclick = signIn;
const accountMenu = $('accountMenu');
$('accountBtn').onclick = () => { accountMenu.hidden = !accountMenu.hidden; };
document.addEventListener('click', ev => { if (!accountMenu.hidden && !(ev.target as Element).closest('#accountMenu,#accountBtn')) accountMenu.hidden = true; });
$('signOutBtn').onclick = () => { accountMenu.hidden = true; signOut(); };
if (new URL(location.href).searchParams.get('login') === 'failed') toast('GitHub sign-in didn\'t complete. Try again.', 5000);
$('conflictTheirs').onclick = () => resolveConflict('theirs');
$('conflictMine').onclick = () => resolveConflict('mine');
$('drawerBtn').onclick = openDrawer; $('drawerClose').onclick = closeDrawer;
$('newDiagram').onclick = newDiagram; $('saveAsNew').onclick = () => { saveAsNew(); closeDrawer(); };
$('shareBtn').onclick = async () => {
  if (!cloud.user) { signIn(); return; }
  if (!cloud.id) { await saveNow(); if (!cloud.id) return; }
  try {
    const url = await toggleShare();
    if (!url) { toast('Share link removed'); return; }
    try { await navigator.clipboard.writeText(url); toast('Share link copied'); } catch { prompt('Share link', url); }
  } catch (e) { toast((e as Error).message, 4000); }
};
document.addEventListener('cistem:opened', () => { setRps(state.doc.targetRps); syncTitle(); refreshHistory(); });
document.addEventListener('cistem:external-update', () => { setRps(state.doc.targetRps); syncTitle(); toast('Updated from another session'); });
document.addEventListener('keydown', ev => { if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); cloud.id ? saveNow() : saveAsNew(); } });

// ---------- boot ----------
(async () => {
  const hasLocal = restore();
  if (!hasLocal) loadExample();
  history.reset(); setRps(state.doc.targetRps); syncTitle(); refreshHistory(); requestAnimationFrame(() => fit(false));
  await bootCloud(hasLocal);   // may replace the doc with a cloud one; fires cistem:opened if so
  startPolling();
})();
void current;
