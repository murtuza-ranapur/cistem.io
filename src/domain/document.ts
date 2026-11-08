/**
 * On-disk document format.
 *
 * The editor works on a flat `Doc` (nodes carry x/y). Files separate the
 * model (what the system is) from the layout (where things are drawn), and
 * carry a `kind` so other diagram kinds can share the same envelope later.
 *
 *   { version, kind, meta, model, layout }
 *
 * JSON Schema: schema/cistem.schema.json
 */
import { adopt, type Doc, type NodeData, type Node, type Edge, type Container, type Link, type Frame } from './model';
import { sanitizeSeq, type SeqDoc } from './seq';
import { sanitizeCls, type ClassDoc } from './cls';

export const FORMAT_VERSION = 4;
export type DiagramKind = 'system' | 'sequence' | 'class';
export const KINDS_OF_DIAGRAM: DiagramKind[] = ['system', 'sequence', 'class'];

export interface DiagramFile {
  version: number;
  kind: DiagramKind;
  meta: { title: string; created: string; updated: string; tags?: string[] };
  model: {
    nodes: NodeData[];
    edges: Edge[];
    containers: Container[];
    links: Link[];
  };
  layout: {
    positions: Record<string, { x: number; y: number }>;
    frames: Record<string, Frame>;
    detail?: Record<string, 'compact' | 'expanded'>;
  };
}

export function toFile(doc: Doc, meta?: Partial<DiagramFile['meta']>): DiagramFile {
  const now = new Date().toISOString();
  const positions: DiagramFile['layout']['positions'] = {};
  const nodes = doc.nodes.map(n => { const { x, y, ...rest } = n; positions[n.id] = { x, y }; return rest; });
  return {
    version: FORMAT_VERSION,
    kind: 'system',
    meta: { title: meta?.title ?? 'Untitled system', created: meta?.created ?? now, updated: now, ...(meta?.tags ? { tags: meta.tags } : {}) },
    model: { nodes, edges: doc.edges, containers: doc.containers ?? [], links: doc.links ?? [] },
    layout: { positions, frames: doc.frames ?? {}, ...(Object.keys(doc.detail ?? {}).length ? { detail: doc.detail } : {}) },
  };
}

/** A sequence diagram file: the model is the sequence itself; there's no stored layout. */
export interface SequenceFile {
  version: number;
  kind: 'sequence';
  meta: DiagramFile['meta'];
  model: SeqDoc;
  layout: Record<string, never>;
}
export function seqToFile(seq: SeqDoc, meta?: Partial<DiagramFile['meta']>): SequenceFile {
  const now = new Date().toISOString();
  return {
    version: FORMAT_VERSION, kind: 'sequence',
    meta: { title: meta?.title ?? 'Untitled sequence', created: meta?.created ?? now, updated: now, ...(meta?.tags ? { tags: meta.tags } : {}) },
    model: { participants: seq.participants, rows: seq.rows, ...(seq.uses ? { uses: seq.uses } : {}) },
    layout: {},
  };
}
/** A class diagram file: classes and relations; where each box sits is layout. */
export interface ClassFile {
  version: number;
  kind: 'class';
  meta: DiagramFile['meta'];
  model: { classes: ClassDoc['classes']; relations: ClassDoc['relations'] };
  layout: { positions: ClassDoc['pos'] };
}
export function clsToFile(c: ClassDoc, meta?: Partial<DiagramFile['meta']>): ClassFile {
  const now = new Date().toISOString();
  const positions: ClassDoc['pos'] = {};
  for (const k of c.classes) if (c.pos[k.name]) positions[k.name] = c.pos[k.name];
  return {
    version: FORMAT_VERSION, kind: 'class',
    meta: { title: meta?.title ?? 'Untitled classes', created: meta?.created ?? now, updated: now, ...(meta?.tags ? { tags: meta.tags } : {}) },
    model: { classes: c.classes, relations: c.relations },
    layout: { positions },
  };
}
export type Loaded =
  | { kind: 'class'; cls: ClassDoc; meta: DiagramFile['meta'] }
  | { kind: 'system'; doc: Doc; meta: DiagramFile['meta'] }
  | { kind: 'sequence'; seq: SeqDoc; meta: DiagramFile['meta'] };
/** Read a file of any kind and version. */
export function readAny(input: unknown): Loaded {
  const d: any = input;
  if (d && typeof d === 'object' && d.kind === 'class') {
    if (typeof d.version === 'number' && d.version > FORMAT_VERSION) throw new Error(`Document version ${d.version} is newer than this app understands (${FORMAT_VERSION})`);
    const m = d.model ?? {};
    if (!Array.isArray(m.classes) || !Array.isArray(m.relations)) throw new Error('Malformed class diagram');
    return { kind: 'class', cls: sanitizeCls(m, d.layout?.positions), meta: cleanMeta(d.meta, 'Untitled classes') };
  }
  if (d && typeof d === 'object' && d.kind === 'sequence') {
    if (typeof d.version === 'number' && d.version > FORMAT_VERSION) throw new Error(`Document version ${d.version} is newer than this app understands (${FORMAT_VERSION})`);
    const m = d.model ?? {};
    if (!Array.isArray(m.participants) || !Array.isArray(m.rows)) throw new Error('Malformed sequence');
    return { kind: 'sequence', seq: sanitizeSeq(m), meta: cleanMeta(d.meta, 'Untitled sequence') };
  }
  return { kind: 'system', ...fromFile(input) };
}
/** meta from an untrusted file: a string title, ISO-ish timestamps, string tags. */
export function cleanMeta(raw: unknown, fallback: string): DiagramFile['meta'] {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
  return {
    title: s(m.title).trim() || fallback,
    // stable fallbacks: reading the same file twice must give the same meta (autosave compares them)
    created: s(m.created) || s(m.updated) || '', updated: s(m.updated) || s(m.created) || '',
    ...(Array.isArray(m.tags) ? { tags: m.tags.filter(t => typeof t === 'string') } : {}),
  };
}
export function kindOfFile(input: unknown): DiagramKind { const k = (input as any)?.kind; return k === 'sequence' || k === 'class' ? k : 'system'; }

/** Accepts any version this app has ever written and returns an editor Doc. */
export function fromFile(input: unknown): { doc: Doc; meta: DiagramFile['meta'] } {
  const f = migrate(input);
  const c = cleanSystem(f);
  const doc = adopt({ nodes: c.nodes, edges: c.edges, containers: c.containers, links: c.links, frames: c.frames, detail: f.layout.detail ?? {} });
  return { doc, meta: cleanMeta(f.meta, 'Untitled system') };
}

/**
 * A system model from an untrusted file, made safe to draw and edit: objects where objects belong, plain
 * unique ids, kinds that are identifiers, string names, numeric positions, arrays where arrays belong, and
 * edges/links between things that exist. Unknown fields are kept.
 */
function cleanSystem(f: DiagramFile) {
  const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
  const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
  const id = (v: unknown) => str(v).replace(/[^\w.:-]/g, '');
  const numOr = (v: unknown, d: number) => { const x = Number(v); return v !== null && v !== '' && Number.isFinite(x) ? x : d; };
  const unique = (seen: Set<string>, v: unknown, prefix: string) => { let i = id(v); if (!i || seen.has(i)) { let k = seen.size + 1; do i = `${prefix}${k++}`; while (seen.has(i)); } seen.add(i); return i; };
  const pos = obj(f.layout?.positions) ? f.layout.positions : {};
  const nodeIds = new Set<string>(), renamed = new Map<string, string>();
  const nodes = (Array.isArray(f.model?.nodes) ? f.model.nodes : []).filter(obj).map((n: any) => {
    const nid = unique(nodeIds, n.id, 'n'); if (str(n.id) && str(n.id) !== nid && !renamed.has(str(n.id))) renamed.set(str(n.id), nid);
    const p: Record<string, unknown> = obj(pos[str(n.id)]) ? pos[str(n.id)] : {};
    const out: any = { ...n, id: nid, kind: /^[\w-]+$/.test(str(n.kind)) ? str(n.kind) : 'service', name: str(n.name), x: numOr(p.x, 0), y: numOr(p.y, 0) };
    if ('tables' in n) out.tables = (Array.isArray(n.tables) ? n.tables : []).filter(obj).map((t: any) => ({ ...t, name: str(t.name), columns: (Array.isArray(t.columns) ? t.columns : []).filter(obj).map((c: any) => ({ ...c, name: str(c.name), type: str(c.type) })) }));
    if ('endpoints' in n) out.endpoints = (Array.isArray(n.endpoints) ? n.endpoints : []).filter(obj).map((e: any) => ({ ...e, method: str(e.method) || 'GET', path: str(e.path) }));
    if ('container' in n) out.container = n.container === null ? null : id(n.container) || null;
    return out;
  }) as Node[];
  const edgeIds = new Set<string>();
  const edges = (Array.isArray(f.model?.edges) ? f.model.edges : []).filter(obj)
    .map((e: any) => ({ ...e, from: renamed.get(str(e.from)) ?? id(e.from), to: renamed.get(str(e.to)) ?? id(e.to) }))
    .filter((e: any) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e: any) => ({ ...e, id: unique(edgeIds, e.id, 'e') }));
  const cIds = new Set<string>();
  const containers = (Array.isArray(f.model?.containers) ? f.model.containers : []).filter(obj).map((c: any) => ({ ...c, id: unique(cIds, c.id, 'c'), name: str(c.name), kind: /^[\w-]+$/.test(str(c.kind)) ? str(c.kind) : 'cloud', parent: c.parent ? id(c.parent) : null }));
  const lIds = new Set<string>();
  const links = (Array.isArray(f.model?.links) ? f.model.links : []).filter(obj).map((l: any) => ({ ...l, id: unique(lIds, l.id, 'l'), from: id(l.from), to: id(l.to), type: str(l.type) })).filter((l: any) => cIds.has(l.from) && cIds.has(l.to));
  const frames: Record<string, any> = {};
  if (obj(f.layout?.frames)) for (const [k, v] of Object.entries(f.layout.frames)) if (obj(v) && cIds.has(k)) frames[k] = { ...v, x: numOr(v.x, 0), y: numOr(v.y, 0), w: numOr(v.w, 300), h: numOr(v.h, 200) };
  return { nodes, edges, containers, links, frames };
}

type Migration = (d: any) => any;
const migrations: Record<number, Migration> = {
  // v1 → v2: the bare editor doc {targetRps, nodes[x,y], edges} becomes an envelope.
  1: (d) => {
    const now = new Date().toISOString();
    const positions: Record<string, { x: number; y: number }> = {};
    const nodes = (d.nodes ?? []).map((n: any) => { const { x = 0, y = 0, ...rest } = n; positions[n.id] = { x, y }; return rest; });
    return { version: 2, kind: 'system', meta: { title: 'Untitled system', created: now, updated: now }, model: { targetRps: d.targetRps ?? 1000, nodes, edges: d.edges ?? [] }, layout: { positions } };
  },
  // v2 → v3: containers (environments) and links between them. Nothing is placed in a container.
  2: (d) => ({ ...d, version: 3, model: { ...d.model, containers: [], links: [] }, layout: { ...d.layout, frames: {} } }),
  3: v3to4,
};

/**
 * v3 → v4:
 *  - load moves from one diagram-wide `targetRps` onto each Clients node (`rps`). Every client used to receive
 *    the full target, so each gets that number — results are unchanged.
 *  - a Kafka node is one topic. A node with topics [a, b, c] becomes the topic `a` (keeping its id, so edges and
 *    positions stay), plus new nodes for b and c below it, wired to the same neighbours. The old node name is
 *    kept as `cluster`.
 */
export function v3to4(d: any): any {
  const model = d.model ?? {}, layout = d.layout ?? {};
  const target = typeof model.targetRps === 'number' ? model.targetRps : 1000;
  const positions = { ...(layout.positions ?? {}) };
  const ids = new Set<string>((model.nodes ?? []).map((n: any) => n.id));
  let seq = 1; const freshId = (base: string) => { let id; do id = `${base}t${seq++}`; while (ids.has(id)); ids.add(id); return id; };
  const nodes: any[] = [], edges: any[] = [...(model.edges ?? [])];
  for (const n of model.nodes ?? []) {
    if (n.kind === 'entry') { nodes.push({ ...n, rps: typeof n.rps === 'number' ? n.rps : target }); continue; }
    if (n.kind !== 'queue' || !Array.isArray(n.topics)) { nodes.push(n); continue; }
    const { topics, ...rest } = n;
    const asTopic = (t: any) => ({ name: t?.name || n.name, partitions: t?.partitions ?? 6, schema: t?.schema ?? '', ...(t?.key ? { key: t.key } : {}), ...(t?.name && n.name && t.name !== n.name ? { cluster: n.name } : {}) });
    nodes.push({ ...rest, ...asTopic(topics[0]) });
    const p = positions[n.id] ?? { x: 0, y: 0 };
    topics.slice(1).forEach((t: any, i: number) => {
      const id = freshId(n.id);
      nodes.push({ ...rest, id, ...asTopic(t) });
      positions[id] = { x: p.x, y: p.y + (i + 1) * 132 };
      for (const e of model.edges ?? []) {
        if (e.from === n.id) edges.push({ ...e, id: freshId(e.id), from: id });
        else if (e.to === n.id) edges.push({ ...e, id: freshId(e.id), to: id });
      }
    });
  }
  const { targetRps: _drop, ...restModel } = model;
  return { ...d, version: 4, model: { ...restModel, nodes, edges }, layout: { ...layout, positions } };
}

export function detectVersion(d: any): number {
  if (d && typeof d === 'object' && typeof d.version === 'number') return d.version;
  if (d && Array.isArray(d.nodes) && Array.isArray(d.edges)) return 1;
  throw new Error('Not a cistem.dev document');
}

export function migrate(input: unknown): DiagramFile {
  let d: any = input, v = detectVersion(d);
  if (v > FORMAT_VERSION) throw new Error(`Document version ${v} is newer than this app understands (${FORMAT_VERSION})`);
  while (v < FORMAT_VERSION) { const m = migrations[v]; if (!m) throw new Error(`No migration from version ${v}`); d = m(d); v = d.version; }
  if (d.kind !== 'system') throw new Error(`Unsupported diagram kind "${d.kind}"`);
  if (!d.model || !Array.isArray(d.model.nodes) || !Array.isArray(d.model.edges)) throw new Error('Malformed model');
  d.layout = d.layout ?? { positions: {} };
  d.layout.positions = d.layout.positions ?? {};
  d.layout.frames = d.layout.frames ?? {};
  d.model.containers = d.model.containers ?? []; d.model.links = d.model.links ?? [];
  return d as DiagramFile;
}

/** Nodes with no stored position get laid out by the caller; this reports which. */
export function unpositioned(f: DiagramFile): string[] {
  return f.model.nodes.filter(n => !f.layout.positions[n.id]).map(n => n.id);
}
