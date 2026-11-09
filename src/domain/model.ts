import type { CanvasNote } from './notes';
import TYPES_FILE from '../../shared/component-types.json';

/** A component type's key in shared/component-types.json ("service", "db", "sqs"…). */
export type Kind = string;
export type Behaviour = 'source' | 'balancer' | 'limit' | 'scaled' | 'cache' | 'store' | 'async';
/** What a node expands to show on the canvas, and its second panel tab. */
export type DetailKind = 'endpoints' | 'tables' | 'topic' | 'message' | null;
export interface FieldDef { key: string; label: string; type: 'number' | 'text' | 'select' | 'boolean'; options?: string[]; min?: number; max?: number; step?: number; wide?: boolean }
export interface TypeDef { label: string; short: string; icon: string; color: string; w: number; group: string; behaviour: Behaviour; detail: DetailKind; defaults: Record<string, unknown>; fields: FieldDef[] }
export const TYPES = (TYPES_FILE as unknown as { types: Record<string, TypeDef> }).types;
/** Fields the load model reads (capacity, rps, latency…): hidden with the load view off. */
export const LOAD_FIELDS = new Set(Object.values((TYPES_FILE as unknown as { behaviours: Record<string, { reads: string[] }> }).behaviours).flatMap(b => b.reads));
/** A kind this build doesn't know (a newer file, a typo) still loads: drawn plainly, no capacity. */
const UNKNOWN: TypeDef = { label: 'Component', short: '?', icon: 'ic-service', color: '#6b7280', w: 200, group: 'other', behaviour: 'limit', detail: null, defaults: {}, fields: [] };
export const typeDef = (kind: Kind): TypeDef => TYPES[kind] ?? { ...UNKNOWN, label: kind };
export const behaviourOf = (n: { kind: Kind }) => typeDef(n.kind).behaviour;
export const detailOf = (n: { kind: Kind }) => typeDef(n.kind).detail;
export const isSource = (n: { kind: Kind }) => behaviourOf(n) === 'source';
/** What a component calls itself: its chosen type (a service can be an Application, a Worker…) or its kind's label. */
export const kindLabel = (n: { kind: Kind; variant?: unknown }) => (typeof n.variant === 'string' && n.variant.trim() ? n.variant.trim() : typeDef(n.kind).label);
export const isAsync = (n: { kind: Kind }) => behaviourOf(n) === 'async';
/** Has a message schema (Kafka topic, SQS queue…). */
export const hasSchemaDetail = (n: { kind: Kind }) => detailOf(n) === 'topic' || detailOf(n) === 'message';

export interface Header { k: string; v: string }
export interface Endpoint { method: string; path: string; headers: Header[]; req: string; res: string }
export interface Column { name: string; type: string; pk: boolean; nullable: boolean; unique?: boolean; references?: string | null; default?: string; index?: boolean }
/** `references` is "table.column" within the same database, or "node:table.column" for another database node. */
export interface Table { name: string; columns: Column[] }
export interface Topic { name: string; partitions: number; schema: string; key?: string }

/**
 * A component. Which fields matter depends on its type's behaviour (see shared/component-types.json):
 * source: rps · balancer/limit: maxRps · scaled: instances, rpsPerInstance · cache: maxOps, hitRatio ·
 * store: maxQps, replicas, readShare · async: maxThroughput — plus latency, and the type's detail
 * (endpoints, tables, or topic/message schema).
 */
export interface NodeData {
  id: string; kind: Kind; name: string; latency?: number; container?: string | null;
  /** Rich notes (markdown), see notes.ts. */
  notes?: string;
  /** A small logo drawn instead of the type's icon: a data: URL (PNG, JPEG or WebP), see lib/logo.ts. */
  logo?: string;
  /** Card style: a dashed border (e.g. for something you don't run), and a colour instead of the type's. */
  border?: 'dashed'; color?: ContainerColor;
  /** What it calls itself on the card (a service's type: Application, Worker…), see kindLabel. */
  variant?: string;
  rps?: number; platforms?: string[];
  maxRps?: number; instances?: number; rpsPerInstance?: number; maxOps?: number; hitRatio?: number; eviction?: string;
  maxQps?: number; replicas?: number; readShare?: number; maxThroughput?: number;
  endpoints?: Endpoint[]; tables?: Table[];
  /** topic / message detail */
  partitions?: number; schema?: string; key?: string; cluster?: string; fifo?: boolean;
  [extra: string]: unknown;
}
/** A component on the canvas: its data plus where it sits. */
export interface Node extends NodeData { x: number; y: number }
// Names kept for readability at call sites; they're all the same shape now.
export type EntryNode = Node; export type ServiceNode = Node; export type DbNode = Node & { tables: Table[] }; export type QueueNode = Node & { schema: string };

export interface Edge {
  id: string; from: string; to: string; calls: number; endpoint?: number | null; notes?: string;
  /** Text shown on the line (see EdgeLabel); `showNotes` puts the notes under it too. */
  label?: string; showNotes?: boolean;
  /** Style; absent = the default (solid — dashed when it crosses an environment —, grey, medium, arrow at the end). */
  line?: EdgeLine; color?: ContainerColor; width?: 'thin' | 'thick'; arrows?: 'both' | 'none';
}
export type EdgeLine = 'solid' | 'dashed' | 'dotted';

/** A boundary that components live in: a cloud, an account, a VPC... Nested via `parent`. */
export type ContainerKind = 'cloud' | 'account' | 'vpc' | 'region' | 'datacentre' | 'team';
export type ContainerColor = 'blue' | 'violet' | 'teal' | 'green' | 'amber' | 'orange' | 'red' | 'pink' | 'slate';
export type ContainerFill = 'tint' | 'solid' | 'outline';
export interface Container { id: string; kind: ContainerKind; name: string; parent: string | null; provider?: string; owner?: string; note?: string; notes?: string; color?: ContainerColor; fill?: ContainerFill; border?: 'dashed' | 'solid' }
/** How two containers talk; adds latency to every edge crossing between them (or their descendants). */
/**
 * Every quantity in the model (rps, calls, capacities, latencies) is a non-negative finite number. Numeric
 * strings count (imports, MCP); anything else — text, negatives, NaN, Infinity, booleans — reads as 0.
 * io.cistem.engine.Engine.num does the same.
 */
export const qty = (v: unknown) => {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(x) && x > 0 ? x : 0;
};
export interface Link { id: string; from: string; to: string; type: string; latencyMs: number }
/** Editor-side frame geometry for a container. */
export interface Frame { x: number; y: number; w: number; h: number }

export type Detail = 'compact' | 'expanded';
export interface Doc { nodes: Node[]; edges: Edge[]; containers: Container[]; links: Link[]; frames: Record<string, Frame>; detail: Record<string, Detail>; notes?: CanvasNote[] }

export const CONTAINER_KINDS: Record<ContainerKind, { label: string; hue: number }> = {
  cloud:      { label: 'Cloud',       hue: 210 },
  account:    { label: 'Account',     hue: 260 },
  vpc:        { label: 'VPC',         hue: 160 },
  region:     { label: 'Region',      hue: 30 },
  datacentre: { label: 'Data centre', hue: 350 },
  team:       { label: 'Team',        hue: 90 },
};
/** Frame colours: hue and saturation (slate is the near-neutral one). */
export const CONTAINER_COLORS: Record<ContainerColor, { h: number; s: number }> = {
  blue: { h: 212, s: 60 }, violet: { h: 262, s: 45 }, teal: { h: 176, s: 45 }, green: { h: 140, s: 40 }, amber: { h: 42, s: 75 },
  orange: { h: 24, s: 70 }, red: { h: 356, s: 60 }, pink: { h: 326, s: 50 }, slate: { h: 215, s: 14 },
};
/** A palette colour as CSS (its lightness follows the theme, --pal-l), or null for "the default". */
export const paletteCss = (c: unknown) => {
  const p = typeof c === 'string' ? CONTAINER_COLORS[c as ContainerColor] : undefined;
  return p ? `hsl(${p.h} ${p.s}% var(--pal-l))` : null;
};
export const isPaletteColor = (c: unknown): c is ContainerColor => typeof c === 'string' && c in CONTAINER_COLORS;
/** The colour a frame shows: its own, or its kind's default. */
export const frameColor = (c: Container) => c.color && CONTAINER_COLORS[c.color] ? CONTAINER_COLORS[c.color] : { h: CONTAINER_KINDS[c.kind].hue, s: 45 };
export const LINK_TYPES: Record<string, number> = {
  'same-network': 0, 'vpc-peering': 1, 'privatelink': 2, 'transit-gateway': 3, 'vpn': 20, 'direct-connect': 10, 'public-internet': 40,
};
/** Default crossing latency when no link is declared, by how far apart the two containers are. */
export const CROSSING_DEFAULT_MS = { sameContainer: 0, siblings: 1, differentRoots: 10 };
export const FRAME_PAD = 28, FRAME_HEAD = 30;

/** Panel-facing view of the types (label, width, defaults, [key, label] fields), derived from TYPES. */
export interface KindDef { label: string; w: number; defaults: Record<string, unknown>; fields: [string, string][] }
export const KINDS: Record<Kind, KindDef> = new Proxy({} as Record<Kind, KindDef>, {
  get: (_t, k: string) => { const d = typeDef(k); return { label: d.label, w: d.w, defaults: d.defaults, fields: d.fields.map(f => [f.key, f.label] as [string, string]) }; },
  has: (_t, k: string) => k in TYPES,
  ownKeys: () => Object.keys(TYPES),
  getOwnPropertyDescriptor: (_t, k: string) => (k in TYPES ? { enumerable: true, configurable: true } : undefined),
});

export const NODE_H = 92;
/** Sum of every client's peak rps: the load the whole diagram is tested at. */
export const totalRps = (doc: { nodes: Node[] }) => doc.nodes.reduce((a, n) => a + (isSource(n) ? Number(n.rps) || 0 : 0), 0);
/** Row heights for the expanded view. Deterministic so Java agrees. */
export const EXP = { tableHead: 22, row: 16, tablePad: 8, tableGap: 10, endpointRow: 18, topicHead: 20, topicRow: 15, sectionPad: 10, max: 560 };
/** Expanded node height from its content; compact nodes are NODE_H. */
export function nodeHeight(n: { kind: Kind; endpoints?: Endpoint[]; tables?: Table[]; schema?: string }, detail: Detail | undefined): number {
  if (detail !== 'expanded') return NODE_H;
  let extra = 0;
  const d = detailOf(n);
  if (d === 'tables') { const ts = n.tables ?? []; extra = ts.reduce((h, t) => h + EXP.tableHead + (t.columns?.length ?? 0) * EXP.row + EXP.tablePad, 0) + Math.max(0, ts.length - 1) * EXP.tableGap; }
  else if (d === 'endpoints') extra = (n.endpoints?.length ?? 0) * EXP.endpointRow;
  else if (d === 'topic' || d === 'message') { const f = topicFields({ schema: n.schema ?? '' }).length; extra = f ? EXP.topicHead + f * EXP.topicRow : 0; }
  if (extra === 0) return NODE_H;
  return Math.min(EXP.max, NODE_H + EXP.sectionPad + extra + EXP.sectionPad);
}
/** Expanded nodes also widen so table rows fit. */
export function nodeWidthFor(n: { kind: Kind; name?: string; tables?: Table[] }, detail: Detail | undefined): number {
  const w = nodeWidth(n);
  if (detail !== 'expanded') return w;
  if (detailOf(n) === 'tables') { const longest = (n.tables ?? []).reduce((m, t) => Math.max(m, ...(t.columns ?? []).map(c => c.name.length + c.type.length + 3 + (c.references ? 6 : 0))), 0); return Math.min(360, Math.max(w, 40 + longest * 6.4 + 60)); }
  if (detailOf(n) === 'endpoints') return Math.max(w, 280);
  if (detailOf(n) === 'topic' || detailOf(n) === 'message') return Math.max(w, 280);
  return w;
}
/** Avro record fields as [name, type] pairs, from the schema text; empty if it doesn't parse. */
export function topicFields(t: { schema?: string }): [string, string][] {
  try {
    const j = JSON.parse(t.schema || '');
    if (!j || !Array.isArray(j.fields)) return [];
    return j.fields.map((f: any) => [String(f.name), avroType(f.type)]);
  } catch { return []; }
}
function avroType(t: any): string {
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.filter(x => x !== 'null').map(avroType).join('|') + (t.includes('null') ? '?' : '');
  if (t && typeof t === 'object') { if (t.logicalType) return t.logicalType; if (t.type === 'array') return `array<${avroType(t.items)}>`; if (t.type === 'map') return `map<${avroType(t.values)}>`; if (t.type === 'enum') return `enum(${(t.symbols || []).length})`; if (t.type === 'record') return t.name || 'record'; return String(t.type); }
  return String(t);
}
/** Foreign keys: [fromNode, fromTable, fromCol, toNode, toTable, toCol]. */
export function foreignKeys(doc: Doc): Array<{ from: { node: string; table: string; col: string }; to: { node: string; table: string; col: string } }> {
  const out: Array<{ from: { node: string; table: string; col: string }; to: { node: string; table: string; col: string } }> = [];
  for (const n of doc.nodes) if (detailOf(n) === 'tables') for (const t of n.tables ?? []) for (const c of t.columns ?? []) {
    if (!c.references) continue;
    let ref = c.references, node = n.id;
    if (ref.includes(':')) { const [nid, rest] = ref.split(':'); node = nid; ref = rest; }
    const [table, col] = ref.split('.');
    if (table) out.push({ from: { node: n.id, table: t.name, col: c.name }, to: { node, table, col: col || 'id' } });
  }
  return out;
}
/** Node width follows the name so long names aren't clipped; deterministic (no font metrics) so Java agrees. */
export function nodeWidth(n: { kind: Kind; name?: string }): number {
  const base = typeDef(n.kind).w;
  const need = 56 + (n.name?.length ?? 0) * 7.8 + 16;
  return Math.min(320, Math.max(base, Math.round(need / 8) * 8));
}
export const ICON = 26;
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const PG_TYPES = ['uuid', 'text', 'varchar(255)', 'integer', 'bigint', 'numeric(18,2)', 'boolean', 'timestamptz', 'date', 'jsonb'];
export const EVICTIONS = ['allkeys-lru', 'volatile-lru', 'allkeys-lfu', 'volatile-ttl', 'noeviction'];

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

let uid = 1;
export const nextId = (prefix = 'n') => prefix + (uid++);
export const bumpId = (doc: Doc) => {
  const all: { id: string }[] = [...doc.nodes, ...doc.edges, ...(doc.containers ?? []), ...(doc.links ?? [])];
  uid = Math.max(2, ...all.map(x => parseInt(String(x.id).replace(/\D/g, '')) || 0)) + 1;
};

export function makeContainer(kind: ContainerKind, name: string, parent: string | null = null): Container {
  return { id: nextId('c'), kind, name, parent };
}
/** Root-ward chain of container ids for a node (nearest first). */
export function ancestry(doc: Doc, containerId: string | null | undefined): string[] {
  const out: string[] = []; const byId = new Map(doc.containers.map(c => [c.id, c]));
  let cur = containerId ?? null; let guard = 0;
  while (cur && guard++ < 32) { out.push(cur); cur = byId.get(cur)?.parent ?? null; }
  return out;
}
/** Latency added to a call from container a to container b (either may be null = unplaced). */
export function crossingLatency(doc: Doc, a: string | null | undefined, b: string | null | undefined): number {
  if ((a ?? null) === (b ?? null)) return 0;
  const pa = ancestry(doc, a), pb = ancestry(doc, b);
  // explicit link between any ancestor pair wins (nearest first)
  for (const x of pa.length ? pa : ['']) for (const y of pb.length ? pb : ['']) {
    const l = doc.links.find(l => (l.from === x && l.to === y) || (l.from === y && l.to === x));
    if (l) return qty(l.latencyMs);
  }
  if (!a || !b) return CROSSING_DEFAULT_MS.siblings;
  const rootA = pa[pa.length - 1], rootB = pb[pb.length - 1];
  return rootA === rootB ? CROSSING_DEFAULT_MS.siblings : CROSSING_DEFAULT_MS.differentRoots;
}
export function containerDepth(doc: Doc, id: string): number { return ancestry(doc, id).length - 1; }
/** Members of a container, including those in nested containers. */
export function membersOf(doc: Doc, id: string): Node[] { return doc.nodes.filter(n => ancestry(doc, n.container).includes(id)); }

export function makeNode(kind: Kind, x: number, y: number, props: Record<string, unknown> = {}): Node {
  return { id: nextId(), kind, x, y, ...clone(typeDef(kind).defaults), ...props } as Node;
}

/** Fill in any fields a loaded document is missing (older saves, hand-edited JSON). */
export function adopt(d: unknown): Doc {
  const doc = d as Doc;
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw new Error('not a cistem.dev document');
  doc.nodes.forEach(n => {
    const defs = typeDef(n.kind).defaults;
    Object.keys(defs).forEach(k => { if ((n as any)[k] === undefined) (n as any)[k] = clone(defs[k]); });
    if (n.container === undefined) n.container = null;
  });
  doc.containers = doc.containers ?? []; doc.links = doc.links ?? []; doc.frames = doc.frames ?? {}; doc.detail = doc.detail ?? {};
  // drop dangling references rather than failing
  const cids = new Set(doc.containers.map(c => c.id));
  doc.nodes.forEach(n => { if (n.container && !cids.has(n.container)) n.container = null; });
  doc.containers.forEach(c => { if (c.parent && !cids.has(c.parent)) c.parent = null; });
  // an environment kind this app doesn't know (hand-edited or newer files) shows as a generic cloud
  doc.containers.forEach(c => { if (!(c.kind in CONTAINER_KINDS)) c.kind = 'cloud' as ContainerKind; });
  doc.links = doc.links.filter(l => cids.has(l.from) && cids.has(l.to));
  bumpId(doc);
  return doc;
}

export function exampleDoc(): Doc {
  uid = 1;
  const clients = makeNode('entry', 20, 200, { name: 'Checkout clients', rps: 5000 });
  const lb = makeNode('lb', 330, 200, { name: 'ALB' });
  const api = makeNode('service', 640, 200, {
    name: 'checkout-api', rpsPerInstance: 600, instances: 10, latency: 25, endpoints: [
      { method: 'POST', path: '/v1/payments', headers: [{ k: 'Authorization', v: 'Bearer <token>' }, { k: 'Idempotency-Key', v: '<uuid>' }],
        req: '{\n  "amount": 1299,\n  "currency": "GBP",\n  "card_token": "tok_..."\n}',
        res: '{\n  "id": "pay_01H...",\n  "status": "AUTHORISED"\n}' },
      { method: 'GET', path: '/v1/payments/{id}', headers: [{ k: 'Authorization', v: 'Bearer <token>' }], req: '', res: '{\n  "id": "pay_01H...",\n  "status": "CAPTURED"\n}' },
    ] });
  const cache = makeNode('cache', 960, 60, { name: 'session-cache', hitRatio: 0.85 });
  const db = makeNode('db', 960, 260, {
    name: 'payments-db', maxQps: 4000, replicas: 2, readShare: 0.85, latency: 6, tables: [
      { name: 'payments', columns: [
        { name: 'id', type: 'uuid', pk: true, nullable: false }, { name: 'merchant_id', type: 'uuid', pk: false, nullable: false, index: true },
        { name: 'idempotency_key', type: 'text', pk: false, nullable: false, unique: true },
        { name: 'amount_minor', type: 'bigint', pk: false, nullable: false }, { name: 'currency', type: 'varchar(255)', pk: false, nullable: false },
        { name: 'status', type: 'text', pk: false, nullable: false }, { name: 'created_at', type: 'timestamptz', pk: false, nullable: false } ] },
      { name: 'refunds', columns: [
        { name: 'id', type: 'uuid', pk: true, nullable: false }, { name: 'payment_id', type: 'uuid', pk: false, nullable: false, references: 'payments.id' },
        { name: 'amount_minor', type: 'bigint', pk: false, nullable: false } ] },
    ] });
  const q = makeNode('queue', 960, 460, {
    name: 'payments.authorised', cluster: 'events', partitions: 12, key: 'paymentId',
    schema: '{\n  "type": "record",\n  "name": "PaymentAuthorised",\n  "namespace": "com.example.payments",\n  "fields": [\n    {"name": "paymentId", "type": "string"},\n    {"name": "amountMinor", "type": "long"},\n    {"name": "currency", "type": "string"}\n  ]\n}' });
  const worker = makeNode('service', 1280, 460, { name: 'ledger-worker', rpsPerInstance: 400, instances: 8, latency: 40 });
  const aws = makeContainer('cloud', 'AWS'); aws.provider = 'aws';
  const edge = makeContainer('account', 'acq-edge', aws.id);
  const core = makeContainer('account', 'acq-core', aws.id);
  // the database starts expanded: keep what sits under it clear of its tables
  const below = db.y + nodeHeight(db, 'expanded') + 48;
  if (q.y < below) { q.y = below; worker.y = below; }
  lb.container = edge.id; api.container = edge.id;
  cache.container = core.id; db.container = core.id; q.container = core.id; worker.container = core.id;
  const doc: Doc = {
    containers: [aws, edge, core], frames: {}, detail: { [db.id]: 'expanded' },
    links: [{ id: 'l1', from: edge.id, to: core.id, type: 'privatelink', latencyMs: 2 }],
    nodes: [clients, lb, api, cache, db, q, worker], edges: [
      { id: 'e1', from: clients.id, to: lb.id, calls: 1 },
      { id: 'e2', from: lb.id, to: api.id, calls: 1, endpoint: 0 },
      { id: 'e3', from: api.id, to: cache.id, calls: 2 },
      { id: 'e4', from: cache.id, to: db.id, calls: 1 },
      { id: 'e5', from: api.id, to: db.id, calls: 1 },
      { id: 'e6', from: api.id, to: q.id, calls: 1 },
      { id: 'e7', from: q.id, to: worker.id, calls: 1 },
    ] };
  uid = 20;
  return doc;
}
