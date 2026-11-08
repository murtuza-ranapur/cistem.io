/**
 * Reading and writing the selected item's fields by path ("endpoints.0.req", "tables.1.columns.2.name"),
 * plus what the editors suggest: foreign-key targets and field names worth offering in a body.
 */
import { detailOf, hasSchemaDetail, type Doc, type Node } from '../../../domain/model';
import { parseAvro } from '../../../domain/fields';
import type { RefResolver } from '../../../domain/dbml';
import { editor } from '../../../store/editor';
import { edit } from '../state';

/** What the panel is showing: the selected node, edge or environment (null: nothing). */
export function currentItem(doc: Doc): { type: 'node'; item: Node } | { type: 'edge'; item: Doc['edges'][number] } | { type: 'container'; item: Doc['containers'][number] } | null {
  const s = editor().selection; if (!s) return null;
  const id = s.ids[0];
  if (s.type === 'node') { const item = doc.nodes.find(n => n.id === id); return item ? { type: 'node', item } : null; }
  if (s.type === 'edge') { const item = doc.edges.find(e => e.id === id); return item ? { type: 'edge', item } : null; }
  if (s.type === 'container') { const item = doc.containers.find(c => c.id === id); return item ? { type: 'container', item } : null; }
  return null;
}

/** Change the selected item (and anything else in the document). */
export function editItem(fn: (item: any, doc: Doc) => void) {
  edit(d => { const c = currentItem(d); if (c) fn(c.item, d); });
}

export function getPath(obj: unknown, path: string): any { return path.split('.').reduce((o: any, k) => o?.[k], obj); }
export function setPath(obj: unknown, path: string, val: unknown) {
  const parts = path.split('.');
  let o = obj as any;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = val;
}

/**
 * Foreign keys point at "table.column" (or "node:table.column" from another database). Renaming a table or
 * column moves every reference to it — in this database and in any other that points here.
 */
export function renamedRefTarget(n: Node, path: string): { table: string; col?: string } | null {
  let m = /^tables\.(\d+)\.name$/.exec(path);
  if (m) { const t = n.tables?.[+m[1]]; return t ? { table: t.name } : null; }
  m = /^tables\.(\d+)\.columns\.(\d+)\.name$/.exec(path);
  if (m) { const t = n.tables?.[+m[1]], c = t?.columns[+m[2]]; return t && c ? { table: t.name, col: c.name } : null; }
  return null;
}
export function retargetRefs(doc: Doc, n: Node, from: { table: string; col?: string }, to: { table: string; col?: string }) {
  if (from.table === to.table && from.col === to.col) return;
  const move = (ref: string) => {
    const [t, c] = ref.split('.');
    if (t !== from.table || (from.col !== undefined && c !== from.col)) return ref;
    return `${to.table}.${from.col !== undefined ? to.col : c}`;
  };
  for (const d of doc.nodes) for (const tb of d.tables ?? []) for (const c of tb.columns) {
    if (!c.references) continue;
    const m = /^([^:]+):(.+)$/.exec(c.references);
    if (m) { if (m[1] === n.id) c.references = `${m[1]}:${move(m[2])}`; }
    else if (d.id === n.id) c.references = move(c.references);
  }
}

/** Database names ↔ node ids, for references to tables in another database. */
export const refResolver = (doc: Doc): RefResolver => ({
  nameToId: name => doc.nodes.find(x => detailOf(x) === 'tables' && x.name === name)?.id ?? null,
  idToName: id => doc.nodes.find(x => x.id === id)?.name ?? null,
});
/** "payments.id", or "other-db.payments.id" for another database. */
export const refLabel = (doc: Doc, r: string) => { const m = /^([^:]+):(.+)$/.exec(r); return m ? `${doc.nodes.find(x => x.id === m[1])?.name ?? m[1]}.${m[2]}` : r; };

/** Field names worth suggesting in a body: connected tables and topics first, then other bodies in the diagram. */
export function bodyVocab(doc: Doc, nodeId: string) {
  const keys: { name: string; from: string; example?: unknown }[] = [];
  const linked = new Set(doc.edges.filter(e => e.from === nodeId).map(e => e.to).concat(doc.edges.filter(e => e.to === nodeId).map(e => e.from)));
  for (const n of doc.nodes) {
    if (!linked.has(n.id)) continue;
    if (detailOf(n) === 'tables') for (const t of n.tables || []) for (const c of t.columns || []) if (c.name) keys.push({ name: c.name, from: `${n.name}.${t.name}` });
    if (hasSchemaDetail(n)) for (const f of parseAvro(n.schema ?? '')?.fields ?? []) if (f.name) keys.push({ name: f.name, from: n.name });
  }
  const walk = (v: unknown, from: string) => {
    if (Array.isArray(v)) { v.forEach(x => walk(x, from)); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) { keys.push({ name: k, from, example: x !== null && typeof x === 'object' ? undefined : x }); walk(x, from); }
  };
  const services = [...doc.nodes.filter(n => n.id === nodeId), ...doc.nodes.filter(n => n.id !== nodeId)];
  for (const n of services) if (detailOf(n) === 'endpoints') for (const ep of n.endpoints || []) for (const body of [ep.req, ep.res]) {
    try { walk(JSON.parse(body), `${ep.method} ${ep.path}`); } catch { /* not JSON yet */ }
  }
  return { keys };
}
