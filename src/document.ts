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

export const FORMAT_VERSION = 3;
export type DiagramKind = 'system';

export interface DiagramFile {
  version: number;
  kind: DiagramKind;
  meta: { title: string; created: string; updated: string; tags?: string[] };
  model: {
    targetRps: number;
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
    model: { targetRps: doc.targetRps, nodes, edges: doc.edges, containers: doc.containers ?? [], links: doc.links ?? [] },
    layout: { positions, frames: doc.frames ?? {}, ...(Object.keys(doc.detail ?? {}).length ? { detail: doc.detail } : {}) },
  };
}

/** Accepts any version this app has ever written and returns an editor Doc. */
export function fromFile(input: unknown): { doc: Doc; meta: DiagramFile['meta'] } {
  const f = migrate(input);
  const nodes = f.model.nodes.map(n => ({ ...n, ...(f.layout.positions[n.id] ?? { x: 0, y: 0 }) })) as Node[];
  const doc = adopt({ targetRps: f.model.targetRps, nodes, edges: f.model.edges, containers: f.model.containers, links: f.model.links, frames: f.layout.frames, detail: f.layout.detail ?? {} });
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
};

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
