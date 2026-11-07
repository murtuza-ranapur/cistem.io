import './style.css';
import { exampleDoc, totalRps, isSource } from './model';
import { toFile, fromFile } from './document';
import { state, current, serialize, renderAll, renderCanvas, mutate, select, selectedNodeIds, undo, redo, fmt } from './state';
import { fit, zoomAt, hint, addNode, RAIL_ORDER, addContainer, nudge, toggleDetail, setAllDetail, revealSelection } from './canvas';
import { layeredLayout, type Positions } from './layout';
import * as history from './history';
import { togglePanel, onPanelMode } from './sheet';
import { initTooltips } from './tooltip';
import { cloud, startPolling, scheduleSave, saveNow, resolveConflict, openDrawer, closeDrawer, newDiagram, saveAsNew, openAsNew, toggleShare, onSyncStatus, onUserChange, signIn, signOut, bootCloud } from './cloud';
import { onAfterRender } from './state';
import { bootTabs, syncActiveTitle, newTab, usesFor, tabs } from './tabs';
import { seqKey } from './seqview';
import { clsKey, organiseCls } from './clsview';
import { fromTables, fromAvro, layoutCls } from './cls';
import { clsToFile } from './document';
import { sequenceFromPath } from './seq';
import { seqToFile } from './document';
import { TYPES } from './model';
import { tabKeys, menuActions } from './tabbar';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = $<HTMLElement>('svg');
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- load: the sum of the clients' peak rps (each client sets its own) ----------
const totalVal = $('totalVal');
const syncTotal = () => { totalVal.textContent = fmt(totalRps(state.doc)); };
let clientCursor = 0;
$('totalRps').onclick = () => {
  const clients = state.doc.nodes.filter(n => isSource(n));
  if (!clients.length) { hint('Add a Clients component — its peak rps is the load'); return; }
  const n = clients[clientCursor++ % clients.length];
  select({ type: 'node', id: n.id }); renderAll(); revealSelection();
  setTimeout(() => document.querySelector<HTMLInputElement>('#sheetBody input[data-path="rps"]')?.select(), 260);
};

// ---------- title ----------
const titleInput = $<HTMLInputElement>('title');
const syncTitle = () => { titleInput.value = state.meta.title; document.title = `${state.meta.title} · cistem.io`; };
titleInput.addEventListener('focus', () => history.snapshot(state.doc));
titleInput.addEventListener('input', () => { state.meta.title = titleInput.value || 'Untitled system'; document.title = `${state.meta.title} · cistem.io`; renderCanvas(); });

// ---------- undo / redo ----------
const undoBtn = $<HTMLButtonElement>('undoBtn'), redoBtn = $<HTMLButtonElement>('redoBtn');
const refreshHistory = () => { undoBtn.disabled = !history.canUndo(); redoBtn.disabled = !history.canRedo(); };
// undo/redo can swap the whole document (e.g. undoing "open example"), so keep the title and RPS boxes in step
const appEl = $('app');
onAfterRender(() => {
  if (document.activeElement !== titleInput && titleInput.value !== state.meta.title) syncTitle();
  syncTotal(); syncActiveTitle();
  if (appEl.dataset.kind !== state.kind) { appEl.dataset.kind = state.kind; titleInput.placeholder = state.kind === 'sequence' ? 'Untitled sequence' : 'Untitled system'; }
});
history.onHistoryChange(refreshHistory);
undoBtn.onclick = () => { undo(); refreshHistory(); };
redoBtn.onclick = () => { redo(); refreshHistory(); };

// ---------- delete / duplicate ----------
function deleteSelection() {
  const ids = selectedNodeIds();
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
  } else return;
  select(null); renderAll();
}
function duplicateSelection() {
  const ids = selectedNodeIds();
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
$('layoutBtn').onclick = () => (state.kind === 'class' ? organiseCls() : organise());

// ---------- view ----------
const stageEl = $('stage');
$('zin').onclick = () => { const r = stageEl.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.2); };
$('zout').onclick = () => { const r = stageEl.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.2); };
$('zfit').onclick = () => fit();
let allExpanded = false;
$('expandAll').onclick = () => { allExpanded = !allExpanded; setAllDetail(allExpanded ? 'expanded' : 'compact'); $('expandAll').classList.toggle('active', allExpanded); };
$('panelBtn').onclick = togglePanel;
onPanelMode(m => $('panelBtn').classList.toggle('on', m !== 'hidden'));
initTooltips();
const exampleFile = () => toFile(exampleDoc(), { title: 'Checkout example', created: new Date().toISOString(), updated: new Date().toISOString() });
const openExample = async () => { await openAsNew(exampleFile()); syncTotal(); syncTitle(); };
$('resetBtn').onclick = openExample;

// ---------- keyboard ----------
document.addEventListener('keydown', ev => {
  const t = (ev.target as Element).tagName;
  const mod = ev.metaKey || ev.ctrlKey;
  if (ev.defaultPrevented) return;
  if (tabKeys(ev)) { ev.preventDefault(); return; }
  if ((ev.target as HTMLElement).isContentEditable || (ev.target as Element).closest?.('.cm-editor, .cm-overlay')) {
    // the code editor owns its keys; Escape (when no suggestion list is open) just leaves it
    if (ev.key === 'Escape' && !document.querySelector('.cm-tooltip-autocomplete')) (ev.target as HTMLElement).blur();
    return;
  }
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') {
    if (ev.key === 'Escape') (ev.target as HTMLElement).blur(); // leave the field; a second Escape clears the selection
    return;
  }
  if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); refreshHistory(); return; }
  if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); refreshHistory(); return; }
  if (state.kind !== 'system') {
    if (mod && ev.key === '0') { ev.preventDefault(); fit(); return; }
    if (mod && (ev.key === '=' || ev.key === '+')) { ev.preventDefault(); $('zin').click(); return; }
    if (mod && ev.key === '-') { ev.preventDefault(); $('zout').click(); return; }
    if (ev.key.toLowerCase() === 'i' && !mod) { togglePanel(); return; }
    if (ev.key === 'Escape') { select(null); renderAll(); return; }
    if ((state.kind === 'sequence' ? seqKey : clsKey)(ev)) ev.preventDefault();
    return;
  }
  if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); duplicateSelection(); return; }
  if (mod && ev.key.toLowerCase() === 'a') { ev.preventDefault(); state.multi = new Set(state.doc.nodes.map(n => n.id)); state.sel = null; renderCanvas(); return; }
  if (mod && ev.key === '0') { ev.preventDefault(); fit(); return; }
  if (mod && (ev.key === '=' || ev.key === '+')) { ev.preventDefault(); $('zin').click(); return; }
  if (mod && ev.key === '-') { ev.preventDefault(); $('zout').click(); return; }
  if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSelection(); return; }
  if (ev.key.toLowerCase() === 'o' && !mod) { organise(); return; }
  if (ev.key.toLowerCase() === 'e' && !mod) { addContainer(); return; }
  if (ev.key.toLowerCase() === 'i' && !mod) { togglePanel(); return; }
  if (ev.key === ' ' && !mod) { ev.preventDefault(); if (ev.shiftKey) $('expandAll').click(); else if (state.sel?.type === 'node') toggleDetail(state.sel.id); return; }
  if (ev.key === 'Escape') { select(null); renderAll(); return; }
  const step = ev.shiftKey ? 32 : 8;
  if (ev.key === 'ArrowLeft') { ev.preventDefault(); nudge(-step, 0); }
  if (ev.key === 'ArrowRight') { ev.preventDefault(); nudge(step, 0); }
  if (ev.key === 'ArrowUp') { ev.preventDefault(); nudge(0, -step); }
  if (ev.key === 'ArrowDown') { ev.preventDefault(); nudge(0, step); }
  // quick-add: 1–9 in rail order
  if (!mod && /^[1-9]$/.test(ev.key)) { const k = RAIL_ORDER()[+ev.key - 1]; if (k) addNode(k); }
});

// ---------- save / load ----------
const io = $('io'), jta = $<HTMLTextAreaElement>('json');
const msg = (t: string) => { const m = $('ioMsg'); m.textContent = t; setTimeout(() => { m.textContent = ''; }, 1800); };
const openIo = (blank = false) => { io.hidden = false; jta.value = blank ? '' : serialize(); jta.placeholder = 'Paste a cistem.io diagram (.json) and press Load'; jta.focus(); };
const closeIo = () => { io.hidden = true; };
$('ioBtn').onclick = () => openIo();
/** + menu → "Sequence from a request path": follow the calls from the selected component (or the first client). */
function pathStart() {
  if (state.kind !== 'system') return null;
  const sel = state.sel?.type === 'node' ? state.doc.nodes.find(n => n.id === state.sel!.id) : undefined;
  return sel ?? state.doc.nodes.find(n => isSource(n)) ?? state.doc.nodes[0] ?? null;
}
menuActions({
  openExisting: openDrawer, importJson: () => openIo(true), example: openExample,
  fromInfo: () => {
    if (state.kind !== 'system') return null;
    const s = pathStart();
    const extra = state.doc.nodes.flatMap(n => {
      const out: { label: string; run: () => void }[] = [];
      const open = (doc: ReturnType<typeof fromTables>, title: string) => { doc.pos = layoutCls(doc); newTab('class', clsToFile(doc, { title })); };
      if (n.tables?.length) out.push({ label: `Class diagram from ${n.name} tables`, run: () => open(fromTables(n.tables!, n.name), `${n.name} model`) });
      if (typeof n.schema === 'string' && n.schema.trim().startsWith('{')) out.push({ label: `Class diagram from the ${n.name} schema`, run: () => open(fromAvro(n.schema as string), `${n.name} schema`) });
      return out;
    });
    return s || extra.length ? { title: state.meta.title, start: s?.name ?? null, extra } : null;
  },
  fromPath: () => {
    const s = pathStart(); if (!s) return;
    const asyncKinds = new Set(Object.keys(TYPES).filter(k => TYPES[k].behaviour === 'async'));
    const seq = sequenceFromPath(state.doc, s.id, asyncKinds, usesFor(tabs.active) ?? undefined);
    if (seq.rows.length === 0) { hint(`${s.name} doesn't call anything yet`, 2000); return; }
    newTab('sequence', seqToFile(seq, { title: `${s.name} flow` }));
  },
});
$('ioClose').onclick = closeIo;
io.addEventListener('click', ev => { if (ev.target === io) closeIo(); });
io.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeIo(); });
$('copyJson').onclick = () => {
  jta.value = serialize();
  const fb = () => { jta.select(); msg('Select and copy manually'); };
  try { navigator.clipboard.writeText(jta.value).then(() => msg('Copied'), fb); } catch { fb(); }
};
$('loadJson').onclick = () => {
  let parsed: unknown;
  try { parsed = JSON.parse(jta.value); fromFile(parsed); }
  catch (e) { msg(e instanceof SyntaxError ? 'Not valid JSON' : (e as Error).message); return; }
  closeIo();
  openAsNew(parsed).then(() => { syncTotal(); syncTitle(); });
};

// keep whatever was selected out from under the inspector once it has slid in
const inspectorEl = $('inspector');
inspectorEl.addEventListener('transitionend', ev => { if (ev.propertyName === 'width' && !inspectorEl.classList.contains('closed')) revealSelection(); });
let lastSelKey = '';
onAfterRender(() => { const k = state.sel ? state.sel.type + ':' + state.sel.id : ''; if (k && k !== lastSelKey && !inspectorEl.classList.contains('closed')) setTimeout(revealSelection, 230); lastSelKey = k; });

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
document.addEventListener('cistem:opened', () => { renderAll(); syncTitle(); refreshHistory(); });
document.addEventListener('cistem:external-update', () => { renderAll(); syncTitle(); toast('Updated from another session'); });
document.addEventListener('keydown', ev => { if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); cloud.id ? saveNow() : saveAsNew(); } });

// ---------- boot ----------
(async () => {
  await bootTabs(exampleFile);   // this device's tabs, from their local copies
  syncTitle(); refreshHistory();
  await bootCloud();             // links them up with the account (and ?d= / ?s=)
  startPolling();
})();
void current;
