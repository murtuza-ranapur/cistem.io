import { KINDS, METHODS, PG_TYPES, EVICTIONS, CONTAINER_KINDS, LINK_TYPES, CROSSING_DEFAULT_MS, ancestry, nextId, type Node, type Edge, type ServiceNode, type DbNode, type QueueNode, type EntryNode, type Container, type ContainerKind } from './model';
import { state, fmt, esc, current, on, renderCanvas, renderAll, mutate, select } from './state';
import * as history from './history';
import { parseJsonFields, jsonFieldsToText, parseAvro, avroToText, listAt, J_TYPES, A_TYPES, COMMON_HEADERS, HEADER_VALUES, type JField, type AField, type JType, type ARecord } from './fields';

const inspector = document.getElementById('inspector') as HTMLElement;
let tab: 'capacity' | 'schema' = 'capacity';
const body = document.getElementById('sheetBody') as HTMLElement;

const icon = (kind: string) => `<svg style="stroke:var(--c-${kind});fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round"><use href="#ic-${kind}"/></svg>`;
const inp = (path: string, label: string, val: unknown, type = 'text', extra = '') =>
  `<label>${label}<input data-path="${path}" type="${type}" ${type === 'number' ? 'step="any"' : ''} value="${esc(val)}" ${extra}></label>`;
const selIn = (path: string, label: string, val: string, opts: string[], cls = '') =>
  `<label>${label}<select data-path="${path}" class="${cls}">${opts.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
const chk = (path: string, label: string, val: boolean) => `<label class="check"><input data-path="${path}" type="checkbox" ${val ? 'checked' : ''}>${label}</label>`;
const addBtn = (action: string, label: string) => `<button class="small" data-action="${action}">+ ${label}</button>`;
const xBtn = (action: string) => `<button class="x" data-action="${action}" aria-label="Remove">×</button>`;

// ---------- structured body / schema editors ----------
// Bodies and Avro schemas are stored as JSON text; the editor shows them as a tree of fields
// (name · type · example / nullable) and writes the text back on every change. A JSON tab keeps
// the raw text reachable for pasting; anything the tree can't express stays in that tab.
type FeMode = 'fields' | 'json';
const feModes = new Map<string, FeMode>();
const feKey = (path: string) => (state.sel?.id ?? '') + ':' + path;
const optList = (opts: string[], val: string) => opts.map(o => `<option value="${esc(o)}" ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('');
function fieldEditor(path: string, label: string, text: string, kind: 'json' | 'avro'): string {
  const parsed = kind === 'json' ? parseJsonFields(text) : parseAvro(text);
  const canTree = parsed !== null;
  const mode: FeMode = canTree ? (feModes.get(feKey(path)) ?? 'fields') : 'json';
  let h = `<div class="fe" data-fe="${path}" data-kind="${kind}"><div class="fe-head"><span>${label}</span><span class="spacer"></span>`;
  h += `<button data-femode="fields" class="${mode === 'fields' ? 'on' : ''}" ${canTree ? '' : `disabled title="${kind === 'json' ? 'Not a JSON object — edit as text' : 'Not a simple Avro record — edit as text'}"`}>Fields</button><button data-femode="json" class="${mode === 'json' ? 'on' : ''}">JSON</button></div>`;
  if (mode === 'json') {
    h += `<textarea data-path="${path}" data-validate="${kind}" spellcheck="false" placeholder="${kind === 'json' ? 'Paste or type JSON — switch to Fields to edit it as a tree' : 'Paste an Avro record schema'}">${esc(text)}</textarea>`;
    if (!canTree && text.trim()) h += `<p class="fe-note">${kind === 'json' ? 'Fields view needs a JSON object at the top level.' : 'Fields view handles records with primitive, logical, enum, array, map and nested record types (nullable as ["null", T]).'}</p>`;
  } else if (kind === 'json') {
    h += jsonRows(parsed as JField[], '', 0) + feAdd('', 0);
  } else {
    const r = parsed as ARecord;
    h += `<div class="row rec"><label>record<input data-fk="recname" value="${esc(r.name)}" placeholder="PaymentAuthorised"></label><label>namespace<input data-fk="namespace" value="${esc(r.namespace)}" placeholder="com.example"></label></div>`;
    h += avroRows(r.fields, '', 0) + feAdd('', 0);
  }
  return h + '</div>';
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

function hasSchema(n: Node) { return n.kind === 'service' || n.kind === 'db' || n.kind === 'queue'; }
const schemaLabel = (n: Node) => n.kind === 'service' ? 'Endpoints' : n.kind === 'db' ? 'Tables' : 'Topics';

function capacityTab(n: Node): string {
  const r = state.results.nodes[n.id];
  let h = '<div class="tab"><div class="props">' + inp('name', 'name', n.name).replace('<label>', '<label class="wide">');
  h += `<label class="wide">in<select data-path="container" data-nullable="1"><option value="" ${!n.container ? 'selected' : ''}>(no environment)</option>${containerOptions(n.container ?? null)}</select></label>`;
  KINDS[n.kind].fields.forEach(([key, lbl]) => { h += inp(key, lbl, (n as any)[key], 'number'); });
  if (n.kind === 'cache') h += selIn('eviction', 'eviction policy', n.eviction, EVICTIONS).replace('<label>', '<label class="wide">');
  if (n.kind === 'entry') {
    const ps = (n as EntryNode).platforms || [];
    h += `<label class="wide">platforms<div class="chips">${['web', 'app'].map(p => `<button data-platform="${p}" class="${ps.includes(p) ? 'on' : ''}">${p === 'web' ? 'Web' : 'App'}</button>`).join('')}</div></label>`;
  }
  h += '</div>';
  if (n.kind === 'entry') h += `<p class="note">Entry point. Every request starts here; set the target in the top bar.</p>`;
  else {
    const pct = isFinite(r.util) ? Math.round(r.util * 100) : 100;
    h += `<div class="stats">
      <div class="stat-tile"><div class="l">load</div><div class="v">${fmt(r.load)} <small>rps</small></div></div>
      <div class="stat-tile"><div class="l">capacity</div><div class="v">${fmt(r.cap)} <small>rps</small></div></div>
      <div class="stat-tile ${r.status}"><div class="l">utilisation</div><div class="v">${isFinite(r.util) ? pct + '%' : '∞'}</div></div>
      <div class="stat-tile"><div class="l">eff. latency</div><div class="v">${r.lat.toFixed(1)} <small>ms</small></div></div>
      <div class="meter ${r.status}"><i style="width:${Math.min(100, pct)}%"></i></div>
    </div>`;
    h += `<p class="note">Headroom ${isFinite(r.cap) ? fmt(Math.max(0, r.cap - r.load)) + ' rps' : 'unlimited'}. Latency inflates as utilisation climbs (M/M/1 approximation).</p>`;
  }
  return h + '</div>';
}

function schemaTab(n: Node): string {
  let h = '<div class="tab">';
  if (n.kind === 'service') {
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
  if (n.kind === 'db') {
    const ts = (n as DbNode).tables || [];
    h += `<section class="list"><h3>Tables <span class="spacer"></span>${addBtn('add-table', 'table')}</h3>`;
    ts.forEach((t, i) => {
      h += `<div class="item"><div class="row one">${inp(`tables.${i}.name`, 'table', t.name)}${xBtn(`rm-table:${i}`)}</div>`;
      h += `<div class="sub">Columns <span class="spacer"></span>${addBtn(`add-column:${i}`, 'column')}</div>`;
      (t.columns || []).forEach((c, j) => {
        const types = PG_TYPES.includes(c.type) ? PG_TYPES : [c.type, ...PG_TYPES];
        // FK targets: every other table.column in this db (ids first), plus other dbs' tables
        const targets: string[] = [];
        for (const ot of (n as DbNode).tables || []) if (ot !== t) for (const oc of ot.columns || []) targets.push(`${ot.name}.${oc.name}`);
        for (const on of state.doc.nodes) if (on.kind === 'db' && on.id !== n.id) for (const ot of on.tables || []) for (const oc of ot.columns || []) if (oc.pk) targets.push(`${on.id}:${ot.name}.${oc.name}`);
        const refOpts = ['', ...(c.references && !targets.includes(c.references) ? [c.references] : []), ...targets];
        h += `<div class="row cols">${inp(`tables.${i}.columns.${j}.name`, 'column', c.name)}${selIn(`tables.${i}.columns.${j}.type`, 'type', c.type, types)}${chk(`tables.${i}.columns.${j}.pk`, 'PK', c.pk)}${chk(`tables.${i}.columns.${j}.nullable`, 'null', c.nullable)}${xBtn(`rm-column:${i}:${j}`)}</div>`;
        h += `<div class="row colx"><label>references<select data-path="tables.${i}.columns.${j}.references" data-nullable="1">${refOpts.map(o => `<option value="${esc(o)}" ${o === (c.references ?? '') ? 'selected' : ''}>${o ? esc(o.includes(':') ? (state.doc.nodes.find(x => x.id === o.split(':')[0])?.name ?? '') + ' › ' + o.split(':')[1] : o) : '—'}</option>`).join('')}</select></label>${chk(`tables.${i}.columns.${j}.unique`, 'unique', !!c.unique)}${chk(`tables.${i}.columns.${j}.index`, 'index', !!c.index)}${inp(`tables.${i}.columns.${j}.default`, 'default', c.default ?? '')}</div>`;
      });
      h += '</div>';
    });
    if (!ts.length) h += '<p class="empty">No tables yet.</p>';
    h += '</section>';
  }
  if (n.kind === 'queue') {
    const ts = (n as QueueNode).topics || [];
    h += `<section class="list"><h3>Topics <span class="spacer"></span>${addBtn('add-topic', 'topic')}</h3>`;
    ts.forEach((t, i) => {
      const keyOpts = (parseAvro(t.schema)?.fields ?? []).map(f => f.name).filter(Boolean);
      h += `<div class="item"><div class="row topic">${inp(`topics.${i}.name`, 'topic', t.name, 'text', 'placeholder="domain.event"')}${inp(`topics.${i}.partitions`, 'partitions', t.partitions, 'number', 'min="1"')}${xBtn(`rm-topic:${i}`)}</div>`;
      h += `<div class="row one">${inp(`topics.${i}.key`, 'partition key', t.key ?? '', 'text', `list="tk-${i}" placeholder="field that keys the message, e.g. paymentId"`)}<span></span><datalist id="tk-${i}">${keyOpts.map(v => `<option value="${esc(v)}">`).join('')}</datalist></div>`;
      h += `<div class="row stack">${fieldEditor(`topics.${i}.schema`, 'Avro schema', t.schema, 'avro')}</div></div>`;
    });
    if (!ts.length) h += '<p class="empty">No topics yet.</p>';
    h += '</section>';
  }
  return h + '</div>';
}

/** Options for a container picker, indented by depth; `exclude` hides a container and its descendants. */
function containerOptions(selected: string | null, exclude: string | null = null): string {
  const { doc } = state;
  const line = (c: Container) => {
    const d = ancestry(doc, c.id).length - 1;
    return `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${'\u00a0\u00a0'.repeat(d)}${esc(c.name)} · ${CONTAINER_KINDS[c.kind].label.toLowerCase()}</option>`;
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
  h += `<label>inside<select data-path="parent" data-nullable="1"><option value="" ${!c.parent ? 'selected' : ''}>(top level)</option>${containerOptions(c.parent ?? null, c.id)}</select></label>`;
  h += inp('provider', 'provider', c.provider ?? '', 'text', 'placeholder="aws · ibm · gcp · on-prem"');
  h += inp('owner', 'owner', c.owner ?? '', 'text', 'placeholder="team or company"');
  h += `${inp('note', 'note', c.note ?? '').replace('<label>', '<label class="wide">')}</div>`;
  h += `<div class="stats"><div class="stat-tile"><div class="l">components</div><div class="v">${members.length}</div></div><div class="stat-tile"><div class="l">nested</div><div class="v">${children.length}</div></div></div>`;
  if (c.parent) h += `<p class="note">${esc(pathOf(c.id))}</p>`;
  h += `<section class="list" style="margin-top:14px"><h3>Links to other environments <span class="spacer"></span>${addBtn('add-link', 'link')}</h3>`;
  links.forEach(l => {
    const other = l.from === c.id ? l.to : l.from;
    const i = doc.links.indexOf(l);
    h += `<div class="item"><div class="row topic"><label>to<select data-path="links.${i}.${l.from === c.id ? 'to' : 'from'}">${containerOptions(other, c.id)}</select></label>${selIn(`links.${i}.type`, 'type', l.type, Object.keys(LINK_TYPES).includes(l.type) ? Object.keys(LINK_TYPES) : [l.type, ...Object.keys(LINK_TYPES)])}${xBtn(`rm-link:${i}`)}</div><div class="row one">${inp(`links.${i}.latencyMs`, 'added latency ms', l.latencyMs, 'number', 'min="0"')}<span></span></div></div>`;
  });
  if (!links.length) h += `<p class="empty">No links. Calls out of here cost ${CROSSING_DEFAULT_MS.siblings} ms to a sibling and ${CROSSING_DEFAULT_MS.differentRoots} ms to another cloud unless a link says otherwise.</p>`;
  h += '</section></div>';
  return h;
}

function nodeSheet(n: Node): string {
  let h = `<div class="head"><span class="k" style="color:var(--c-${n.kind})">${icon(n.kind)}${KINDS[n.kind].label}</span><strong>${esc(n.name)}</strong><span class="spacer"></span>${n.kind !== 'entry' ? `<button class="icon danger" data-action="delete-node" title="Delete (⌫)" aria-label="Delete"><svg><use href="#ic-trash"/></svg></button>` : ''}</div>`;
  if (hasSchema(n)) {
    h += `<div class="tabs"><button data-tab="capacity" class="${tab === 'capacity' ? 'on' : ''}">Capacity</button><button data-tab="schema" class="${tab === 'schema' ? 'on' : ''}">${schemaLabel(n)}</button></div>`;
    h += tab === 'schema' ? schemaTab(n) : capacityTab(n);
  } else h += capacityTab(n);
  return h;
}

function edgeSheet(e: Edge): string {
  const a = state.doc.nodes.find(n => n.id === e.from)!, b = state.doc.nodes.find(n => n.id === e.to)!;
  let h = `<div class="head"><span class="k">Edge</span><strong>${esc(a.name)} → ${esc(b.name)}</strong><span class="spacer"></span><button class="icon danger" data-action="delete-edge" title="Delete" aria-label="Delete"><svg><use href="#ic-trash"/></svg></button></div><div class="tab"><div class="props">${inp('calls', 'calls per incoming request', e.calls, 'number', 'min="0"').replace('<label>', '<label class="wide">')}`;
  if (b.kind === 'service' && (b.endpoints || []).length) {
    h += `<label class="wide">endpoint called<select data-path="endpoint" data-int="1"><option value="">(unspecified)</option>${b.endpoints.map((ep, i) => `<option value="${i}" ${e.endpoint === i ? 'selected' : ''}>${esc(ep.method + ' ' + ep.path)}</option>`).join('')}</select></label>`;
  }
  h += `</div><div class="stats"><div class="stat-tile"><div class="l">carries</div><div class="v">${fmt(state.results.edges[e.id] || 0)} <small>rps</small></div></div></div>${a.kind === 'cache' ? '<p class="note">Only cache misses travel down this edge.</p>' : ''}${a.kind === 'lb' ? '<p class="note">The load balancer splits its traffic evenly across outgoing edges.</p>' : ''}</div>`;
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

export function drawSheet() {
  const t = current();
  if (!t) { state.sel = null; inspector.classList.add('closed'); return; }
  inspector.classList.remove('closed');
  body.innerHTML = state.sel!.type === 'node' ? nodeSheet(t as Node) : state.sel!.type === 'edge' ? edgeSheet(t as Edge) : containerSheet(t as Container);
  body.querySelectorAll<HTMLTextAreaElement>('textarea[data-validate]').forEach(validateJson);
  body.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab as typeof tab; drawSheet(); });
}

// Snapshot once per focus session so typing a value is one undo step.
let editing: HTMLElement | null = null;
body.addEventListener('focusin', ev => { const f = ev.target as HTMLElement; if (((f as any).dataset?.path || (f as any).dataset?.fk) && f !== editing) { editing = f; history.snapshot(state.doc); } });
body.addEventListener('focusout', () => { editing = null; });

body.addEventListener('input', ev => {
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
  const feBtn = (ev.target as Element).closest<HTMLElement>('[data-femode],[data-feact]');
  if (feBtn) {
    const fe = feBtn.closest<HTMLElement>('.fe')!;
    if (feBtn.dataset.femode) { feModes.set(feKey(fe.dataset.fe!), feBtn.dataset.femode as FeMode); drawSheet(); return; }
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
    case 'add-table': (n.tables = n.tables || []).push({ name: 'new_table', columns: [{ name: 'id', type: 'uuid', pk: true, nullable: false }] }); break;
    case 'rm-table': n.tables.splice(i, 1); break;
    case 'add-column': (n.tables[i].columns = n.tables[i].columns || []).push({ name: '', type: 'text', pk: false, nullable: true }); break;
    case 'rm-column': n.tables[i].columns.splice(j, 1); break;
    case 'add-topic': (n.topics = n.topics || []).push({ name: '', partitions: 6, schema: '{\n  "type": "record",\n  "name": "",\n  "fields": []\n}' }); break;
    case 'rm-topic': n.topics.splice(i, 1); break;
    default: return;
  }
  renderAll();
});

on('sheet', drawSheet);
