/**
 * Copy, cut, paste (⌘C / ⌘X / ⌘V, and the right-click menu) for all three diagram kinds.
 *
 * What's copied goes to the system clipboard as readable text — JSON for system diagrams, the text format
 * for sequence and class diagrams — and is also kept in this app (localStorage), so the right-click Paste
 * works without clipboard permission and across tabs and windows. Pasting text from elsewhere works too:
 * a cistem file or selection, sequence text / Mermaid / PlantUML, class text (Java/Kotlin/Mermaid go
 * through the class editor's own import).
 */
import { state, renderAll, mutate, select, selectedNodeIds, esc } from './state';
import { readAny } from './document';
import { parseSeq, printSeq, blockEnd, rowId, slugId, type Row, type Participant } from './seq';
import { parseCls, printCls, boxSize, relId, type ClassDoc, type ClassBox } from './cls';
import type { Node, Edge, Container, Link, Frame } from './model';
import { hint, pointerWorld, worldAt } from './canvas';

const MARK = 'cistem-clipboard';
const SEQ_MARK = '# cistem copy';
const CLS_MARK = '%% cistem copy';
const STORE = 'cistem.clip';
type Kind = 'system' | 'sequence' | 'class';
interface Clip { kind: Kind; text: string }
interface SysClip { [MARK]: 1; kind: 'system'; nodes: Node[]; edges: Edge[]; containers: Container[]; links: Link[]; frames: Record<string, Frame> }

/** Delete and duplicate, per kind, supplied by each editor. */
export const actions: Partial<Record<Kind, { del(): void; dup(): void }>> = {};

let pasteCount = 0;       // repeated pastes of the same copy step further away
let lastText = '';
const isTyping = (t: EventTarget | null) => { const e = t as HTMLElement | null; return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.isContentEditable || !!e.closest?.('.cm-editor')); };
function keep(c: Clip) { try { localStorage.setItem(STORE, JSON.stringify(c)); } catch { /* ignore */ } }
function kept(): Clip | null { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } }

// ---------- copy ----------

/** The current selection as clipboard text, or null when nothing is selected. */
export function copyText(): Clip | null {
  if (state.kind === 'system') return copySystem();
  if (state.kind === 'sequence') return copySequence();
  return copyClass();
}
function copySystem(): Clip | null {
  const d = state.doc;
  // environments selected bring everything inside them (nested environments included)
  const cids = new Set<string>();
  if (state.sel?.type === 'container') cids.add(state.sel.id);
  for (let grew = true; grew;) { grew = false; for (const c of d.containers) if (c.parent && cids.has(c.parent) && !cids.has(c.id)) { cids.add(c.id); grew = true; } }
  const nids = new Set([...selectedNodeIds(), ...d.nodes.filter(n => n.container && cids.has(n.container)).map(n => n.id)]);
  if (!nids.size && !cids.size) return null;
  const clip: SysClip = {
    [MARK]: 1, kind: 'system',
    nodes: d.nodes.filter(n => nids.has(n.id)),
    edges: d.edges.filter(e => nids.has(e.from) && nids.has(e.to)),
    containers: d.containers.filter(c => cids.has(c.id)),
    links: d.links.filter(l => cids.has(l.from) && cids.has(l.to)),
    frames: Object.fromEntries([...cids].filter(id => d.frames[id]).map(id => [id, d.frames[id]])),
  };
  return { kind: 'system', text: JSON.stringify(clip, null, 2) };
}
function copySequence(): Clip | null {
  const d = state.seq, s = state.sel;
  if (s?.type === 'part') {
    const p = d.participants.find(x => x.id === s.id); if (!p) return null;
    return { kind: 'sequence', text: `${SEQ_MARK}\n` + printSeq({ participants: [p], rows: [] }) };
  }
  const ids = new Set([...state.multi, ...(s?.type === 'row' ? [s.id] : [])]);
  if (!ids.size) return null;
  const take = new Set<number>();
  d.rows.forEach((r, i) => {
    if (!ids.has(r.id)) return;
    if (r.t === 'open') { const e = blockEnd(d.rows, i); for (let k = i; k <= e; k++) take.add(k); }
    else if (r.t === 'msg' || r.t === 'note') take.add(i);
  });
  if (!take.size) return null;
  const rows = [...take].sort((a, b) => a - b).map(i => d.rows[i]);
  const used = new Set(rows.flatMap(r => r.t === 'msg' ? [r.from, r.to] : r.t === 'note' ? r.over : []));
  return { kind: 'sequence', text: `${SEQ_MARK}\n` + printSeq({ participants: d.participants.filter(p => used.has(p.id)), rows }) };
}
function copyClass(): Clip | null {
  const d = state.cls;
  const names = new Set([...state.multi, ...(state.sel?.type === 'class' ? [state.sel.id] : [])].filter(n => d.classes.some(c => c.name === n)));
  if (!names.size) return null;
  const sub: ClassDoc = { classes: d.classes.filter(c => names.has(c.name)), relations: d.relations.filter(r => names.has(r.from) && names.has(r.to)), pos: {} };
  const pos = Object.fromEntries([...names].filter(n => d.pos[n]).map(n => [n, d.pos[n]]));
  return { kind: 'class', text: `${CLS_MARK} ${JSON.stringify(pos)}\n` + printCls(sub) };
}

// ---------- paste ----------

/** Paste text into the open diagram. Returns false when the text isn't something this kind can take. */
export function pasteText(text: string, at?: { x: number; y: number } | null): boolean {
  if (text !== lastText) { lastText = text; pasteCount = 0; }
  pasteCount++;
  if (state.kind === 'system') return pasteSystem(text, at ?? pointerWorld());
  if (state.kind === 'sequence') return pasteSequence(text);
  return pasteClass(text);
}

function pasteSystem(text: string, at: { x: number; y: number } | null): boolean {
  let clip: SysClip | null = null;
  const origHome: Record<string, string> = {};   // environments the copied items were in (the reader drops ones not in the copy)
  try {
    const j = JSON.parse(text);
    if (j && j[MARK] === 1 && j.kind === 'system') {
      for (const n of Array.isArray(j.nodes) ? j.nodes : []) if (n && typeof n.id === 'string' && typeof n.container === 'string') origHome[n.id] = n.container;
      for (const c of Array.isArray(j.containers) ? j.containers : []) if (c && typeof c.id === 'string' && typeof c.parent === 'string') origHome[c.id] = c.parent;
      // a selection (from this app, or edited by hand): read it through the file reader so it's sanitised
      const l = readAny({ version: 4, kind: 'system', meta: { title: '' }, model: { nodes: j.nodes ?? [], edges: j.edges ?? [], containers: j.containers ?? [], links: j.links ?? [] }, layout: { positions: Object.fromEntries((j.nodes ?? []).map((n: Node) => [n.id, { x: n.x, y: n.y }])), frames: j.frames ?? {} } });
      if (l.kind === 'system') clip = { [MARK]: 1, kind: 'system', nodes: l.doc.nodes, edges: l.doc.edges, containers: l.doc.containers, links: l.doc.links, frames: l.doc.frames };
    } else if (j && j.kind === 'system' && j.model) {
      const l = readAny(j);   // a whole diagram file: paste its contents
      if (l.kind === 'system') clip = { [MARK]: 1, kind: 'system', nodes: l.doc.nodes, edges: l.doc.edges, containers: l.doc.containers, links: l.doc.links, frames: l.doc.frames };
    }
  } catch { return false; }
  if (!clip || (!clip.nodes.length && !clip.containers.length)) return false;
  const d = state.doc;
  // where it lands: at the pointer when it's over the canvas, otherwise stepped down-right of the original
  const xs = [...clip.nodes.map(n => n.x), ...Object.values(clip.frames).map(f => f.x)], ys = [...clip.nodes.map(n => n.y), ...Object.values(clip.frames).map(f => f.y)];
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const snap = (v: number) => Math.round(v / 8) * 8;
  const dx = at ? snap(at.x - minX) : 32 * pasteCount, dy = at ? snap(at.y - minY) : 32 * pasteCount;
  const taken = new Set([...d.nodes, ...d.edges, ...d.containers, ...d.links].map(x => x.id));
  const fresh = (p: string) => { let id: string; do id = p + Math.random().toString(36).slice(2, 8); while (taken.has(id)); taken.add(id); return id; };
  const cmap: Record<string, string> = {}, nmap: Record<string, string> = {};
  clip.containers.forEach(c => (cmap[c.id] = fresh('c')));
  clip.nodes.forEach(n => (nmap[n.id] = fresh('n')));
  const existsC = (id: string | null | undefined) => !!id && d.containers.some(c => c.id === id);
  mutate(() => {
    for (const c of clip!.containers) {
      const up = c.parent ?? origHome[c.id];
      d.containers.push({ ...c, id: cmap[c.id], parent: up ? (cmap[up] ?? (existsC(up) ? up : null)) : null });
      const f = clip!.frames[c.id]; if (f) d.frames[cmap[c.id]] = { ...f, x: f.x + dx, y: f.y + dy };
    }
    for (const n of clip!.nodes) {
      // stays in its environment when pasted beside the original; dropped at the pointer it lands outside any
      const home = n.container ?? origHome[n.id];
      const container = home ? (cmap[home] ?? (existsC(home) && !at ? home : null)) : null;
      d.nodes.push({ ...JSON.parse(JSON.stringify(n)), id: nmap[n.id], x: n.x + dx, y: n.y + dy, container });
    }
    for (const e of clip!.edges) if (nmap[e.from] && nmap[e.to]) d.edges.push({ ...e, id: fresh('e'), from: nmap[e.from], to: nmap[e.to] });
    for (const l of clip!.links) if (cmap[l.from] && cmap[l.to]) d.links.push({ ...l, id: fresh('l'), from: cmap[l.from], to: cmap[l.to] });
  });
  const newNodes = Object.values(nmap);
  if (newNodes.length) { state.sel = { type: 'node', id: newNodes[0] }; state.multi = new Set(newNodes.slice(1)); }
  else select({ type: 'container', id: Object.values(cmap)[0] });
  renderAll();
  return true;
}

function pasteSequence(text: string): boolean {
  const p = parseSeq(text);
  if (p.errors.length) { hint(`Couldn't paste: line ${p.errors[0].line + 1} — ${p.errors[0].message}`, 2600); return true; }
  if (!p.doc.participants.length && !p.doc.rows.length) return false;
  const d = state.seq;
  const newIds: string[] = [];
  mutate(() => {
    // a lifeline pasted on its own is a new lifeline; lifelines named by pasted messages reuse existing ones
    const alone = !p.doc.rows.length;
    const map: Record<string, string> = {};
    for (const x of p.doc.participants) {
      if (!alone && d.participants.some(y => y.id === x.id)) { map[x.id] = x.id; continue; }
      const id = d.participants.some(y => y.id === x.id) ? slugId(x.id, d.participants.map(y => y.id)) : x.id;
      map[x.id] = id; d.participants.push({ ...x, id } as Participant); if (alone) newIds.push(id);
    }
    const rows: Row[] = p.doc.rows.map(r => {
      const c = { ...r, id: rowId() } as Row;
      if (c.t === 'msg') { c.from = map[c.from] ?? c.from; c.to = map[c.to] ?? c.to; }
      if (c.t === 'note') c.over = c.over.map(o => map[o] ?? o);
      return c;
    });
    // after the selected row (after the whole block if it's a block), else at the end
    const i = state.sel?.type === 'row' ? d.rows.findIndex(r => r.id === state.sel!.id) : -1;
    const at = i < 0 ? d.rows.length : d.rows[i].t === 'open' ? blockEnd(d.rows, i) + 1 : i + 1;
    d.rows.splice(at, 0, ...rows);
    newIds.push(...rows.filter(r => r.t !== 'close' && r.t !== 'else').map(r => r.id));
  });
  if (newIds.length) {
    const first = newIds[0];
    if (d.participants.some(x => x.id === first)) { state.sel = { type: 'part', id: first }; state.multi.clear(); }
    else { state.sel = { type: 'row', id: first }; state.multi = new Set(newIds.slice(1)); }
  }
  renderAll();
  return true;
}

function pasteClass(text: string): boolean {
  const first = text.split('\n', 1)[0];
  if (!first.startsWith(CLS_MARK)) return false;   // Java, Kotlin, Mermaid, plain text: the class editor imports those
  let pos: Record<string, { x: number; y: number }> = {};
  try { pos = JSON.parse(first.slice(CLS_MARK.length).trim() || '{}'); } catch { /* positions are optional */ }
  const p = parseCls(text);
  if (p.errors.length || !p.doc.classes.length) { hint(p.errors[0] ? `Couldn't paste: ${p.errors[0].message}` : 'Nothing to paste', 2400); return true; }
  const d = state.cls;
  const rename: Record<string, string> = {};
  const has = (n: string) => d.classes.some(c => c.name === n) || Object.values(rename).includes(n);
  for (const c of p.doc.classes) { let n = c.name; if (has(n)) { n = c.name + 'Copy'; let k = 2; while (has(n)) n = c.name + 'Copy' + k++; } rename[c.name] = n; }
  const names = Object.values(rename);
  mutate(() => {
    let i = 0;
    for (const c of p.doc.classes) {
      const name = rename[c.name];
      d.classes.push({ ...(c as ClassBox), name });
      const o = pos[c.name];
      const s = boxSize(c);
      d.pos[name] = o ? { x: o.x + 32 * pasteCount, y: o.y + 32 * pasteCount } : { x: 40 + (i++) * (s.w + 40), y: 40 };
    }
    for (const r of p.doc.relations) d.relations.push({ ...r, id: relId(), from: rename[r.from] ?? r.from, to: rename[r.to] ?? r.to });
  });
  state.sel = { type: 'class', id: names[0] }; state.multi = new Set(names.slice(1));
  renderAll();
  return true;
}

// ---------- keyboard: the browser's copy / cut / paste events ----------

document.addEventListener('copy', ev => {
  if (isTyping(ev.target) || isTyping(document.activeElement)) return;
  const c = copyText(); if (!c) return;
  ev.preventDefault(); ev.clipboardData?.setData('text/plain', c.text); keep(c); lastText = c.text; pasteCount = 0;
  hint(`Copied ${what(c)}`, 1200);
});
document.addEventListener('cut', ev => {
  if (isTyping(ev.target) || isTyping(document.activeElement)) return;
  const c = copyText(); if (!c) return;
  ev.preventDefault(); ev.clipboardData?.setData('text/plain', c.text); keep(c); lastText = c.text; pasteCount = -1;   // the first paste lands where it was cut from
  actions[state.kind]?.del();
});
// capture: runs before the class editor's own paste-to-import, which handles code from elsewhere
document.addEventListener('paste', ev => {
  if (isTyping(ev.target) || isTyping(document.activeElement)) return;
  const text = ev.clipboardData?.getData('text/plain') ?? ''; if (!text.trim()) return;
  if (pasteText(text)) { ev.preventDefault(); ev.stopImmediatePropagation(); }
}, true);
function what(c: Clip) {
  if (c.kind === 'system') { try { const j = JSON.parse(c.text); const n = j.nodes.length, k = j.containers.length; return [n && `${n} component${n === 1 ? '' : 's'}`, k && `${k} environment${k === 1 ? '' : 's'}`].filter(Boolean).join(' and '); } catch { return 'selection'; } }
  if (c.kind === 'sequence') { const n = (c.text.match(/->|-->|->>/g) ?? []).length; return n ? `${n} message${n === 1 ? '' : 's'}` : 'lifeline'; }
  const n = (c.text.match(/^(abstract class|class|interface|enum|record) /gm) ?? []).length; return `${n} class${n === 1 ? '' : 'es'}`;
}

// ---------- the right-click menu ----------

const menu = document.getElementById('ctxMenu') as HTMLElement;
let menuAt: { x: number; y: number } | null = null;
const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
export function openMenu(clientX: number, clientY: number, worldAt: { x: number; y: number } | null) {
  menuAt = worldAt;
  const has = !!copyText(), clip = kept(), canPaste = !!clip && clip.kind === state.kind;
  const item = (act: string, label: string, keys: string, on: boolean) => `<button role="menuitem" data-ctx="${act}" ${on ? '' : 'disabled'}><span>${label}</span><kbd>${esc(keys)}</kbd></button>`;
  menu.innerHTML = item('cut', 'Cut', `${mod}X`, has) + item('copy', 'Copy', `${mod}C`, has) + item('paste', 'Paste', `${mod}V`, canPaste)
    + '<hr>' + item('dup', 'Duplicate', `${mod}D`, has) + item('del', 'Delete', '⌫', has);
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(clientX, innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(clientY, innerHeight - r.height - 8) + 'px';
  menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}
export function closeMenu() { menu.hidden = true; }
menu.addEventListener('click', ev => {
  const b = (ev.target as Element).closest<HTMLButtonElement>('[data-ctx]'); if (!b || b.disabled) return;
  closeMenu();
  const c = copyText();
  switch (b.dataset.ctx) {
    case 'copy': if (c) { keep(c); lastText = c.text; pasteCount = 0; navigator.clipboard?.writeText(c.text).catch(() => {}); hint(`Copied ${what(c)}`, 1200); } break;
    case 'cut': if (c) { keep(c); lastText = c.text; pasteCount = -1; navigator.clipboard?.writeText(c.text).catch(() => {}); actions[state.kind]?.del(); } break;
    case 'paste': { const k = kept(); if (k) pasteText(k.text, menuAt); break; }
    case 'dup': actions[state.kind]?.dup(); break;
    case 'del': actions[state.kind]?.del(); break;
  }
});
menu.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') { ev.stopPropagation(); closeMenu(); }
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
});
document.addEventListener('pointerdown', ev => { if (!menu.hidden && !(ev.target as Element).closest('#ctxMenu')) closeMenu(); }, true);
window.addEventListener('blur', closeMenu);

// right-click on any of the three canvases: select what's under the pointer, then show the menu
function selectUnder(t: Element) {
  const pick = (sel: Parameters<typeof select>[0], inSel: boolean) => { if (!inSel) { select(sel); renderAll(); } };
  if (state.kind === 'system') {
    const n = t.closest<SVGElement>('[data-node]')?.dataset.node, e = t.closest<SVGElement>('[data-edge]')?.dataset.edge, c = t.closest<SVGElement>('[data-container]')?.dataset.container;
    if (n) pick({ type: 'node', id: n }, selectedNodeIds().includes(n));
    else if (e) pick({ type: 'edge', id: e }, state.sel?.id === e);
    else if (c) pick({ type: 'container', id: c }, state.sel?.id === c);
    else if (state.sel || state.multi.size) { state.multi.clear(); select(null); renderAll(); }
  } else if (state.kind === 'sequence') {
    const r = t.closest<SVGElement>('[data-row]')?.dataset.row, h = t.closest<SVGElement>('[data-head]')?.dataset.head;
    if (h) pick({ type: 'part', id: h }, state.sel?.id === h);
    else if (r) pick({ type: 'row', id: r }, state.sel?.id === r || state.multi.has(r));
    else if (state.sel || state.multi.size) { state.multi.clear(); select(null); renderAll(); }
  } else {
    const k = t.closest<SVGElement>('[data-class]')?.dataset.class, r = t.closest<SVGElement>('[data-rel]')?.dataset.rel;
    if (k) pick({ type: 'class', id: k }, state.sel?.id === k || state.multi.has(k));
    else if (r) pick({ type: 'rel', id: r }, state.sel?.id === r);
    else if (state.sel || state.multi.size) { state.multi.clear(); select(null); renderAll(); }
  }
}
for (const id of ['svg', 'seqSvg', 'clsSvg']) {
  document.getElementById(id)?.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    selectUnder(ev.target as Element);
    openMenu(ev.clientX, ev.clientY, state.kind === 'system' ? worldAt(ev.clientX, ev.clientY) : null);
  });
}
