/**
 * Avro-aware smarts for the code editor, as pure functions over text (no CodeMirror here, so they're
 * unit-testable): where the cursor is in the JSON, what fits there, and what's wrong with the schema.
 * Works on half-typed input — that's the whole point of autocomplete.
 */

// ---------- a tolerant JSON scanner ----------

interface Frame {
  kind: 'obj' | 'arr';
  /** key (or array index) under which this container sits in its parent */
  key: string | number | null;
  /** obj: the key most recently read; arr: number of items started */
  lastKey: string | null;
  expect: 'key' | 'colon' | 'value' | 'comma';
  index: number;
  /** simple string values seen so far in this object (for role detection) */
  seen: Record<string, string>;
}

export interface Ctx {
  where: 'key' | 'value' | 'none';
  /** for values: the property the value belongs to (null inside a plain array) */
  key: string | null;
  /** path of keys/indices from the root to the container holding the cursor */
  path: (string | number)[];
  /** what's typed so far (without the opening quote) */
  partial: string;
  /** range to replace: from the opening quote (or word start) to just past the closing quote if it's already there */
  from: number;
  to: number;
  inString: boolean;
  /** the containing object's own simple string properties, before and after the cursor */
  siblings: Record<string, string>;
  /** keys already present in the containing object */
  present: string[];
  /** the container is an array (a union, symbols, …) */
  inArray: boolean;
  /** a key is being edited and its `:` is already there — insert just the key */
  hasColon: boolean;
}

/** Read a JSON string starting at i (text[i] === '"'); returns [value, endIndex (after closing quote) | -1 if unterminated]. */
function readString(text: string, i: number, end: number): [string, number] {
  let s = '', j = i + 1;
  while (j < end) {
    const ch = text[j];
    if (ch === '\\') { s += text[j + 1] ?? ''; j += 2; continue; }
    if (ch === '"') return [s, j + 1];
    s += ch; j++;
  }
  return [s, -1];
}

/** Where is `pos` in (possibly broken) JSON text? */
export function contextAt(text: string, pos: number): Ctx {
  const stack: Frame[] = [];
  const top = () => stack[stack.length - 1];
  let i = 0;
  let partial: { start: number; value: string; isString: boolean } | null = null;
  const valueDone = () => { const f = top(); if (f) { f.expect = 'comma'; } };
  while (i < pos) {
    const ch = text[i];
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') { i++; continue; }
    const f = top();
    if (ch === '"') {
      const [s, end] = readString(text, i, pos);
      if (end === -1) { partial = { start: i, value: s, isString: true }; break; }
      if (f && f.kind === 'obj' && (f.expect === 'key' || f.expect === 'comma')) { f.lastKey = s; f.expect = 'colon'; }
      else {
        if (f && f.kind === 'obj' && f.lastKey) f.seen[f.lastKey] = s;
        valueDone();
      }
      i = end; continue;
    }
    if (ch === '{' || ch === '[') {
      const key = f ? (f.kind === 'obj' ? f.lastKey : f.index) : null;
      stack.push({ kind: ch === '{' ? 'obj' : 'arr', key, lastKey: null, expect: ch === '{' ? 'key' : 'value', index: 0, seen: {} });
      i++; continue;
    }
    if (ch === '}' || ch === ']') { stack.pop(); valueDone(); i++; continue; }
    if (ch === ':') { if (f) f.expect = 'value'; i++; continue; }
    if (ch === ',') { if (f) { if (f.kind === 'obj') { f.expect = 'key'; } else { f.index++; f.expect = 'value'; } } i++; continue; }
    // a bare literal (number, true, null…), possibly half typed at the cursor
    let j = i; while (j < pos && /[^\s,:{}[\]"]/.test(text[j])) j++;
    if (j >= pos) { partial = { start: i, value: text.slice(i, pos), isString: false }; break; }
    valueDone(); i = j;
  }

  const f = top();
  const path = stack.slice(1).map(s => s.key as string | number);
  let where: Ctx['where'] = 'none';
  let key: string | null = null;
  if (f) {
    if (f.kind === 'obj') {
      if (f.expect === 'key' || (partial?.isString && f.expect === 'comma')) where = 'key';
      else if (f.expect === 'value') { where = 'value'; key = f.lastKey; }
      else if (f.expect === 'colon') where = 'none';
    } else if (f.expect === 'value') { where = 'value'; key = null; }
  }
  const from = partial ? partial.start : pos;
  let to = pos;
  if (partial?.isString) { // replace through the rest of the string being edited, closing quote included
    let j = pos; while (j < text.length && !'"\n:,{}[]'.includes(text[j])) j++;
    if (text[j] === '"') to = j + 1;
  } else if (partial) { let j = pos; while (j < text.length && /[^\s,:{}[\]"]/.test(text[j])) j++; to = j; }
  let k = to; while (k < text.length && (text[k] === ' ' || text[k] === '\t')) k++;
  const hasColon = text[k] === ':';
  // whole-object view for siblings: what's already there before and after the cursor
  const scanned = scanObject(text, stack, to);
  const siblings = scanned.siblings;
  // the key being edited doesn't count as "already present"
  const edited = partial?.isString && to > from + 1 && text[to - 1] === '"' ? text.slice(from + 1, to - 1) : partial?.value;
  const present = scanned.present.filter(k => k !== edited);
  return { where, key, path: f?.kind === 'obj' || f?.kind === 'arr' ? path : [], partial: partial?.value ?? '', from, to, inString: !!partial?.isString, siblings, present, inArray: f?.kind === 'arr', hasColon };
}

/** Keys and simple string values of the object containing the cursor (before + after). */
function scanObject(text: string, stack: Frame[], from: number): { siblings: Record<string, string>; present: string[] } {
  const f = stack[stack.length - 1];
  if (!f || f.kind !== 'obj') return { siblings: {}, present: [] };
  const siblings: Record<string, string> = { ...f.seen };
  const present = new Set<string>(keysBefore(text, from));
  // forward from the end of the token at the cursor to the object's closing brace, at depth 0
  let i = from, depth = 0, lastKey: string | null = null;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const [s, end] = readString(text, i, text.length); if (end === -1) break;
      if (depth === 0) {
        let k = end; while (k < text.length && /\s/.test(text[k])) k++;
        if (text[k] === ':') { lastKey = s; present.add(s); }
        else if (lastKey) { siblings[lastKey] = s; lastKey = null; }
      }
      i = end; continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { if (depth === 0) break; depth--; }
    else if (ch === ',' && depth === 0) lastKey = null;
    i++;
  }
  return { siblings, present: [...present] };
}
function keysBefore(text: string, pos: number): string[] {
  // walk backwards to the opening brace of the containing object, then forward collecting depth-0 keys
  let depth = 0, i = pos - 1, start = -1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '"') { // skip strings backwards
      let j = i - 1; while (j >= 0 && !(text[j] === '"' && text[j - 1] !== '\\')) j--; i = j - 1; continue;
    }
    if (ch === '}' || ch === ']') depth++;
    else if (ch === '{' || ch === '[') { if (depth === 0) { if (ch === '{') start = i; break; } depth--; }
    i--;
  }
  if (start < 0) return [];
  const keys: string[] = [];
  let j = start + 1, d = 0;
  while (j < pos) {
    const ch = text[j];
    if (ch === '"') {
      const [s, end] = readString(text, j, pos); if (end === -1) break;
      if (d === 0) { let k = end; while (k < pos && /\s/.test(text[k])) k++; if (text[k] === ':') keys.push(s); }
      j = end; continue;
    }
    if (ch === '{' || ch === '[') d++; else if (ch === '}' || ch === ']') d--;
    j++;
  }
  return keys;
}

// ---------- Avro vocabulary ----------

export const AVRO_PRIMITIVES = ['string', 'long', 'int', 'double', 'float', 'boolean', 'bytes', 'null'];
export const AVRO_COMPLEX = ['record', 'enum', 'array', 'map', 'fixed'];
export const AVRO_LOGICAL: Record<string, { base: string; doc: string }> = {
  'uuid': { base: 'string', doc: 'RFC 4122 UUID, stored as string' },
  'date': { base: 'int', doc: 'days since 1970-01-01' },
  'time-millis': { base: 'int', doc: 'milliseconds after midnight' },
  'time-micros': { base: 'long', doc: 'microseconds after midnight' },
  'timestamp-millis': { base: 'long', doc: 'UTC instant, ms since epoch' },
  'timestamp-micros': { base: 'long', doc: 'UTC instant, µs since epoch' },
  'local-timestamp-millis': { base: 'long', doc: 'wall-clock time, no zone' },
  'decimal': { base: 'bytes', doc: 'arbitrary precision; needs precision (and scale)' },
};
const TYPE_DOC: Record<string, string> = {
  string: 'UTF-8 text', long: '64-bit signed integer', int: '32-bit signed integer', double: '64-bit float', float: '32-bit float',
  boolean: 'true / false', bytes: 'raw bytes', null: 'no value (use in a union for optional fields)',
  record: 'named group of fields', enum: 'one of a fixed set of symbols', array: 'list of items', map: 'string keys → values', fixed: 'fixed-size bytes',
};
const KEY_DOC: Record<string, string> = {
  name: 'name of the record / field / enum', namespace: 'dotted package, e.g. com.example.payments', doc: 'documentation string',
  fields: 'the record’s fields', type: 'the Avro type', default: 'value used when the field is missing (must match the first union branch)',
  aliases: 'alternative names (for schema evolution)', order: 'sort order: ascending, descending or ignore', symbols: 'the enum’s allowed values',
  items: 'type of the array’s elements', values: 'type of the map’s values', size: 'number of bytes', logicalType: 'semantic type over a primitive',
  precision: 'total digits (decimal)', scale: 'digits after the point (decimal)',
};

export type Role = 'field' | 'record' | 'enum' | 'array' | 'map' | 'fixed' | 'logical' | 'type';
/** What kind of Avro object is the cursor's container? */
export function roleOf(ctx: Ctx): Role {
  const p = ctx.path;
  const last = p[p.length - 1], parent = p[p.length - 2];
  if (typeof last === 'number' && parent === 'fields') return 'field';
  const t = ctx.siblings.type;
  if (t === 'record' || t === 'enum' || t === 'array' || t === 'map' || t === 'fixed') return t;
  if (ctx.siblings.logicalType || (t && AVRO_PRIMITIVES.includes(t))) return 'logical';
  if (p.length === 0) return 'record';
  return 'type';
}

const KEYS_BY_ROLE: Record<Role, string[]> = {
  field: ['name', 'type', 'default', 'doc', 'aliases', 'order'],
  record: ['type', 'name', 'namespace', 'doc', 'fields', 'aliases'],
  enum: ['type', 'name', 'namespace', 'symbols', 'default', 'doc'],
  array: ['type', 'items', 'default'],
  map: ['type', 'values', 'default'],
  fixed: ['type', 'name', 'namespace', 'size'],
  logical: ['type', 'logicalType', 'precision', 'scale'],
  type: ['type', 'name', 'fields', 'items', 'values', 'symbols', 'logicalType'],
};

export interface Suggestion {
  label: string;
  /** text inserted in place of [from, to); `${}` marks where the cursor ends up */
  apply: string;
  detail?: string;
  info?: string;
  kind: 'property' | 'type' | 'keyword' | 'snippet' | 'value';
  boost?: number;
}

const KEY_TEMPLATES: Record<string, string> = {
  fields: '"fields": [\n  { "name": "${}", "type": "string" }\n]',
  symbols: '"symbols": ["${}"]',
  type: '"type": "${}"',
  name: '"name": "${}"',
  namespace: '"namespace": "${}"',
  doc: '"doc": "${}"',
  logicalType: '"logicalType": "${}"',
  items: '"items": "${}"',
  values: '"values": "${}"',
  default: '"default": ${}',
  order: '"order": "${}"',
  aliases: '"aliases": ["${}"]',
  size: '"size": ${}',
  precision: '"precision": ${}',
  scale: '"scale": ${}',
};

/** Named record/enum/fixed types defined anywhere in the schema (they can be referenced by name). */
export function namedTypes(text: string): string[] {
  const out = new Set<string>();
  const re = /"type"\s*:\s*"(record|enum|fixed)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // find the "name" in the same object: search a window around the match
    const start = text.lastIndexOf('{', m.index), end = text.indexOf('}', m.index);
    const win = text.slice(start, end === -1 ? undefined : end);
    const nm = /"name"\s*:\s*"([A-Za-z_][\w]*)"/.exec(win);
    if (nm) out.add(nm[1]);
  }
  return [...out];
}

const TYPE_SNIPPETS: Suggestion[] = [
  { label: 'nullable string', apply: '["null", "${string}"]', detail: 'union', info: 'optional field — remember "default": null', kind: 'snippet', boost: 2 },
  { label: 'uuid', apply: '{ "type": "string", "logicalType": "uuid" }', detail: 'logical', info: AVRO_LOGICAL.uuid.doc, kind: 'snippet', boost: 1 },
  { label: 'timestamp-millis', apply: '{ "type": "long", "logicalType": "timestamp-millis" }', detail: 'logical', info: AVRO_LOGICAL['timestamp-millis'].doc, kind: 'snippet', boost: 1 },
  { label: 'date', apply: '{ "type": "int", "logicalType": "date" }', detail: 'logical', info: AVRO_LOGICAL.date.doc, kind: 'snippet' },
  { label: 'decimal', apply: '{ "type": "bytes", "logicalType": "decimal", "precision": 18, "scale": 2 }', detail: 'logical', info: AVRO_LOGICAL.decimal.doc, kind: 'snippet' },
  { label: 'enum', apply: '{ "type": "enum", "name": "${Status}", "symbols": ["NEW", "DONE"] }', detail: 'complex', info: TYPE_DOC.enum, kind: 'snippet' },
  { label: 'array', apply: '{ "type": "array", "items": "${string}" }', detail: 'complex', info: TYPE_DOC.array, kind: 'snippet' },
  { label: 'map', apply: '{ "type": "map", "values": "${string}" }', detail: 'complex', info: TYPE_DOC.map, kind: 'snippet' },
  { label: 'record', apply: '{\n  "type": "record",\n  "name": "${Item}",\n  "fields": [\n    { "name": "id", "type": "string" }\n  ]\n}', detail: 'complex', info: TYPE_DOC.record, kind: 'snippet' },
];

/** Completions for Avro at the given context. */
export function avroSuggestions(text: string, ctx: Ctx): Suggestion[] {
  if (ctx.where === 'key') {
    const role = roleOf(ctx);
    const keys = KEYS_BY_ROLE[role].filter(k => !ctx.present.includes(k) || k === ctx.partial);
    return keys.map((k, i) => ({ label: k, apply: ctx.hasColon ? `"${k}"` : KEY_TEMPLATES[k] ?? `"${k}": \${}`, detail: role, info: KEY_DOC[k], kind: 'property' as const, boost: -i }));
  }
  if (ctx.where !== 'value') return [];
  const quote = (s: string) => `"${s}"`;
  const typeValues = (): Suggestion[] => {
    const named = namedTypes(text).map(n => ({ label: n, apply: quote(n), detail: 'named type', kind: 'type' as const }));
    const prims = AVRO_PRIMITIVES.filter(p => p !== 'null' || ctx.inArray).map((p, i) => ({ label: p, apply: quote(p), detail: 'primitive', info: TYPE_DOC[p], kind: 'type' as const, boost: 3 - i * 0.1 }));
    const complex = ctx.inString ? AVRO_COMPLEX.map(c => ({ label: c, apply: quote(c), detail: 'complex', info: TYPE_DOC[c], kind: 'keyword' as const })) : [];
    return [...prims, ...named, ...complex, ...(ctx.inString || ctx.inArray ? [] : TYPE_SNIPPETS)];
  };
  const key = ctx.key;
  if (key === 'type') {
    const role = roleOf(ctx);
    // the "type" of an object that is itself a type node: complex names first
    if (role !== 'field' && ctx.inString) return [...AVRO_COMPLEX.map((c, i) => ({ label: c, apply: quote(c), detail: 'complex', info: TYPE_DOC[c], kind: 'keyword' as const, boost: 5 - i })), ...typeValues()];
    return typeValues();
  }
  if (key === null && ctx.inArray && ctx.path[ctx.path.length - 1] === 'type') return typeValues(); // a union
  if (key === 'items' || key === 'values') return typeValues();
  if (key === 'logicalType') return Object.entries(AVRO_LOGICAL).map(([k, v]) => ({ label: k, apply: quote(k), detail: 'on ' + v.base, info: v.doc, kind: 'value' as const }));
  if (key === 'order') return ['ascending', 'descending', 'ignore'].map(k => ({ label: k, apply: quote(k), kind: 'value' as const }));
  if (key === 'default') return [{ label: 'null', apply: 'null', detail: 'for nullable fields', kind: 'value' }];
  return [];
}

// ---------- validation ----------

export interface Problem { message: string; severity: 'error' | 'warning'; /** text to locate (first match) */ at?: { name: string } }

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Avro-level problems in a schema that is already valid JSON. */
export function avroProblems(text: string): Problem[] {
  let root: unknown;
  try { root = JSON.parse(text); } catch { return []; } // JSON errors are reported by the JSON linter
  const out: Problem[] = [];
  const named = new Set(namedTypes(text));
  const checkType = (t: any, where: string, at?: { name: string }) => {
    if (typeof t === 'string') {
      if (!AVRO_PRIMITIVES.includes(t) && !named.has(t) && !t.includes('.')) {
        const near = [...AVRO_PRIMITIVES, ...named].find(p => p.startsWith(t.slice(0, 2)));
        out.push({ message: `Unknown type "${t}" in ${where}${near ? ` — did you mean "${near}"?` : ''}`, severity: 'error', at });
      }
      return;
    }
    if (Array.isArray(t)) {
      if (!t.length) out.push({ message: `Empty union in ${where}`, severity: 'error', at });
      t.forEach(x => checkType(x, where, at));
      return;
    }
    if (!t || typeof t !== 'object') { out.push({ message: `Missing or invalid type in ${where}`, severity: 'error', at }); return; }
    const o = t as Record<string, any>;
    switch (o.type) {
      case 'record': checkRecord(o); break;
      case 'enum':
        if (!o.name) out.push({ message: `Enum in ${where} needs a "name"`, severity: 'error', at });
        if (!Array.isArray(o.symbols) || !o.symbols.length) out.push({ message: `Enum in ${where} needs at least one symbol`, severity: 'error', at });
        else o.symbols.filter((s: unknown) => typeof s !== 'string' || !NAME_RE.test(s)).forEach((s: unknown) => out.push({ message: `Enum symbol ${JSON.stringify(s)} must be a plain name (letters, digits, _)`, severity: 'error', at }));
        break;
      case 'array': if (o.items === undefined) out.push({ message: `Array in ${where} needs "items"`, severity: 'error', at }); else checkType(o.items, where, at); break;
      case 'map': if (o.values === undefined) out.push({ message: `Map in ${where} needs "values"`, severity: 'error', at }); else checkType(o.values, where, at); break;
      case 'fixed': if (typeof o.size !== 'number') out.push({ message: `Fixed in ${where} needs a numeric "size"`, severity: 'error', at }); break;
      default:
        checkType(o.type, where, at);
        if (o.logicalType) {
          const l = AVRO_LOGICAL[o.logicalType];
          if (!l) out.push({ message: `Unknown logicalType "${o.logicalType}" in ${where} (it will be read as plain ${o.type})`, severity: 'warning', at });
          else if (l.base !== o.type && !(o.logicalType === 'decimal' && o.type === 'fixed')) out.push({ message: `logicalType "${o.logicalType}" goes on "${l.base}", not "${o.type}" (${where})`, severity: 'warning', at });
          if (o.logicalType === 'decimal' && typeof o.precision !== 'number') out.push({ message: `decimal in ${where} needs "precision"`, severity: 'error', at });
        }
    }
  };
  const checkRecord = (r: Record<string, any>) => {
    const rn = r.name ? `record ${r.name}` : 'record';
    if (!r.name) out.push({ message: 'Record needs a "name"', severity: 'error' });
    else if (!NAME_RE.test(r.name)) out.push({ message: `Record name "${r.name}" must be letters, digits and _`, severity: 'error' });
    if (!Array.isArray(r.fields)) { out.push({ message: `${rn} needs a "fields" array`, severity: 'error' }); return; }
    const seen = new Set<string>();
    r.fields.forEach((f: any, i: number) => {
      if (!f || typeof f !== 'object') { out.push({ message: `Field #${i + 1} of ${rn} is not an object`, severity: 'error' }); return; }
      const at = f.name ? { name: f.name } : undefined;
      if (!f.name) out.push({ message: `Field #${i + 1} of ${rn} needs a "name"`, severity: 'error' });
      else {
        if (!NAME_RE.test(f.name)) out.push({ message: `Field name "${f.name}" must be letters, digits and _`, severity: 'error', at });
        if (seen.has(f.name)) out.push({ message: `Duplicate field "${f.name}" in ${rn}`, severity: 'error', at });
        seen.add(f.name);
      }
      if (f.type === undefined) { out.push({ message: `Field "${f.name ?? '#' + (i + 1)}" needs a "type"`, severity: 'error', at }); return; }
      checkType(f.type, `field "${f.name ?? '#' + (i + 1)}"`, at);
      if (Array.isArray(f.type) && f.type.includes('null')) {
        if (!('default' in f)) out.push({ message: `"${f.name}" is nullable but has no default — add "default": null so old readers can skip it`, severity: 'warning', at });
        else if (f.default === null && f.type[0] !== 'null') out.push({ message: `A null default needs "null" first in the union for "${f.name}"`, severity: 'error', at });
      }
    });
  };
  if (root && typeof root === 'object' && !Array.isArray(root)) {
    const r = root as Record<string, any>;
    if (r.type === 'record') checkRecord(r);
    else checkType(r, 'schema');
  } else if (typeof root === 'string' || Array.isArray(root)) checkType(root, 'schema');
  else out.push({ message: 'An Avro schema is a JSON object (usually a record), a type name or a union', severity: 'error' });
  return out;
}

/** Where to underline a problem: the field's `"name": "x"` if we can find it, else the first line. */
export function problemRange(text: string, p: Problem): [number, number] {
  if (p.at?.name) {
    const re = new RegExp(`"name"\\s*:\\s*"${p.at.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
    const m = re.exec(text);
    if (m) return [m.index, m.index + m[0].length];
  }
  const nl = text.indexOf('\n');
  return [0, nl === -1 ? text.length : nl];
}
