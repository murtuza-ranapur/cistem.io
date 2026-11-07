import { totalRps, typeDef, isSource, detailOf as typeDetail, hasSchemaDetail, CONTAINER_COLORS, KINDS, METHODS, PG_TYPES, EVICTIONS, CONTAINER_KINDS, LINK_TYPES, CROSSING_DEFAULT_MS, ancestry, nextId, type Node, type Edge, type ServiceNode, type DbNode, type QueueNode, type EntryNode, type Container, type ContainerKind } from './model';
import { state, fmt, esc, current, on, renderCanvas, renderAll, mutate, select } from './state';
import * as history from './history';
import { toDbml, parseDbml, quickColumn, PG_TYPE_LIST } from './dbml';
import { parseJsonFields, jsonFieldsToText, parseAvro, avroToText, listAt, J_TYPES, A_TYPES, COMMON_HEADERS, HEADER_VALUES, type JField, type AField, type JType, type ARecord } from './fields';

const inspector = document.getElementById('inspector') as HTMLElement;
let tab: 'capacity' | 'schema' = 'capacity';
let openCol = '';                   // the one column row being edited ("node:table:col")
const tblMode = new Map<string, 'rows' | 'code'>();
const dbDrafts = new Map<string, string>(); // text that doesn't parse yet (kept so a redraw doesn't lose it)
let focusAfterDraw = '';
const refResolver = () => ({
  nameToId: (name: string) => state.doc.nodes.find(x => typeDetail(x) === 'tables' && x.name === name)?.id ?? null,
  idToName: (id: string) => state.doc.nodes.find(x => x.id === id)?.name ?? null,
});
const refLabel = (r: string) => { const m = /^([^:]+):(.+)$/.exec(r); return m ? `${state.doc.nodes.find(x => x.id === m[1])?.name ?? m[1]}.${m[2]}` : r; };
function tblStatus(n: DbNode) {
  const d = dbDrafts.get(n.id);
  if (d !== undefined) { const e = parseDbml(d, refResolver()).errors.length; return `<span class="bad">●</span> ${e} problem${e === 1 ? '' : 's'} — the diagram keeps the last valid version`; }
  const ts = n.tables || [];
  return `<span class="good">●</span> ${ts.length} table${ts.length === 1 ? '' : 's'} · ${ts.reduce((a, t) => a + (t.columns || []).length, 0)} columns`;
}
const body = document.getElementById('sheetBody') as HTMLElement;

const icon = (kind: string) => `<svg style="stroke:var(--c-${kind});fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round"><use href="#ic-${kind}"/></svg>`;
const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
const inp = (path: string, label: string, val: unknown, type = 'text', extra = '') =>
  `<label>${cap(label)}<input data-path="${path}" type="${type}" ${type === 'number' ? 'step="any"' : ''} value="${esc(val)}" ${extra}></label>`;
const selIn = (path: string, label: string, val: string, opts: string[], cls = '') =>
  `<label>${cap(label)}<select data-path="${path}" class="${cls}">${opts.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
const chk = (path: string, label: string, val: boolean) => `<label class="check"><input data-path="${path}" type="checkbox" ${val ? 'checked' : ''}>${label}</label>`;
const addBtn = (action: string, label: string) => `<button class="small" data-action="${action}">+ ${label}</button>`;
const xBtn = (action: string) => `<button class="x" data-action="${action}" aria-label="Remove">×</button>`;

// ---------- structured body / schema editors ----------
// Bodies and Avro schemas are stored as JSON text; the editor shows them as a tree of fields
// (name · type · example / nullable) and writes the text back on every change. A JSON tab keeps
// the raw text reachable for pasting; anything the tree can't express stays in that tab.
type FeMode = 'fields' | 'code';
const feModes = new Map<string, FeMode>();
const feKey = (path: string) => (state.sel?.id ?? '') + ':' + path;
const optList = (opts: string[], val: string) => opts.map(o => `<option value="${esc(o)}" ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('');
function fieldEditor(path: string, label: string, text: string, kind: 'json' | 'avro'): string {
  const parsed = kind === 'json' ? parseJsonFields(text) : parseAvro(text);
  const canTree = parsed !== null;
  const mode: FeMode = canTree ? (feModes.get(feKey(path)) ?? 'code') : 'code';
  let h = `<div class="fe" data-fe="${path}" data-kind="${kind}"><div class="fe-head"><span>${label}</span><span class="spacer"></span>`;
  h += `<button data-femode="code" class="${mode === 'code' ? 'on' : ''}">Code</button>`;
  h += `<button data-femode="fields" class="${mode === 'fields' ? 'on' : ''}" ${canTree ? '' : `disabled title="${kind === 'json' ? 'Fields view needs a JSON object at the top level' : 'Fields view handles records with primitive, logical, enum, array, map and nested record types'}"`}>Fields</button>`;
  if (mode === 'code') h += `<button class="fe-tool" data-feformat title="Format (⇧⌥F)" aria-label="Format">{ }</button><button class="fe-tool" data-feexpand title="Open larger" aria-label="Open larger"><svg><use href="#ic-expand"/></svg></button>`;
  h += '</div>';
  if (mode === 'code') {
    h += `<div class="cm-host" data-cm="${path}" data-kind="${kind}"><pre class="cm-pre">${esc(text) || '&nbsp;'}</pre></div>`;
  } else if (kind === 'json') {
    h += jsonRows(parsed as JField[], '', 0) + feAdd('', 0);
  } else {
    const r = parsed as ARecord;
    h += `<div class="row rec"><label>Record<input data-fk="recname" value="${esc(r.name)}" placeholder="PaymentAuthorised"></label><label>Namespace<input data-fk="namespace" value="${esc(r.namespace)}" placeholder="com.example"></label></div>`;
    h += avroRows(r.fields, '', 0) + feAdd('', 0);
  }
  return h + '</div>';
}

// ---------- code editors (CodeMirror, loaded on first use) ----------
type CodeMod = typeof import('./code');
let codeMod: Promise<CodeMod> | null = null;
const loadCode = () => (codeMod ??= import('./code'));
let views: { path: string; view: import('@codemirror/view').EditorView }[] = [];

/** Field names worth suggesting in a body: connected tables and topics first, then other bodies in the diagram. */
function bodyVocab(nodeId: string) {
  const keys: { name: string; from: string; example?: unknown }[] = [];
  const doc = state.doc;
  const linked = new Set(doc.edges.filter(e => e.from === nodeId).map(e => e.to).concat(doc.edges.filter(e => e.to === nodeId).map(e => e.from)));
  for (const n of doc.nodes) {
    if (!linked.has(n.id)) continue;
    if (typeDetail(n) === 'tables') for (const t of (n as DbNode).tables || []) for (const c of t.columns || []) if (c.name) keys.push({ name: c.name, from: `${n.name}.${t.name}` });
    if (hasSchemaDetail(n)) for (const f of parseAvro((n as QueueNode).schema)?.fields ?? []) if (f.name) keys.push({ name: f.name, from: n.name });
  }
  const walk = (v: unknown, from: string) => {
    if (Array.isArray(v)) { v.forEach(x => walk(x, from)); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) { keys.push({ name: k, from, example: x !== null && typeof x === 'object' ? undefined : x }); walk(x, from); }
  };
  const services = [...doc.nodes.filter(n => n.id === nodeId), ...doc.nodes.filter(n => n.id !== nodeId)];
  for (const n of services) if (typeDetail(n) === 'endpoints') for (const ep of (n as ServiceNode).endpoints || []) for (const body of [ep.req, ep.res]) {
    try { walk(JSON.parse(body), `${ep.method} ${ep.path}`); } catch { /* skip */ }
  }
  return { keys };
}

function dbEditorOptions(nodeId: string, big = false) {
  const n = () => state.doc.nodes.find(x => x.id === nodeId) as DbNode | undefined;
  return {
    big,
    doc: dbDrafts.get(nodeId) ?? toDbml(n()?.tables || [], refResolver()),
    resolver: refResolver(),
    externalTargets: () => state.doc.nodes.filter(x => typeDetail(x) === 'tables' && x.id !== nodeId).flatMap(x => ((x as DbNode).tables || []).flatMap(t => (t.columns || []).filter(c => c.pk).map(c => `${x.name}.${t.name}.${c.name}`))),
    onFocus: () => history.snapshot(state.doc),
    onChange: (text: string) => {
      const node = n(); if (!node) return;
      const p = parseDbml(text, refResolver());
      if (p.errors.length) dbDrafts.set(nodeId, text);
      else { dbDrafts.delete(nodeId); node.tables = p.tables; renderCanvas(); }
      const st = body.querySelector<HTMLElement>('[data-tblstatus]'); if (st) st.innerHTML = tblStatus(node);
    },
  };
}
function openBigTables() {
  const t = current() as DbNode; if (!t) return;
  const ov = document.createElement('div');
  ov.className = 'cm-overlay';
  ov.innerHTML = `<div class="cm-dialog" role="dialog" aria-label="Tables"><div class="cm-dhead"><strong>${esc(t.name)}</strong><span>tables</span><span class="spacer"></span><button class="icon" data-close aria-label="Close" title="Close (Esc)"><svg><use href="#ic-close"/></svg></button></div><div class="cm-dbody"></div><div class="cm-dfoot">Ctrl-Space suggestions · paste CREATE TABLE SQL to convert · Esc close</div></div>`;
  document.body.appendChild(ov);
  let view: import('@codemirror/view').EditorView | undefined;
  const close = () => { view?.destroy(); ov.remove(); drawSheet(); };
  loadCode().then(m => { view = m.mountDbml(ov.querySelector('.cm-dbody')!, dbEditorOptions(t.id, true)); view.focus(); });
  ov.addEventListener('mousedown', ev => { if (ev.target === ov) close(); });
  ov.querySelector<HTMLElement>('[data-close]')!.onclick = close;
  ov.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !ov.querySelector('.cm-tooltip-autocomplete')) { ev.stopPropagation(); close(); } });
}

function mountEditors() {
  const dbHost = body.querySelector<HTMLElement>('.cm-host[data-cmdb]');
  if (dbHost) loadCode().then(m => {
    if (!dbHost.isConnected) return;
    const view = m.mountDbml(dbHost, dbEditorOptions(dbHost.dataset.cmdb!));
    views.push({ path: 'tables', view });
    if (refocus && refocus.path === 'tables') { view.focus(); view.dispatch({ selection: { anchor: Math.min(refocus.at, view.state.doc.length) } }); refocus = null; }
  });
  const hosts = body.querySelectorAll<HTMLElement>('.cm-host[data-cm]');
  if (!hosts.length) return;
  const sel = state.sel?.id;
  loadCode().then(m => {
    if (state.sel?.id !== sel) return;
    hosts.forEach(host => {
      if (!host.isConnected) return;
      const path = host.dataset.cm!, kind = host.dataset.kind as 'json' | 'avro';
      const t = current(); if (!t) return;
      const view = m.mountCode(host, {
        kind, doc: getPath(t, path) ?? '',
        onFocus: () => history.snapshot(state.doc),
        onChange: text => { const cur = current(); if (!cur) return; setPath(cur, path, text); renderCanvas(); },
        vocab: () => bodyVocab((current() as Node)?.id ?? ''),
      });
      views.push({ path, view });
      if (refocus && refocus.path === path) { view.focus(); view.dispatch({ selection: { anchor: Math.min(refocus.at, view.state.doc.length) } }); refocus = null; }
    });
  });
}
let refocus: { path: string; at: number } | null = null;
function teardownEditors() {
  const active = views.find(v => v.view.hasFocus);
  refocus = active ? { path: active.path, at: active.view.state.selection.main.head } : null;
  views.forEach(v => v.view.destroy()); views = [];
}

/** The same editor, big, over everything (the panel is narrow). */
function openBigEditor(path: string, kind: 'json' | 'avro', label: string) {
  const t = current(); if (!t) return;
  const ov = document.createElement('div');
  ov.className = 'cm-overlay';
  ov.innerHTML = `<div class="cm-dialog" role="dialog" aria-label="${esc(label)}"><div class="cm-dhead"><strong>${esc((t as Node).name ?? '')}</strong><span>${esc(label)}</span><span class="spacer"></span><button class="small" data-fmt>Format</button><button class="icon" data-close aria-label="Close" title="Close (Esc)"><svg><use href="#ic-close"/></svg></button></div><div class="cm-dbody"></div><div class="cm-dfoot">Ctrl-Space suggestions · ⇧⌥F format · Esc close</div></div>`;
  document.body.appendChild(ov);
  const close = () => { view?.destroy(); ov.remove(); drawSheet(); };
  let view: import('@codemirror/view').EditorView | undefined;
  loadCode().then(m => {
    view = m.mountCode(ov.querySelector('.cm-dbody')!, {
      kind, big: true, doc: getPath(t, path) ?? '',
      onFocus: () => history.snapshot(state.doc),
      onChange: text => { setPath(t, path, text); renderCanvas(); },
      vocab: () => bodyVocab((t as Node).id),
    });
    view.focus();
    ov.querySelector<HTMLElement>('[data-fmt]')!.onclick = () => { m.formatJson(view!); view!.focus(); };
  });
  ov.addEventListener('mousedown', ev => { if (ev.target === ov) close(); });
  ov.querySelector<HTMLElement>('[data-close]')!.onclick = close;
  ov.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !ov.querySelector('.cm-tooltip-autocomplete')) { ev.stopPropagation(); close(); } });
}

const feAdd = (listPath: string, depth: number) => `<div class="fe-row add" style="--d:${depth}"><button class="small" data-feact="add" data-flist="${listPath}">+ field</button></div>`;
const SCALARS: JType[] = ['string', 'number', 'integer', 'boolean', 'null'];
function jsonRows(fields: JField[], parent: string, depth: number): string {
  return fields.map((f, i) => {
    const p = parent ? `${parent}.${i}` : String(i);
    const t = f.type === 'array' ? (f.items || 'string') : f.type;
    const nested = t === 'object';
    let h = `<div class="fe-row ${nested ? 'nested' : ''}" style="--d:${depth}" data-fpath="${p}">`;
    h += `<input data-fk="name" value="${esc(f.name)}" placeholder="field" class="fname">`;
    h += `<select data-fk="type">${optList(J_TYPES, f.type)}</select>`;
    if (f.type === 'array') h += `<select data-fk="items" title="item type">${optList(SCALARS.concat('object'), t)}</select>`;
    if (SCALARS.includes(t) && t !== 'null') h += `<input data-fk="example" value="${esc(f.example)}" placeholder="example" class="fex">`;
    else if (!nested) h += '<span></span>';
    h += `<button class="x" data-feact="rm" aria-label="Remove">×</button></div>`;
    if (nested) h += jsonRows(f.children || [], p, depth + 1) + feAdd(p, depth + 1);
    return h;
  }).join('');
}
function avroRows(fields: AField[], parent: string, depth: number): string {
  return fields.map((f, i) => {
    const p = parent ? `${parent}.${i}` : String(i);
    const t = f.type === 'array' || f.type === 'map' ? (f.items || 'string') : f.type;
    const nested = t === 'record';
    let h = `<div class="fe-row avro ${nested ? 'nested' : ''}" style="--d:${depth}" data-fpath="${p}">`;
    h += `<input data-fk="name" value="${esc(f.name)}" placeholder="field" class="fname">`;
    h += `<select data-fk="type">${optList(A_TYPES, f.type)}</select>`;
    if (f.type === 'array' || f.type === 'map') h += `<select data-fk="items" title="${f.type === 'array' ? 'item type' : 'value type'}">${optList(A_TYPES.filter(x => x !== 'array' && x !== 'map' && x !== 'enum'), t)}</select>`;
    h += `<label class="check" title="nullable: union with null"><input type="checkbox" data-fk="nullable" ${f.nullable ? 'checked' : ''}>null</label>`;
    h += `<button class="x" data-feact="rm" aria-label="Remove">×</button></div>`;
    if (f.type === 'enum') h += `<div class="fe-row sub1" style="--d:${depth}" data-fpath="${p}"><input data-fk="symbols" value="${esc(f.symbols ?? '')}" placeholder="symbols: NEW, PAID, FAILED"></div>`;
    if (nested) h += `<div class="fe-row sub1" style="--d:${depth}" data-fpath="${p}"><input data-fk="typeName" value="${esc(f.typeName ?? '')}" placeholder="record name (e.g. Line)"></div>` + avroRows(f.children || [], p, depth + 1) + feAdd(p, depth + 1);
    return h;
  }).join('');
}
function getPath(obj: unknown, path: string): any { return path.split('.').reduce((o: any, k) => o?.[k], obj); }
/** Apply `fn` to the parsed tree behind a field editor, write the text back, and say whether the structure changed. */
function editTree(fe: HTMLElement, fn: (root: any[], rec: ARecord | null) => boolean | void): boolean {
  const t = current(); if (!t) return false;
  const path = fe.dataset.fe!, kind = fe.dataset.kind!;
  const text = getPath(t, path) ?? '';
  let structural = false;
  if (kind === 'json') { const fs = parseJsonFields(text); if (!fs) return false; structural = !!fn(fs, null); setPath(t, path, jsonFieldsToText(fs)); }
  else { const r = parseAvro(text); if (!r) return false; structural = !!fn(r.fields, r); setPath(t, path, avroToText(r)); }
  return structural;
}
const fieldAt = (root: any[], fpath: string) => { const idx = fpath.split('.'); const last = idx.pop()!; return listAt(root, idx.join('.'))[+last]; };

function hasSchema(n: Node) { return !!typeDetail(n); }
const schemaLabel = (n: Node) => ({ endpoints: 'Endpoints', tables: 'Tables', topic: 'Topic', message: 'Message' } as Record<string, string>)[typeDetail(n) ?? ''] ?? 'Detail';

function capacityTab(n: Node): string {
  const r = state.results.nodes[n.id];
  let h = '<div class="tab"><div class="props">' + inp('name', 'name', n.name).replace('<label>', '<label class="wide">');
  h += `<label class="wide">Environment<select data-path="container" data-nullable="1"><option value="" ${!n.container ? 'selected' : ''}>No environment</option>${containerOptions(n.container ?? null)}</select></label>`;
  // the type's own fields, as declared in shared/component-types.json
  for (const f of typeDef(n.kind).fields) {
    const v = (n as Record<string, unknown>)[f.key];
    let field = f.type === 'select' ? selIn(f.key, f.label, String(v ?? f.options?.[0] ?? ''), f.options ?? [])
      : f.type === 'boolean' ? chk(f.key, f.label, !!v)
      : inp(f.key, f.label, v ?? '', f.type === 'number' ? 'number' : 'text', [f.min !== undefined ? `min="${f.min}"` : '', f.max !== undefined ? `max="${f.max}"` : '', f.step !== undefined ? `step="${f.step}"` : ''].join(' '));
    if (f.wide) field = field.replace('<label>', '<label class="wide">').replace('<label class="check">', '<label class="check wide">');
    h += field;
  }
  if (isSource(n)) {
    const ps = (n as EntryNode).platforms || [];
    h += `<label class="wide">Platforms<div class="chips">${['web', 'app'].map(p => `<button data-platform="${p}" class="${ps.includes(p) ? 'on' : ''}">${p === 'web' ? 'Web' : 'App'}</button>`).join('')}</div></label>`;
  }
  h += '</div>';
  if (isSource(n)) h += `<p class="note">Peak requests per second these clients send. The diagram is tested at the sum of all clients — ${fmt(totalRps(state.doc))} rps — shown in the top bar.</p>`;
  else {
    const pct = isFinite(r.util) ? Math.round(r.util * 100) : 100;
    h += `<div class="stats">
      <div class="stat-tile"><div class="l">Load</div><div class="v">${fmt(r.load)} <small>rps</small></div></div>
      <div class="stat-tile"><div class="l">Capacity</div><div class="v">${fmt(r.cap)} <small>rps</small></div></div>
      <div class="stat-tile ${r.status}"><div class="l">Utilisation</div><div class="v">${isFinite(r.util) ? pct + '%' : '∞'}</div></div>
      <div class="stat-tile"><div class="l">Effective latency</div><div class="v">${r.lat.toFixed(1)} <small>ms</small></div></div>
      <div class="meter ${r.status}"><i style="width:${Math.min(100, pct)}%"></i></div>
    </div>`;
    h += `<p class="note">Headroom ${isFinite(r.cap) ? fmt(Math.max(0, r.cap - r.load)) + ' rps' : 'unlimited'}. Latency inflates as utilisation climbs (M/M/1 approximation).</p>`;
  }
  return h + '</div>';
}

function schemaTab(n: Node): string {
  let h = '<div class="tab">';
  const dk = typeDetail(n);
  if (dk === 'endpoints') {
    const eps = (n as ServiceNode).endpoints || [];
    h += `<section class="list"><h3>Endpoints <span class="spacer"></span>${addBtn('add-endpoint', 'endpoint')}</h3>`;
    eps.forEach((ep, i) => {
      h += `<div class="item"><div class="row ep">${selIn(`endpoints.${i}.method`, 'method', ep.method, METHODS, 'method')}${inp(`endpoints.${i}.path`, 'path', ep.path, 'text', 'placeholder="/v1/resource/{id}"')}${xBtn(`rm-endpoint:${i}`)}</div>`;
      h += `<div class="sub">Headers <span class="spacer"></span>${addBtn(`add-header:${i}`, 'header')}</div>`;
      (ep.headers || []).forEach((hd, j) => {
        const vals = [...new Set([...(HEADER_VALUES[hd.k] || []), ...(HEADER_VALUES[Object.keys(HEADER_VALUES).find(k => k.toLowerCase() === hd.k.toLowerCase()) || ''] || [])])];
        h += `<div class="row hdr">${inp(`endpoints.${i}.headers.${j}.k`, 'name', hd.k, 'text', 'list="hdrNames" placeholder="Header-Name"')}${inp(`endpoints.${i}.headers.${j}.v`, 'value', hd.v, 'text', `list="hv-${i}-${j}" placeholder="value"`)}${xBtn(`rm-header:${i}:${j}`)}<datalist id="hv-${i}-${j}">${vals.map(v => `<option value="${esc(v)}">`).join('')}</datalist></div>`;
      });
      h += `<div class="row stack">${fieldEditor(`endpoints.${i}.req`, 'request body', ep.req, 'json')}${fieldEditor(`endpoints.${i}.res`, 'response body', ep.res, 'json')}</div></div>`;
    });
    if (!eps.length) h += '<p class="empty">No endpoints yet.</p>';
    h += `<datalist id="hdrNames">${COMMON_HEADERS.map(v => `<option value="${v}">`).join('')}</datalist></section>`;
  }
  if (dk === 'tables') {
    const ts = (n as DbNode).tables || [];
    const mode = tblMode.get(n.id) ?? 'rows';
    h += `<section class="list"><h3>Tables <span class="spacer"></span><span class="seg"><button data-tblmode="rows" class="${mode === 'rows' ? 'on' : ''}">Rows</button><button data-tblmode="code" class="${mode === 'code' ? 'on' : ''}">Code</button></span>`;
    h += mode === 'code' ? `<button class="fe-tool" data-tblexpand title="Open larger" aria-label="Open larger"><svg><use href="#ic-expand"/></svg></button>` : addBtn('add-table', 'table');
    h += '</h3>';
    if (mode === 'code') {
      h += `<div class="cm-host" data-cmdb="${n.id}"><pre class="cm-pre">${esc(dbDrafts.get(n.id) ?? toDbml(ts, refResolver())) || '&nbsp;'}</pre></div>`;
      h += `<p class="tbl-status" data-tblstatus>${tblStatus(n as DbNode)}</p>`;
      h += `<p class="tbl-hint">Type <code>name type</code> per column; flags in <code>[pk, unique, index, default: …, ref: &gt; table.col]</code>; <code>?</code> after a type = nullable. Paste <code>CREATE TABLE</code> SQL to convert it.</p>`;
    } else {
      ts.forEach((t, i) => {
        const cols = t.columns || [];
        h += `<div class="tcard" data-t="${i}"><div class="thead"><input class="tname" data-path="tables.${i}.name" value="${esc(t.name)}" placeholder="table_name" spellcheck="false" aria-label="Table name"><span class="tcount">${cols.length} column${cols.length === 1 ? '' : 's'}</span><button class="icon danger tdel" data-action="rm-table:${i}" title="Delete table" aria-label="Delete table"><svg><use href="#ic-trash"/></svg></button></div>`;
        cols.forEach((c, j) => {
          const key = `${n.id}:${i}:${j}`;
          if (openCol !== key) {
            const tags: string[] = [];
            if (c.references) tags.push(`<span class="tag fk">→ ${esc(refLabel(c.references))}</span>`);
            if (c.unique) tags.push('<span class="tag uq">UQ</span>');
            if (c.index) tags.push('<span class="tag ix">IX</span>');
            if (c.default) tags.push(`<span class="tdef">= ${esc(c.default)}</span>`);
            h += `<button class="trow" data-opencol="${key}" title="Edit column"><span class="tkey">${c.pk ? '<svg><use href="#ic-key"/></svg>' : ''}</span><span class="tn"><span class="tnm">${esc(c.name) || '<em>unnamed</em>'}</span><span class="tty">${esc(c.type)}${c.nullable && !c.pk ? '?' : ''}</span></span><span class="ttags">${tags.join('')}</span></button>`;
            return;
          }
          const base = `tables.${i}.columns.${j}`;
          const targets: string[] = [];
          for (const ot of ts) if (ot !== t) for (const oc of ot.columns || []) targets.push(`${ot.name}.${oc.name}`);
          for (const on of state.doc.nodes) if (typeDetail(on) === 'tables' && on.id !== n.id) for (const ot of (on as DbNode).tables || []) for (const oc of ot.columns || []) if (oc.pk) targets.push(`${on.id}:${ot.name}.${oc.name}`);
          const refOpts = ['', ...(c.references && !targets.includes(c.references) ? [c.references] : []), ...targets];
          const pill = (prop: string, label: string, on: boolean, cls: string) => `<button class="pill ${cls} ${on ? 'on' : ''}" data-flip="${base}.${prop}" aria-pressed="${on}">${label}</button>`;
          h += `<div class="tedit" data-col="${i}:${j}">`;
          h += `<div class="te2"><label>Name<input class="cname" data-path="${base}.name" value="${esc(c.name)}" spellcheck="false"></label><label>Type<input class="ctype" data-path="${base}.type" value="${esc(c.type)}" list="pgTypes" spellcheck="false"></label></div>`;
          h += `<div class="pills">${pill('pk', 'Primary key', c.pk, 'pk')}${`<button class="pill nn ${!c.nullable ? 'on' : ''}" data-flip="${base}.nullable" aria-pressed="${!c.nullable}">Not null</button>`}${pill('unique', 'Unique', !!c.unique, 'uq')}${pill('index', 'Index', !!c.index, 'ix')}</div>`;
          h += `<div class="te2 wide"><label>References<select data-path="${base}.references" data-nullable="1">${refOpts.map(o => `<option value="${esc(o)}" ${o === (c.references ?? '') ? 'selected' : ''}>${o ? esc(refLabel(o)) : 'none'}</option>`).join('')}</select></label><label>Default<input data-path="${base}.default" value="${esc(c.default ?? '')}" placeholder="now()" spellcheck="false"></label></div>`;
          h += `<div class="tefoot"><button class="linkish danger" data-action="rm-column:${i}:${j}">Delete column</button><button class="small primary" data-closecol>Done ↵</button></div></div>`;
        });
        h += `<div class="tadd"><span aria-hidden="true">+</span><input data-addcol="${i}" placeholder="add column — e.g. refunded_at timestamptz?" spellcheck="false" aria-label="Add column"></div><p class="tadd-err" data-adderr="${i}" hidden></p></div>`;
      });
      if (!ts.length) h += '<p class="empty">No tables yet.</p>';
    }
    h += `<datalist id="pgTypes">${PG_TYPE_LIST.map(v => `<option value="${v}">`).join('')}</datalist></section>`;
  }
  if (dk === 'message') {
    const q = n as QueueNode;
    const keyOpts = (parseAvro(q.schema)?.fields ?? []).map(f => f.name).filter(Boolean);
    h += `<section class="list"><h3>Message</h3>`;
    if (q.fifo) h += `<div class="props">${inp('key', 'Message group key', q.key ?? '', 'text', 'list="tkeys" placeholder="e.g. merchantId"').replace('<label>', '<label class="wide">')}<datalist id="tkeys">${keyOpts.map(v => `<option value="${esc(v)}">`).join('')}</datalist></div>`;
    h += `<div class="row stack">${fieldEditor('schema', 'Message schema (Avro)', q.schema, 'avro')}</div></section>`;
  }
  if (dk === 'topic') {
    const q = n as QueueNode;
    const keyOpts = (parseAvro(q.schema)?.fields ?? []).map(f => f.name).filter(Boolean);
    h += `<section class="list"><h3>Topic</h3><div class="props">`;
    h += inp('partitions', 'Partitions', q.partitions, 'number', 'min="1"');
    h += inp('key', 'Partition key', q.key ?? '', 'text', 'list="tkeys" placeholder="e.g. paymentId"') + `<datalist id="tkeys">${keyOpts.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
    h += inp('cluster', 'Cluster', q.cluster ?? '', 'text', 'placeholder="optional, e.g. msk-payments"').replace('<label>', '<label class="wide">');
    h += `</div><div class="row stack">${fieldEditor('schema', 'Value schema (Avro)', q.schema, 'avro')}</div></section>`;
  }
  return h + '</div>';
}

/** Options for a container picker, indented by depth; `exclude` hides a container and its descendants. */
function containerOptions(selected: string | null, exclude: string | null = null): string {
  const { doc } = state;
  const line = (c: Container) => {
    const d = ancestry(doc, c.id).length - 1;
    return `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${'\u00a0\u00a0'.repeat(d)}${esc(c.name)} · ${CONTAINER_KINDS[c.kind].label}</option>`;
  };
  const walk = (parent: string | null): string => doc.containers.filter(c => (c.parent ?? null) === parent && !(exclude && ancestry(doc, c.id).includes(exclude))).map(c => line(c) + walk(c.id)).join('');
  return walk(null);
}
const pathOf = (id: string | null) => ancestry(state.doc, id).reverse().map(cid => state.doc.containers.find(c => c.id === cid)?.name ?? cid).join(' / ');

function containerSheet(c: Container): string {
  const { doc } = state;
  const members = doc.nodes.filter(n => (n.container ?? null) === c.id);
  const children = doc.containers.filter(k => (k.parent ?? null) === c.id);
  const links = doc.links.filter(l => l.from === c.id || l.to === c.id);
  let h = `<div class="head"><span class="k" style="color:hsl(${CONTAINER_KINDS[c.kind].hue} 45% 45%)">${icon('container').replace('var(--c-container)', `hsl(${CONTAINER_KINDS[c.kind].hue} 45% 45%)`)}${CONTAINER_KINDS[c.kind].label}</span><strong>${esc(c.name)}</strong><span class="spacer"></span><button class="icon danger" data-action="delete-container" title="Delete (members stay)" aria-label="Delete"><svg><use href="#ic-trash"/></svg></button></div>`;
  h += `<div class="tab"><div class="props">${inp('name', 'name', c.name).replace('<label>', '<label class="wide">')}`;
  h += selIn('kind', 'kind', c.kind, Object.keys(CONTAINER_KINDS)).replace(/<option ([^>]*)>([a-z]+)<\/option>/g, (_m, attrs, k) => `<option ${attrs}>${CONTAINER_KINDS[k as ContainerKind].label}</option>`);
  h += `<label>Inside<select data-path="parent" data-nullable="1"><option value="" ${!c.parent ? 'selected' : ''}>Top level</option>${containerOptions(c.parent ?? null, c.id)}</select></label>`;
  h += inp('provider', 'provider', c.provider ?? '', 'text', 'placeholder="aws · ibm · gcp · on-prem"');
  h += inp('owner', 'owner', c.owner ?? '', 'text', 'placeholder="team or company"');
  h += `${inp('note', 'note', c.note ?? '').replace('<label>', '<label class="wide">')}</div>`;
  // look: colour, fill, border
  const kindHue = CONTAINER_KINDS[c.kind].hue;
  const sw = (key: string, hsl: string, title: string) => `<button class="swatch ${(c.color ?? '') === key ? 'on' : ''}" data-cstyle="color:${key}" style="--sw:${hsl}" title="${title}" aria-label="${title}" aria-pressed="${(c.color ?? '') === key}"></button>`;
  const seg = (prop: string, cur: string, opts: [string, string][]) => `<span class="seg">${opts.map(([v, l]) => `<button data-cstyle="${prop}:${v}" class="${cur === v ? 'on' : ''}" aria-pressed="${cur === v}">${l}</button>`).join('')}</span>`;
  h += `<div class="look"><div class="look-row"><span class="look-l">Colour</span><span class="swatches">${sw('', `hsl(${kindHue} 45% 55%)`, `Default for ${CONTAINER_KINDS[c.kind].label}`)}${(Object.keys(CONTAINER_COLORS) as (keyof typeof CONTAINER_COLORS)[]).map(k => sw(k, `hsl(${CONTAINER_COLORS[k].h} ${CONTAINER_COLORS[k].s}% 55%)`, k[0].toUpperCase() + k.slice(1))).join('')}</span></div>`;
  h += `<div class="look-row"><span class="look-l">Fill</span>${seg('fill', c.fill ?? 'tint', [['tint', 'Tinted'], ['solid', 'Solid'], ['outline', 'Outline']])}</div>`;
  h += `<div class="look-row"><span class="look-l">Border</span>${seg('border', c.border ?? 'dashed', [['dashed', 'Dashed'], ['solid', 'Solid']])}</div></div>`;
  h += `<div class="stats"><div class="stat-tile"><div class="l">Components</div><div class="v">${members.length}</div></div><div class="stat-tile"><div class="l">Nested</div><div class="v">${children.length}</div></div></div>`;
  if (c.parent) h += `<p class="note">${esc(pathOf(c.id))}</p>`;
  h += `<section class="list" style="margin-top:14px"><h3>Links to other environments <span class="spacer"></span>${addBtn('add-link', 'link')}</h3>`;
  links.forEach(l => {
    const other = l.from === c.id ? l.to : l.from;
    const i = doc.links.indexOf(l);
    h += `<div class="item"><div class="row topic"><label>To<select data-path="links.${i}.${l.from === c.id ? 'to' : 'from'}">${containerOptions(other, c.id)}</select></label>${selIn(`links.${i}.type`, 'type', l.type, Object.keys(LINK_TYPES).includes(l.type) ? Object.keys(LINK_TYPES) : [l.type, ...Object.keys(LINK_TYPES)])}${xBtn(`rm-link:${i}`)}</div><div class="row one">${inp(`links.${i}.latencyMs`, 'Added latency (ms)', l.latencyMs, 'number', 'min="0"')}<span></span></div></div>`;
  });
  if (!links.length) h += `<p class="empty">No links. Calls out of here cost ${CROSSING_DEFAULT_MS.siblings} ms to a sibling and ${CROSSING_DEFAULT_MS.differentRoots} ms to another cloud unless a link says otherwise.</p>`;
  h += '</section></div>';
  return h;
}

function nodeSheet(n: Node): string {
  let h = `<div class="head"><span class="k" style="color:var(--c-${n.kind})">${icon(n.kind)}${KINDS[n.kind].label}</span><strong>${esc(n.name)}</strong><span class="spacer"></span><button class="icon danger" data-action="delete-node" title="Delete (⌫)" aria-label="Delete"><svg><use href="#ic-trash"/></svg></button></div>`;
  if (hasSchema(n)) {
    h += `<div class="tabs"><button data-tab="capacity" class="${tab === 'capacity' ? 'on' : ''}">Capacity</button><button data-tab="schema" class="${tab === 'schema' ? 'on' : ''}">${schemaLabel(n)}</button></div>`;
    h += tab === 'schema' ? schemaTab(n) : capacityTab(n);
  } else h += capacityTab(n);
  const seqs = appearsIn(n.id);
  if (seqs.length) h += `<div class="appears"><span>Appears in</span>${seqs.map(s => `<button class="chip" data-opentab="${esc(s.key)}">⇅ ${esc(s.title)}</button>`).join('')}</div>`;
  return h;
}

function edgeSheet(e: Edge): string {
  const a = state.doc.nodes.find(n => n.id === e.from)!, b = state.doc.nodes.find(n => n.id === e.to)!;
  let h = `<div class="head"><span class="k">Edge</span><strong>${esc(a.name)} → ${esc(b.name)}</strong><span class="spacer"></span><button class="icon danger" data-action="delete-edge" title="Delete" aria-label="Delete"><svg><use href="#ic-trash"/></svg></button></div><div class="tab"><div class="props">${inp('calls', 'Calls per incoming request', e.calls, 'number', 'min="0"').replace('<label>', '<label class="wide">')}`;
  if (typeDetail(b) === 'endpoints' && (b.endpoints || []).length) {
    h += `<label class="wide">Endpoint called<select data-path="endpoint" data-int="1"><option value="">Unspecified</option>${(b.endpoints ?? []).map((ep, i) => `<option value="${i}" ${e.endpoint === i ? 'selected' : ''}>${esc(ep.method + ' ' + ep.path)}</option>`).join('')}</select></label>`;
  }
  h += `</div><div class="stats"><div class="stat-tile"><div class="l">Carries</div><div class="v">${fmt(state.results.edges[e.id] || 0)} <small>rps</small></div></div></div>${typeDef(a.kind).behaviour === 'cache' ? '<p class="note">Only cache misses travel down this edge.</p>' : ''}${typeDef(a.kind).behaviour === 'balancer' ? `<p class="note">The ${esc(typeDef(a.kind).label.toLowerCase())} splits its traffic evenly across outgoing edges.</p>` : ''}</div>`;
  return h;
}

function setPath(obj: unknown, path: string, val: unknown) {
  const parts = path.split('.');
  let o = obj as any;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = val;
}
function validateJson(t: HTMLTextAreaElement) {
  if (!t.value.trim()) { t.classList.remove('bad'); return; }
  try {
    const j = JSON.parse(t.value);
    if (t.dataset.validate === 'avro' && !(j && j.type === 'record' && Array.isArray(j.fields))) throw new Error('not an Avro record');
    t.classList.remove('bad');
  } catch { t.classList.add('bad'); }
}

// ---------- panel behaviour ----------
// auto:   opens when you click something, closes when nothing is selected
// pinned: always open (a placeholder when nothing is selected)
// hidden: never opens on its own — the toolbar button or `I` brings it back
export type PanelMode = 'auto' | 'pinned' | 'hidden';
const PANEL_KEY = 'cistem.panel';
let panelMode: PanelMode = (() => { try { const v = localStorage.getItem(PANEL_KEY); return v === 'pinned' || v === 'hidden' ? v : 'auto'; } catch { return 'auto'; } })();
let held = false;
const panelListeners: ((m: PanelMode) => void)[] = [];
export const getPanelMode = () => panelMode;
export const onPanelMode = (fn: (m: PanelMode) => void) => { panelListeners.push(fn); fn(panelMode); };
export function setPanelMode(m: PanelMode) {
  panelMode = m; try { localStorage.setItem(PANEL_KEY, m); } catch { /* ignore */ }
  panelListeners.forEach(f => f(m)); drawSheet();
}
/** Toolbar / `I`: hide if visible, otherwise show (pinned if it was hidden, so it stays put). */
export function togglePanel() { setPanelMode(inspector.classList.contains('closed') ? 'pinned' : 'hidden'); }
/** While a pointer gesture is in progress (dragging a node or frame) selecting must not pop the panel open. */
let quietFor = '';  // selection that was picked up by a drag: don't auto-open for it until it's clicked
const selKey = () => state.sel ? state.sel.type + ':' + state.sel.id : '';
export function holdPanel() { held = true; }
export function releasePanel(clicked: boolean) { held = false; quietFor = clicked ? '' : selKey(); if (clicked) drawSheet(); }

const bar = document.getElementById('inspBar') as HTMLElement;
bar.addEventListener('click', ev => {
  const b = (ev.target as Element).closest<HTMLElement>('[data-panel]'); if (!b) return;
  if (b.dataset.panel === 'close') setPanelMode('hidden');
  else setPanelMode(panelMode === 'pinned' ? 'auto' : 'pinned');
});
onPanelMode(m => { const pin = bar.querySelector<HTMLElement>('[data-panel="pin"]')!; pin.classList.toggle('on', m === 'pinned'); pin.title = m === 'pinned' ? 'Unpin — close when nothing is selected' : 'Pin — keep this panel open'; });

/** The sequence editor supplies its own panel and the "appears in" lookup (set from seqview.ts). */
const kindPanels: Partial<Record<string, (body: HTMLElement) => void>> = {};
let appearsIn: (nodeId: string) => { key: string; title: string }[] = () => [];
let openTab: (key: string) => void = () => {};
export function setSequencePanel(p: (body: HTMLElement) => void, a: typeof appearsIn, o: typeof openTab) { kindPanels.sequence = p; appearsIn = a; openTab = o; }
export function setKindPanel(kind: 'class', p: (body: HTMLElement) => void) { kindPanels[kind] = p; }
body.addEventListener('click', ev => { const b = (ev.target as Element).closest<HTMLElement>('[data-opentab]'); if (b) openTab(b.dataset.opentab!); });

export function drawSheet() {
  const kindPanel = kindPanels[state.kind];
  if (state.kind !== 'system' && kindPanel) {
    const isOpen = !inspector.classList.contains('closed');
    if (quietFor && quietFor !== selKey()) quietFor = '';
    const open = panelMode === 'hidden' ? false : panelMode === 'pinned' ? true : !!state.sel && (isOpen || (!held && !quietFor));
    inspector.classList.toggle('closed', !open);
    teardownEditors();
    if (open) kindPanel(body); else body.innerHTML = '';
    return;
  }
  const t = current();
  if (!t && state.sel) state.sel = null;
  const isOpen = !inspector.classList.contains('closed');
  if (quietFor && quietFor !== selKey()) quietFor = '';
  const open = panelMode === 'hidden' ? false : panelMode === 'pinned' ? true : !!t && (isOpen || (!held && !quietFor));
  inspector.classList.toggle('closed', !open);
  if (!t) { teardownEditors(); body.innerHTML = open ? '<div class="placeholder"><strong>Nothing selected</strong><span>Click a component, connection or environment to see and edit its details.</span></div>' : ''; return; }
  teardownEditors();
  body.innerHTML = state.sel!.type === 'node' ? nodeSheet(t as Node) : state.sel!.type === 'edge' ? edgeSheet(t as Edge) : containerSheet(t as Container);
  body.querySelectorAll<HTMLTextAreaElement>('textarea[data-validate]').forEach(validateJson);
  body.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab as typeof tab; drawSheet(); });
  if (focusAfterDraw) { body.querySelector<HTMLInputElement>(focusAfterDraw)?.focus(); focusAfterDraw = ''; }
  mountEditors();
}

// Snapshot once per focus session so typing a value is one undo step.
let editing: HTMLElement | null = null;
body.addEventListener('focusin', ev => { const f = ev.target as HTMLElement; if (((f as any).dataset?.path || (f as any).dataset?.fk) && f !== editing) { editing = f; history.snapshot(state.doc); } });
body.addEventListener('focusout', () => { editing = null; });

body.addEventListener('keydown', ev => {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.addcol !== undefined && ev.key === 'Enter') {
    ev.preventDefault();
    const i = +el.dataset.addcol, n = current() as DbNode; if (!n || !el.value.trim()) return;
    const err = body.querySelector<HTMLElement>(`[data-adderr="${i}"]`)!;
    const r = quickColumn(el.value, refResolver());
    if (!r.col) { err.textContent = r.error ?? 'Not a column'; err.hidden = false; el.classList.add('bad'); return; }
    if (n.tables[i].columns.some(c => c.name === r.col!.name)) { err.textContent = `There's already a column "${r.col.name}"`; err.hidden = false; el.classList.add('bad'); return; }
    history.snapshot(state.doc);
    n.tables[i].columns.push(r.col);
    focusAfterDraw = `[data-addcol="${i}"]`;
    drawSheet(); renderCanvas();
    return;
  }
  if (el.closest('.tedit') && (ev.key === 'Enter' && el.tagName !== 'SELECT' || ev.key === 'Escape')) { ev.preventDefault(); ev.stopPropagation(); openCol = ''; drawSheet(); }
});

body.addEventListener('input', ev => {
  { const a = ev.target as HTMLInputElement; if (a.dataset.addcol !== undefined) { a.classList.remove('bad'); const e = body.querySelector<HTMLElement>(`[data-adderr="${a.dataset.addcol}"]`); if (e) e.hidden = true; return; } }
  const f = ev.target as HTMLInputElement;
  if (f.dataset.fk) {
    const fe = f.closest<HTMLElement>('.fe')!, row = f.closest<HTMLElement>('[data-fpath]');
    const k = f.dataset.fk, v = f.type === 'checkbox' ? f.checked : f.value;
    const structural = editTree(fe, (root, rec) => {
      if (k === 'recname') { rec!.name = v as string; return false; }
      if (k === 'namespace') { rec!.namespace = v as string; return false; }
      const fld = fieldAt(root, row!.dataset.fpath!);
      if (k === 'type') {
        fld.type = v;
        if (fe.dataset.kind === 'json') { if (v === 'array' && !fld.items) fld.items = 'string'; if (v === 'object' || (v === 'array' && fld.items === 'object')) fld.children = fld.children || []; }
        else if (v === 'array' || v === 'map') { fld.items = fld.items || 'string'; } else if (v === 'record') fld.children = fld.children || [];
        return true;
      }
      if (k === 'items') { fld.items = v; if (v === 'object' || v === 'record') fld.children = fld.children || []; return true; }
      fld[k] = v; return false;
    });
    if (structural) drawSheet();
    renderCanvas(); // also persists
    return;
  }
  if (!f.dataset.path) return;
  const t = current(); if (!t) return;
  const v = f.type === 'checkbox' ? f.checked : f.type === 'number' ? (f.value === '' ? 0 : +f.value) : f.dataset.int ? (f.value === '' ? null : +f.value) : f.dataset.nullable ? (f.value === '' ? null : f.value) : f.value;
  if (f.dataset.path.startsWith('links.')) {
    setPath(state.doc, f.dataset.path, v);
    if (f.dataset.path.endsWith('.type') && typeof v === 'string' && v in LINK_TYPES) { const i = +f.dataset.path.split('.')[1]; state.doc.links[i].latencyMs = LINK_TYPES[v]; renderAll(); return; }
  } else setPath(t, f.dataset.path, v);
  if (f.dataset.path === 'container' || f.dataset.path === 'parent' || f.dataset.path === 'kind') { renderAll(); return; }
  if (f.tagName === 'TEXTAREA') validateJson(f as unknown as HTMLTextAreaElement);
  renderCanvas();
  if (f.dataset.path === 'name') { const s = body.querySelector('.head strong'); if (s) s.textContent = (t as Node).name; }
});

body.addEventListener('click', ev => {
  const feBtn = (ev.target as Element).closest<HTMLElement>('[data-femode],[data-feact],[data-feexpand],[data-feformat]');
  if (feBtn) {
    const fe = feBtn.closest<HTMLElement>('.fe')!;
    if (feBtn.dataset.femode) { feModes.set(feKey(fe.dataset.fe!), feBtn.dataset.femode as FeMode); drawSheet(); return; }
    if (feBtn.dataset.feexpand !== undefined) { openBigEditor(fe.dataset.fe!, fe.dataset.kind as 'json' | 'avro', fe.querySelector('.fe-head span')?.textContent ?? ''); return; }
    if (feBtn.dataset.feformat !== undefined) { const v = views.find(x => x.path === fe.dataset.fe); if (v) loadCode().then(m => { m.formatJson(v.view); v.view.focus(); }); return; }
    history.snapshot(state.doc);
    let newPath = '';
    editTree(fe, root => {
      if (feBtn.dataset.feact === 'add') {
        const lp = feBtn.dataset.flist!, list = listAt(root, lp);
        list.push(fe.dataset.kind === 'json' ? { name: '', type: 'string', example: '' } : { name: '', type: 'string', nullable: false });
        newPath = lp ? `${lp}.${list.length - 1}` : String(list.length - 1);
      } else { const fp = feBtn.closest<HTMLElement>('[data-fpath]')!.dataset.fpath!; const idx = fp.split('.'); const last = +idx.pop()!; listAt(root, idx.join('.')).splice(last, 1); }
      return true;
    });
    drawSheet(); renderCanvas();
    if (newPath) body.querySelector<HTMLInputElement>(`[data-fe="${fe.dataset.fe}"] [data-fpath="${newPath}"] input.fname`)?.focus();
    return;
  }
  const tb = (ev.target as Element).closest<HTMLElement>('[data-opencol],[data-closecol],[data-tblmode],[data-tblexpand]');
  if (tb) {
    if (tb.dataset.opencol) { openCol = tb.dataset.opencol; focusAfterDraw = '.tedit .cname'; drawSheet(); return; }
    if (tb.dataset.closecol !== undefined) { openCol = ''; drawSheet(); return; }
    if (tb.dataset.tblmode) { const id = (current() as Node).id; tblMode.set(id, tb.dataset.tblmode as 'rows' | 'code'); if (tb.dataset.tblmode === 'rows') dbDrafts.delete(id); openCol = ''; drawSheet(); return; }
    if (tb.dataset.tblexpand !== undefined) { openBigTables(); return; }
  }
  const cs = (ev.target as Element).closest<HTMLElement>('[data-cstyle]');
  if (cs) {
    const c = current() as Container; if (!c || state.sel?.type !== 'container') return;
    const [prop, val] = cs.dataset.cstyle!.split(':');
    history.snapshot(state.doc);
    const defaults: Record<string, string> = { color: '', fill: 'tint', border: 'dashed' };
    if (!val || val === defaults[prop]) delete (c as any)[prop]; else (c as any)[prop] = val;
    drawSheet(); renderCanvas(); return;
  }
  const flip = (ev.target as Element).closest<HTMLElement>('[data-flip]');
  if (flip) {
    const t = current(); if (!t) return;
    const path = flip.dataset.flip!;
    history.snapshot(state.doc);
    const v = !getPath(t, path);
    setPath(t, path, v);
    const col = path.replace(/\.[a-z]+$/, '');
    if (path.endsWith('.pk') && v) setPath(t, col + '.nullable', false);          // a primary key is never null
    if (path.endsWith('.nullable') && v && getPath(t, col + '.pk')) setPath(t, col + '.pk', false);
    drawSheet(); renderCanvas(); return;
  }
  const b = (ev.target as Element).closest('[data-action],[data-platform]') as HTMLElement | null;
  if (!b) return;
  const n = current() as any; if (!n) return;
  if (b.dataset.action === 'delete-node') { mutate(() => { state.doc.nodes = state.doc.nodes.filter(x => x.id !== n.id); state.doc.edges = state.doc.edges.filter(e => e.from !== n.id && e.to !== n.id); }); select(null); renderAll(); return; }
  if (b.dataset.action === 'delete-edge') { mutate(() => { state.doc.edges = state.doc.edges.filter(e => e.id !== n.id); }); select(null); renderAll(); return; }
  if (b.dataset.action === 'delete-container') {
    mutate(() => {
      const parent = n.parent ?? null;
      state.doc.nodes.forEach(x => { if ((x.container ?? null) === n.id) x.container = parent; });
      state.doc.containers.forEach(x => { if ((x.parent ?? null) === n.id) x.parent = parent; });
      state.doc.links = state.doc.links.filter(l => l.from !== n.id && l.to !== n.id);
      delete state.doc.frames[n.id];
      state.doc.containers = state.doc.containers.filter(x => x.id !== n.id);
    });
    select(null); renderAll(); return;
  }
  if (b.dataset.action === 'add-link') {
    const other = state.doc.containers.find(x => x.id !== n.id && !ancestry(state.doc, x.id).includes(n.id));
    if (!other) return;
    mutate(() => state.doc.links.push({ id: nextId('l'), from: n.id, to: other.id, type: 'privatelink', latencyMs: LINK_TYPES['privatelink'] }));
    renderAll(); return;
  }
  if (b.dataset.action?.startsWith('rm-link:')) { const i = +b.dataset.action.split(':')[1]; mutate(() => state.doc.links.splice(i, 1)); renderAll(); return; }
  history.snapshot(state.doc);
  if (b.dataset.platform) {
    const p = b.dataset.platform;
    n.platforms = n.platforms || [];
    n.platforms = n.platforms.includes(p) ? n.platforms.filter((x: string) => x !== p) : [...n.platforms, p];
    renderAll(); return;
  }
  const [act, a, c] = b.dataset.action!.split(':'); const i = +a, j = +c;
  switch (act) {
    case 'add-endpoint': (n.endpoints = n.endpoints || []).push({ method: 'GET', path: '/v1/', headers: [], req: '', res: '' }); break;
    case 'rm-endpoint':
      n.endpoints.splice(i, 1);
      state.doc.edges.forEach(e => { if (e.to === n.id && e.endpoint != null) { if (e.endpoint === i) e.endpoint = null; else if (e.endpoint > i) e.endpoint--; } });
      break;
    case 'add-header': (n.endpoints[i].headers = n.endpoints[i].headers || []).push({ k: '', v: '' }); break;
    case 'rm-header': n.endpoints[i].headers.splice(j, 1); break;
    case 'add-table': (n.tables = n.tables || []).push({ name: 'new_table', columns: [{ name: 'id', type: 'uuid', pk: true, nullable: false }] }); focusAfterDraw = `[data-t="${n.tables.length - 1}"] .tname`; break;
    case 'rm-table': n.tables.splice(i, 1); openCol = ''; break;
    case 'rm-column': n.tables[i].columns.splice(j, 1); openCol = ''; break;
    default: return;
  }
  renderAll();
});

on('sheet', drawSheet);
