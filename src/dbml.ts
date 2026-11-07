/**
 * Tables as text — a DBML-style format (the one dbdiagram.io uses), tuned for how people sketch:
 *
 *   Table payments {
 *     id            uuid          [pk, default: `gen_random_uuid()`]
 *     merchant_id   uuid          [index, ref: > merchants.id]
 *     captured_at   timestamptz?                      ← "?" = nullable; columns are NOT NULL otherwise
 *   }
 *
 * Also reads real DBML (`[not null]` / `[null]`, `note:`, `increment`) and `CREATE TABLE` SQL.
 * Pure functions: the editor, the paste converter and the tests share them.
 */
import type { Column, Table } from './model';

export interface DbmlError { line: number; message: string; from?: number; to?: number }
export interface Parsed { tables: Table[]; errors: DbmlError[] }

/** Other databases' names → ids, so `ref: > other-db.table.col` can be stored as `nodeId:table.col`. */
export interface RefResolver { nameToId: (name: string) => string | null; idToName: (id: string) => string | null }
const noResolver: RefResolver = { nameToId: () => null, idToName: () => null };

const IDENT = /^[A-Za-z_][\w$]*$/;
const fmtDefault = (d: string) => /^'.*'$/.test(d) || /^-?\d+(\.\d+)?$/.test(d) || /^(true|false|null)$/i.test(d) ? d : '`' + d + '`';

export function columnFlags(c: Column, r: RefResolver = noResolver): string[] {
  const f: string[] = [];
  if (c.pk) f.push('pk');
  if (c.unique) f.push('unique');
  if (c.index) f.push('index');
  if (c.default) f.push('default: ' + fmtDefault(c.default));
  if (c.references) {
    const m = /^([^:]+):(.+)$/.exec(c.references);
    f.push('ref: > ' + (m ? `${r.idToName(m[1]) ?? m[1]}.${m[2]}` : c.references));
  }
  return f;
}

/** Model → text, columns aligned. */
export function toDbml(tables: Table[], r: RefResolver = noResolver): string {
  return tables.map(t => {
    const cols = t.columns || [];
    const nw = Math.max(0, ...cols.map(c => c.name.length));
    const tw = Math.max(0, ...cols.map(c => c.type.length + (c.nullable && !c.pk ? 1 : 0)));
    const lines = cols.map(c => {
      const type = c.type + (c.nullable && !c.pk ? '?' : '');
      const flags = columnFlags(c, r);
      return ('  ' + c.name.padEnd(nw) + '  ' + (flags.length ? type.padEnd(tw) + '  [' + flags.join(', ') + ']' : type)).trimEnd();
    });
    return `Table ${t.name} {\n${lines.join('\n')}${lines.length ? '\n' : ''}}`;
  }).join('\n\n') + (tables.length ? '\n' : '');
}

/** Split a flag list on commas that aren't inside quotes/backticks/parentheses. */
function splitFlags(s: string): string[] {
  const out: string[] = []; let cur = '', q = '', depth = 0;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * One column line: `name type[?] [flags]`. Returns null + message when it doesn't read as a column.
 * `dbmlNulls`: the table uses DBML's own rule (nullable unless `not null`).
 */
export function parseColumn(line: string, r: RefResolver = noResolver, dbmlNulls = false): { col: Column; error?: undefined } | { col?: undefined; error: string } {
  let s = line.trim().replace(/\/\/.*$/, '').trim();
  let flagsText = '';
  const b = s.indexOf('[');
  if (b !== -1) {
    if (!s.endsWith(']')) return { error: 'Missing ] at the end of the flags' };
    flagsText = s.slice(b + 1, -1); s = s.slice(0, b).trim();
  }
  const m = /^("?)([A-Za-z_][\w$]*)\1\s+(.+)$/.exec(s);
  if (!m) return { error: s && IDENT.test(s) ? `Column "${s}" needs a type, e.g. "${s} text"` : 'Expected a column: name type [flags]' };
  let type = m[3].trim(), nullable = dbmlNulls;
  if (type.endsWith('?')) { nullable = true; type = type.slice(0, -1).trim(); }
  if (!type) return { error: `Column "${m[2]}" needs a type` };
  const col: Column = { name: m[2], type, pk: false, nullable };
  for (const f of splitFlags(flagsText)) {
    const lower = f.toLowerCase();
    if (lower === 'pk' || lower === 'primary key') { col.pk = true; col.nullable = false; }
    else if (lower === 'unique') col.unique = true;
    else if (lower === 'index' || lower === 'indexed') col.index = true;
    else if (lower === 'not null') col.nullable = false;
    else if (lower === 'null') col.nullable = true;
    else if (lower === 'increment') { if (!col.default) col.default = 'generated'; }
    else if (lower.startsWith('note:')) { /* notes aren't stored (yet) */ }
    else if (lower.startsWith('default:')) {
      let d = f.slice(8).trim();
      if (/^`.*`$/.test(d)) d = d.slice(1, -1);
      else if (/^".*"$/.test(d)) d = "'" + d.slice(1, -1) + "'";
      if (!d) return { error: 'default: needs a value' };
      col.default = d;
    }
    else if (lower.startsWith('ref:')) {
      const target = f.slice(4).trim().replace(/^[<>-]\s*/, '').trim();
      const parts = target.split('.');
      if (parts.length === 2 && parts.every(p => IDENT.test(p))) col.references = target;
      else if (parts.length === 3) {
        const id = r.nameToId(parts[0]);
        if (!id) return { error: `Unknown database "${parts[0]}" in ref` };
        col.references = `${id}:${parts[1]}.${parts[2]}`;
      } else return { error: 'ref: > table.column (or other-db.table.column)' };
    }
    else return { error: `Unknown flag "${f}" — try pk, unique, index, not null, default: …, ref: > table.column` };
  }
  return { col };
}

/** Text → model. Keeps going after errors so every problem is reported at once. */
export function parseDbml(text: string, r: RefResolver = noResolver): Parsed {
  if (/^\s*create\s+table/im.test(text) && !/^\s*table\s/im.test(text)) return parseSql(text);
  const tables: Table[] = [], errors: DbmlError[] = [];
  const lines = text.split('\n');
  let cur: Table | null = null as Table | null, curStart = 0, dbmlNulls = false, skipBlock = false, inner = false;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) return;
    if (!cur) {
      const m = /^table\s+("?)([A-Za-z_][\w$.]*)\1\s*(\{)?\s*$/i.exec(line);
      if (m) {
        cur = { name: m[2].replace(/^public\./, ''), columns: [] }; curStart = i;
        if (!m[3]) errors.push({ line: i, message: 'Expected { after the table name' });
        // a table written in DBML's own style (`not null` somewhere) keeps DBML's nullable-by-default rule
        let j = i + 1, body = '';
        while (j < lines.length && !/^\s*}/.test(lines[j])) body += lines[j++] + '\n';
        dbmlNulls = /\bnot null\b/i.test(body);
        return;
      }
      if (/^(ref|enum|project|tablegroup|note|indexes)\b/i.test(line)) { skipBlock = /\{\s*$/.test(line); return; }
      if (skipBlock) { if (line === '}') skipBlock = false; return; }
      errors.push({ line: i, message: 'Expected "Table name {"' });
      return;
    }
    if (line === '}') { tables.push(cur); cur = null; return; }
    if (/^indexes\s*\{/i.test(line) || /^note\s*:/i.test(line)) { if (/\{\s*$/.test(line)) inner = true; return; }
    if (inner) { if (line === '}') inner = false; return; }
    const res = parseColumn(line, r, dbmlNulls);
    if (!res.col) { errors.push({ line: i, message: res.error ?? 'Not a column' }); return; }
    const c = cur as Table, col = res.col;
    if (c.columns.some(x => x.name === col.name)) errors.push({ line: i, message: `Duplicate column "${col.name}" in ${c.name}` });
    else c.columns.push(col);
  });
  if (cur) errors.push({ line: curStart, message: `Table ${(cur as Table).name} is missing its closing }` });
  const names = new Set<string>();
  for (const t of tables) { if (names.has(t.name)) errors.push({ line: 0, message: `Two tables are called "${t.name}"` }); names.add(t.name); }
  // same-database refs must point at something real
  lines.forEach((raw, i) => {
    const m = /ref:\s*[<>-]?\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*[,\]]/.exec(raw);
    if (!m) return;
    const t = tables.find(x => x.name === m[1]);
    if (!t) errors.push({ line: i, message: `ref: no table "${m[1]}" in this database` });
    else if (!t.columns.some(c => c.name === m[2])) errors.push({ line: i, message: `ref: ${m[1]} has no column "${m[2]}"` });
  });
  return { tables, errors };
}

// ---------- CREATE TABLE ----------

const CONSTRAINT_WORDS = /\b(not\s+null|null|primary\s+key|unique|default|references|check|constraint|generated|collate)\b/i;
const unq = (s: string) => s.trim().replace(/^"(.*)"$/, '$1').replace(/^`(.*)`$/, '$1').replace(/^\w+\./, '').replace(/^"(.*)"$/, '$1');

/** Split on commas at paren depth 0. */
function splitTop(s: string): string[] {
  const out: string[] = []; let cur = '', depth = 0, q = '';
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function parseSql(sql: string): Parsed {
  const tables: Table[] = [], errors: DbmlError[] = [];
  const clean = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."`]+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    // find the matching close paren
    let i = re.lastIndex, depth = 1;
    while (i < clean.length && depth) { if (clean[i] === '(') depth++; else if (clean[i] === ')') depth--; i++; }
    const body = clean.slice(re.lastIndex, i - 1);
    const t: Table = { name: unq(m[1]), columns: [] };
    const tableLevel: string[] = [];
    for (const part of splitTop(body)) {
      const p = part.trim().replace(/\s+/g, ' ');
      if (!p) continue;
      if (/^(constraint\s+\S+\s+)?(primary\s+key|unique|foreign\s+key|check|exclude)\b/i.test(p)) { tableLevel.push(p); continue; }
      const nm = /^("[^"]+"|[\w$]+)\s+(.*)$/.exec(p);
      if (!nm) continue;
      const rest = nm[2];
      const k = rest.search(CONSTRAINT_WORDS);
      const type = (k === -1 ? rest : rest.slice(0, k)).trim().toLowerCase()
        .replace(/^character varying/, 'varchar').replace(/^timestamp with time zone/, 'timestamptz').replace(/^timestamp without time zone/, 'timestamp');
      const cons = k === -1 ? '' : rest.slice(k);
      const col: Column = { name: unq(nm[1]), type, pk: /primary\s+key/i.test(cons), nullable: !/not\s+null/i.test(cons) && !/primary\s+key/i.test(cons) };
      if (/\bunique\b/i.test(cons)) col.unique = true;
      const d = /default\s+((?:'[^']*'|\([^)]*\)|[^\s,]+(?:\([^)]*\))?))/i.exec(cons);
      if (d) col.default = d[1];
      const ref = /references\s+([\w."]+)\s*\(\s*([\w"]+)\s*\)/i.exec(cons);
      if (ref) col.references = `${unq(ref[1])}.${unq(ref[2])}`;
      if (/serial/i.test(type)) { col.default = col.default ?? 'generated'; }
      t.columns.push(col);
    }
    for (const c of tableLevel) {
      const cols = (s: string) => s.split(',').map(unq);
      const pk = /primary\s+key\s*\(([^)]*)\)/i.exec(c);
      if (pk) cols(pk[1]).forEach(n => { const col = t.columns.find(x => x.name === n); if (col) { col.pk = true; col.nullable = false; } });
      const uq = /^(?:constraint\s+\S+\s+)?unique\s*\(([^)]*)\)/i.exec(c);
      if (uq) { const names = cols(uq[1]); if (names.length === 1) { const col = t.columns.find(x => x.name === names[0]); if (col) col.unique = true; } }
      const fk = /foreign\s+key\s*\(([^)]*)\)\s*references\s+([\w."]+)\s*\(([^)]*)\)/i.exec(c);
      if (fk) { const a = cols(fk[1]), b = cols(fk[3]); a.forEach((n, j) => { const col = t.columns.find(x => x.name === n); if (col && b[j]) col.references = `${unq(fk[2])}.${b[j]}`; }); }
    }
    tables.push(t);
  }
  // CREATE INDEX … ON t (col)
  const ix = /create\s+(unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?[\w"]*\s*on\s+([\w."]+)\s*(?:using\s+\w+\s*)?\(([^)]*)\)/gi;
  while ((m = ix.exec(clean))) {
    const t = tables.find(x => x.name === unq(m![2])); if (!t) continue;
    const names = m[3].split(',').map(s => unq(s.trim().split(/\s+/)[0]));
    const col = t.columns.find(x => x.name === names[0]);
    if (col) { if (m[1] && names.length === 1) col.unique = true; else col.index = true; }
  }
  if (!tables.length) errors.push({ line: 0, message: 'No CREATE TABLE statements found' });
  return { tables, errors };
}

/** The add-column line in the rows view: "refunded_at timestamptz?" or "x int [unique]". */
export function quickColumn(text: string, r: RefResolver = noResolver) { return parseColumn(text, r, false); }

export const PG_TYPE_LIST = ['uuid', 'text', 'varchar(255)', 'char(3)', 'integer', 'bigint', 'smallint', 'numeric(18,2)', 'real', 'double precision', 'boolean',
  'timestamptz', 'timestamp', 'date', 'time', 'interval', 'jsonb', 'json', 'bytea', 'inet', 'text[]', 'serial', 'bigserial'];
export const FLAG_LIST: { label: string; apply: string; info: string }[] = [
  { label: 'pk', apply: 'pk', info: 'primary key (implies not null)' },
  { label: 'unique', apply: 'unique', info: 'no two rows share this value' },
  { label: 'index', apply: 'index', info: 'b-tree index for lookups' },
  { label: 'ref: >', apply: 'ref: > ', info: 'foreign key: many-to-one' },
  { label: 'default:', apply: 'default: ', info: 'value when none is given — `now()`, \'text\', 0' },
  { label: 'not null', apply: 'not null', info: 'DBML style; here columns are not null unless the type ends in ?' },
];
