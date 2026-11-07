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
import { adopt, type Doc, type Node, type Edge, type Container, type Link, type Frame } from './model';

export const FORMAT_VERSION = 4;
export type DiagramKind = 'system';

export interface DiagramFile {
  version: number;
  kind: DiagramKind;
  meta: { title: string; created: string; updated: string; tags?: string[] };
  model: {
    nodes: Array<Omit<Node, 'x' | 'y'>>;
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

/** Accepts any version this app has ever written and returns an editor Doc. */
export function fromFile(input: unknown): { doc: Doc; meta: DiagramFile['meta'] } {
  const f = migrate(input);
  const nodes = f.model.nodes.map(n => ({ ...n, ...(f.layout.positions[n.id] ?? { x: 0, y: 0 }) })) as Node[];
  const doc = adopt({ nodes, edges: f.model.edges, containers: f.model.containers, links: f.model.links, frames: f.layout.frames, detail: f.layout.detail ?? {} });
  return { doc, meta: f.meta };
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
  throw new Error('Not a cistem.io document');
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
