/**
 * Structured views over the JSON text we store for request/response bodies and Avro schemas.
 *
 * The document keeps plain JSON text (so the file format, MCP tools and other editors stay simple);
 * these helpers turn that text into a tree of fields the inspector can edit, and back again.
 * Round-trips are lossless for everything the tree can express; anything exotic stays editable as text.
 */

// ---------- JSON bodies (example-shaped) ----------

export type JType = 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array';
export const J_TYPES: JType[] = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'];
export interface JField {
  name: string;
  type: JType;
  /** example value as JSON text for scalars (e.g. "pay_01H…", 1200, true) */
  example: string;
  /** array item type */
  items?: JType;
  /** children for object, or for array<object> */
  children?: JField[];
}

const jtypeOf = (v: unknown): JType => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v === 'boolean' ? 'boolean' : 'string';

function jfield(name: string, v: unknown): JField {
  const type = jtypeOf(v);
  if (type === 'object') return { name, type, example: '', children: Object.entries(v as object).map(([k, x]) => jfield(k, x)) };
  if (type === 'array') {
    const arr = v as unknown[];
    const first = arr.find(x => x !== undefined);
    const items = arr.length ? jtypeOf(first) : 'string';
    const f: JField = { name, type, example: '', items };
    if (items === 'object') f.children = jfield('', first).children;
    else if (arr.length) f.example = items === 'string' ? String(first) : JSON.stringify(first);
    return f;
  }
  return { name, type, example: type === 'null' ? '' : type === 'string' ? String(v) : JSON.stringify(v) };
}

/** Parse body text into fields; null when it's not a JSON object (empty text → empty list). */
export function parseJsonFields(text: string): JField[] | null {
  if (!text.trim()) return [];
  try { const j = JSON.parse(text); if (!j || typeof j !== 'object' || Array.isArray(j)) return null; return jfield('', j).children!; } catch { return null; }
}

const defaultExample = (t: JType): unknown => t === 'string' ? 'string' : t === 'number' ? 1.5 : t === 'integer' ? 1 : t === 'boolean' ? true : null;
function jvalue(f: JField): unknown {
  switch (f.type) {
    case 'object': return Object.fromEntries((f.children || []).map(c => [c.name, jvalue(c)]));
    case 'array': {
      const it = f.items || 'string';
      if (it === 'object') return [Object.fromEntries((f.children || []).map(c => [c.name, jvalue(c)]))];
      if (it === 'array') return [[]];
      return [exampleValue(f.example, it)];
    }
    case 'null': return null;
    default: return exampleValue(f.example, f.type);
  }
}
function exampleValue(ex: string, t: JType): unknown {
  if (t === 'string') return ex === '' ? defaultExample(t) : ex;
  if (ex.trim() !== '') {
    try { const v = JSON.parse(ex); if (jtypeOf(v) === t || (t === 'number' && typeof v === 'number')) return v; } catch { /* fall through */ }
    if (t === 'number' || t === 'integer') { const n = Number(ex); if (!Number.isNaN(n)) return t === 'integer' ? Math.trunc(n) : n; }
    if (t === 'boolean') return /^(true|yes|1)$/i.test(ex.trim());
  }
  return defaultExample(t);
}
export const jsonFieldsToText = (fields: JField[]): string => fields.length ? JSON.stringify(jvalue({ name: '', type: 'object', example: '', children: fields }), null, 2) : '';

// ---------- Avro records ----------

export type AType = 'string' | 'int' | 'long' | 'float' | 'double' | 'boolean' | 'bytes' | 'uuid' | 'date' | 'timestamp-millis' | 'decimal' | 'enum' | 'array' | 'map' | 'record';
export const A_TYPES: AType[] = ['string', 'long', 'int', 'double', 'float', 'boolean', 'uuid', 'timestamp-millis', 'date', 'decimal', 'bytes', 'enum', 'array', 'map', 'record'];
export interface AField {
  name: string;
  type: AType;
  nullable: boolean;
  /** item/value type for array / map */
  items?: AType;
  /** nested record fields (type record, or array/map of record) */
  children?: AField[];
  /** record name for nested records; enum name */
  typeName?: string;
  /** enum symbols, comma separated */
  symbols?: string;
  doc?: string;
}
export interface ARecord { name: string; namespace: string; doc?: string; fields: AField[] }

const PRIMS = new Set(['string', 'int', 'long', 'float', 'double', 'boolean', 'bytes']);
/** Resolve an Avro type node into (type, extras); undefined when we can't express it. */
function atype(t: any, into: Partial<AField>): boolean {
  if (typeof t === 'string') { if (!PRIMS.has(t)) return false; into.type = t as AType; return true; }
  if (!t || typeof t !== 'object' || Array.isArray(t)) return false;
  if (t.logicalType) {
    const l = String(t.logicalType);
    if (l === 'uuid' || l === 'date' || l === 'timestamp-millis' || l === 'decimal') { into.type = l as AType; return true; }
    return false;
  }
  if (t.type === 'enum') { into.type = 'enum'; into.typeName = t.name; into.symbols = (t.symbols || []).join(', '); return true; }
  if (t.type === 'record') { into.type = 'record'; into.typeName = t.name; const ch = afields(t.fields); if (!ch) return false; into.children = ch; return true; }
  if (t.type === 'array' || t.type === 'map') {
    const inner: Partial<AField> = {}; if (!atype(t.type === 'array' ? t.items : t.values, inner)) return false;
    if (inner.type === 'array' || inner.type === 'map' || inner.type === 'enum') return false;
    into.type = t.type; into.items = inner.type; if (inner.type === 'record') { into.children = inner.children; into.typeName = inner.typeName; }
    return true;
  }
  return false;
}
function afields(fs: any): AField[] | null {
  if (!Array.isArray(fs)) return null;
  const out: AField[] = [];
  for (const f of fs) {
    if (!f || typeof f.name !== 'string') return null;
    let t = f.type, nullable = false;
    if (Array.isArray(t)) { const rest = t.filter((x: unknown) => x !== 'null'); if (rest.length !== 1 || rest.length === t.length) return null; nullable = true; t = rest[0]; }
    const af: Partial<AField> = { name: f.name, nullable };
    if (!atype(t, af)) return null;
    if (typeof f.doc === 'string' && f.doc) af.doc = f.doc;
    out.push(af as AField);
  }
  return out;
}
/** Parse Avro schema text into a record; null when it's not a record we can show as fields (empty text → empty record). */
export function parseAvro(text: string): ARecord | null {
  if (!text.trim()) return { name: '', namespace: '', fields: [] };
  try {
    const j = JSON.parse(text);
    if (!j || j.type !== 'record') return null;
    const fields = afields(j.fields ?? []); if (!fields) return null;
    const r: ARecord = { name: String(j.name ?? ''), namespace: String(j.namespace ?? ''), fields };
    if (typeof j.doc === 'string' && j.doc) r.doc = j.doc;
    return r;
  } catch { return null; }
}

const pascal = (s: string) => (s || 'Item').replace(/(^|[^a-zA-Z0-9])([a-zA-Z0-9])/g, (_m, _p, c) => c.toUpperCase());
function avroTypeNode(f: AField, forItems = false): unknown {
  const t = forItems ? f.items! : f.type;
  switch (t) {
    case 'uuid': return { type: 'string', logicalType: 'uuid' };
    case 'date': return { type: 'int', logicalType: 'date' };
    case 'timestamp-millis': return { type: 'long', logicalType: 'timestamp-millis' };
    case 'decimal': return { type: 'bytes', logicalType: 'decimal', precision: 18, scale: 2 };
    case 'enum': return { type: 'enum', name: f.typeName || pascal(f.name), symbols: (f.symbols || '').split(',').map(s => s.trim()).filter(Boolean) };
    case 'record': return { type: 'record', name: f.typeName || pascal(f.name), fields: (f.children || []).map(avroFieldNode) };
    case 'array': return { type: 'array', items: avroTypeNode(f, true) };
    case 'map': return { type: 'map', values: avroTypeNode(f, true) };
    default: return t;
  }
}
function avroFieldNode(f: AField): unknown {
  const t = avroTypeNode(f);
  const o: Record<string, unknown> = { name: f.name, type: f.nullable ? ['null', t] : t };
  if (f.nullable) o.default = null;
  if (f.doc) o.doc = f.doc;
  return o;
}
export function avroToText(r: ARecord): string {
  const o: Record<string, unknown> = { type: 'record', name: r.name };
  if (r.namespace) o.namespace = r.namespace;
  if (r.doc) o.doc = r.doc;
  o.fields = r.fields.map(avroFieldNode);
  return JSON.stringify(o, null, 2);
}

// ---------- tree addressing ----------

/** Children list at a dotted index path like "2.0" (the children of field 0 inside field 2); "" = root list. */
export function listAt<T extends { children?: T[] }>(root: T[], path: string): T[] {
  if (!path) return root;
  let list = root;
  for (const idx of path.split('.')) { const f = list[+idx]; f.children = f.children || []; list = f.children; }
  return list;
}

// ---------- headers ----------

export const COMMON_HEADERS = ['Authorization', 'Content-Type', 'Accept', 'Idempotency-Key', 'X-Request-Id', 'X-Correlation-Id', 'X-Api-Key', 'User-Agent', 'Accept-Language', 'If-Match', 'If-None-Match', 'Cache-Control', 'X-Forwarded-For', 'Traceparent', 'Cookie'];
export const HEADER_VALUES: Record<string, string[]> = {
  'Authorization': ['Bearer <token>', 'Basic <base64>', 'HMAC <signature>'],
  'Content-Type': ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'],
  'Accept': ['application/json', '*/*'],
  'Idempotency-Key': ['<uuid>'],
  'X-Request-Id': ['<uuid>'],
  'X-Correlation-Id': ['<uuid>'],
  'X-Api-Key': ['<key>'],
  'Cache-Control': ['no-cache', 'no-store', 'max-age=60'],
  'Accept-Language': ['en-GB', 'en-US'],
  'If-Match': ['"<etag>"'],
  'If-None-Match': ['"<etag>"'],
};
