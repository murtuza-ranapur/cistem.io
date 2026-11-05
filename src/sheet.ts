import { KINDS, METHODS, PG_TYPES, EVICTIONS, type Node, type Edge, type ServiceNode, type DbNode, type QueueNode, type EntryNode } from './model';
import { state, fmt, esc, current, on, renderCanvas, renderAll } from './state';

const sheet = document.getElementById('sheet') as HTMLElement;
const body = document.getElementById('sheetBody') as HTMLElement;

const icon = (kind: string) => `<svg style="stroke:var(--c-${kind});fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round"><use href="#ic-${kind}"/></svg>`;
const inp = (path: string, label: string, val: unknown, type = 'text', extra = '') =>
  `<label>${label}<input data-path="${path}" type="${type}" ${type === 'number' ? 'step="any"' : ''} value="${esc(val)}" ${extra}></label>`;
const selIn = (path: string, label: string, val: string, opts: string[], cls = '') =>
  `<label>${label}<select data-path="${path}" class="${cls}">${opts.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
const chk = (path: string, label: string, val: boolean) => `<label class="check"><input data-path="${path}" type="checkbox" ${val ? 'checked' : ''}>${label}</label>`;
const ta = (path: string, label: string, val: string, validate = '') =>
  `<label>${label}<textarea data-path="${path}" data-validate="${validate}" spellcheck="false">${esc(val)}</textarea></label>`;
const addBtn = (action: string, label: string) => `<button class="small" data-action="${action}">+ ${label}</button>`;
const xBtn = (action: string) => `<button class="x" data-action="${action}" aria-label="Remove">×</button>`;

function nodeSheet(n: Node): string {
  const r = state.results.nodes[n.id];
  const tall = sheet.classList.contains('tall');
  let h = `<div class="head"><span class="k" style="color:var(--c-${n.kind})">${icon(n.kind)}${KINDS[n.kind].label}</span><strong>${esc(n.name)}</strong><span class="spacer"></span><button class="small ghost" id="tallBtn">${tall ? 'Shrink' : 'Expand'}</button></div>`;
  h += '<div class="props">' + inp('name', 'name', n.name);
  KINDS[n.kind].fields.forEach(([key, lbl]) => { h += inp(key, lbl, (n as any)[key], 'number'); });
  if (n.kind === 'cache') h += selIn('eviction', 'eviction policy', n.eviction, EVICTIONS);
  h += '</div>';

  if (n.kind === 'entry') {
    const ps = (n as EntryNode).platforms || [];
    h += `<div class="props" style="margin-top:8px"><label>platforms<div class="chips">${['web', 'app'].map(p => `<button data-platform="${p}" class="${ps.includes(p) ? 'on' : ''}">${p === 'web' ? 'Web' : 'App'}</button>`).join('')}</div></label></div>`;
    h += `<div class="result">Entry point. Target load is set in the top bar.</div>`;
  } else {
    h += `<div class="result"><span>load <b>${fmt(r.load)} rps</b></span><span>capacity <b>${fmt(r.cap)} rps</b></span><span>utilisation <b>${isFinite(r.util) ? Math.round(r.util * 100) + '%' : '∞'}</b></span><span>headroom <b>${isFinite(r.cap) ? fmt(Math.max(0, r.cap - r.load)) : '∞'} rps</b></span><span>eff. latency <b>${r.lat.toFixed(1)} ms</b></span></div>`;
  }

  if (n.kind === 'service') {
    const eps = (n as ServiceNode).endpoints || [];
    h += `<section class="list"><h3>Endpoints <span class="spacer"></span>${addBtn('add-endpoint', 'endpoint')}</h3>`;
    eps.forEach((ep, i) => {
      h += `<div class="item"><div class="row ep">${selIn(`endpoints.${i}.method`, 'method', ep.method, METHODS, 'method')}${inp(`endpoints.${i}.path`, 'path', ep.path, 'text', 'placeholder="/v1/resource/{id}"')}${xBtn(`rm-endpoint:${i}`)}</div>`;
      h += `<div class="sub">Headers <span class="spacer"></span>${addBtn(`add-header:${i}`, 'header')}</div>`;
      (ep.headers || []).forEach((hd, j) => { h += `<div class="row hdr">${inp(`endpoints.${i}.headers.${j}.k`, 'name', hd.k)}${inp(`endpoints.${i}.headers.${j}.v`, 'value', hd.v)}${xBtn(`rm-header:${i}:${j}`)}</div>`; });
      h += `<div class="row">${ta(`endpoints.${i}.req`, 'request body (JSON)', ep.req, 'json')}${ta(`endpoints.${i}.res`, 'response body (JSON)', ep.res, 'json')}</div></div>`;
    });
    if (!eps.length) h += '<p class="empty">No endpoints yet.</p>';
    h += '</section>';
  }
  if (n.kind === 'db') {
    const ts = (n as DbNode).tables || [];
    h += `<section class="list"><h3>Tables <span class="spacer"></span>${addBtn('add-table', 'table')}</h3>`;
    ts.forEach((t, i) => {
      h += `<div class="item"><div class="row" style="grid-template-columns:1fr auto">${inp(`tables.${i}.name`, 'table', t.name)}${xBtn(`rm-table:${i}`)}</div>`;
      h += `<div class="sub">Columns <span class="spacer"></span>${addBtn(`add-column:${i}`, 'column')}</div>`;
      (t.columns || []).forEach((c, j) => {
        const types = PG_TYPES.includes(c.type) ? PG_TYPES : [c.type, ...PG_TYPES];
        h += `<div class="row cols">${inp(`tables.${i}.columns.${j}.name`, 'column', c.name)}${selIn(`tables.${i}.columns.${j}.type`, 'type', c.type, types)}${chk(`tables.${i}.columns.${j}.pk`, 'PK', c.pk)}${chk(`tables.${i}.columns.${j}.nullable`, 'null', c.nullable)}${xBtn(`rm-column:${i}:${j}`)}</div>`;
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
      h += `<div class="item"><div class="row topic">${inp(`topics.${i}.name`, 'topic', t.name, 'text', 'placeholder="domain.event"')}${inp(`topics.${i}.partitions`, 'partitions', t.partitions, 'number')}${xBtn(`rm-topic:${i}`)}</div>`;
      h += `<div class="row">${ta(`topics.${i}.schema`, 'Avro schema (JSON)', t.schema, 'avro')}</div></div>`;
    });
    if (!ts.length) h += '<p class="empty">No topics yet.</p>';
    h += '</section>';
  }
  return h;
}

function edgeSheet(e: Edge): string {
  const a = state.doc.nodes.find(n => n.id === e.from)!, b = state.doc.nodes.find(n => n.id === e.to)!;
  let h = `<div class="head"><span class="k">Edge</span><strong>${esc(a.name)} → ${esc(b.name)}</strong></div><div class="props">${inp('calls', 'calls per incoming request', e.calls, 'number', 'min="0"')}`;
  if (b.kind === 'service' && (b.endpoints || []).length) {
    h += `<label>endpoint called<select data-path="endpoint" data-int="1"><option value="">(unspecified)</option>${b.endpoints.map((ep, i) => `<option value="${i}" ${e.endpoint === i ? 'selected' : ''}>${esc(ep.method + ' ' + ep.path)}</option>`).join('')}</select></label>`;
  }
  h += `</div><div class="result"><span>carries <b>${fmt(state.results.edges[e.id] || 0)} rps</b></span>${a.kind === 'cache' ? '<span>after cache hits are removed</span>' : ''}${a.kind === 'lb' ? '<span>load balancer splits evenly across its outgoing edges</span>' : ''}</div>`;
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
  if (!t) {
    state.sel = null;
    body.innerHTML = '<p class="empty">Tap a node or edge to edit it. Drag nodes to move, drag empty space to pan, pinch or scroll to zoom.</p>';
    return;
  }
  body.innerHTML = state.sel!.type === 'node' ? nodeSheet(t as Node) : edgeSheet(t as Edge);
  body.querySelectorAll<HTMLTextAreaElement>('textarea[data-validate]').forEach(validateJson);
  const tb = document.getElementById('tallBtn');
  if (tb) tb.onclick = () => { sheet.classList.toggle('tall'); tb.textContent = sheet.classList.contains('tall') ? 'Shrink' : 'Expand'; };
}

body.addEventListener('input', ev => {
  const f = ev.target as HTMLInputElement;
  if (!f.dataset.path) return;
  const t = current(); if (!t) return;
  const v = f.type === 'checkbox' ? f.checked : f.type === 'number' ? (f.value === '' ? 0 : +f.value) : f.dataset.int ? (f.value === '' ? null : +f.value) : f.value;
  setPath(t, f.dataset.path, v);
  if (f.tagName === 'TEXTAREA') validateJson(f as unknown as HTMLTextAreaElement);
  renderCanvas();
  if (f.dataset.path === 'name') { const s = body.querySelector('.head strong'); if (s) s.textContent = (t as Node).name; }
});

body.addEventListener('click', ev => {
  const b = (ev.target as Element).closest('[data-action],[data-platform]') as HTMLElement | null;
  if (!b) return;
  const n = current() as any; if (!n) return;
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
