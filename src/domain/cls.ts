/**
 * Class diagrams: model, text format, imports (Java, Kotlin, Mermaid), generators (database tables,
 * Avro schemas), box sizing and auto-layout. Pure — no DOM — so it's unit-tested.
 *
 * Classes are identified by name (names are unique in a diagram, as in code), so relations and
 * positions refer to names. Text format:
 *
 *   class PaymentUpload <<aggregate root>> {
 *     - id: UUID
 *     + submit(): void
 *   }
 *   interface CardRef { + id(): String }
 *   enum UploadStatus { RECEIVED, PROCESSING, DONE }
 *   record Money { amountMinor: long; currency: Currency }
 *   PaymentUpload "1" *-- "1..*" UploadItem : items      composition (whole *-- part)
 *   Basket o-- Item                                      aggregation
 *   UploadItem --> CardRef : card                        association
 *   VirtualCard ..|> CardRef                             implements
 *   Refund --|> Payment                                  extends
 *   Service ..> Clock                                    depends on
 */
import { itemNotes, type CanvasNote } from './notes';
import type { Table } from './model';

export type ClassKind = 'class' | 'abstract' | 'interface' | 'enum' | 'record';
export const CLASS_KINDS: ClassKind[] = ['class', 'abstract', 'interface', 'enum', 'record'];
export type Vis = '+' | '-' | '#' | '~' | '';
export interface Member { vis: Vis; name: string; type: string; /** present on methods: the parameter list as written */ params?: string; static?: boolean; abstract?: boolean }
export interface ClassBox { name: string; kind: ClassKind; stereo?: string; fields: Member[]; methods: Member[]; notes?: string }
export type RelType = 'inherit' | 'implement' | 'composition' | 'aggregation' | 'assoc' | 'depend';
export const REL_TYPES: RelType[] = ['composition', 'aggregation', 'assoc', 'inherit', 'implement', 'depend'];
export interface Relation { id: string; from: string; to: string; type: RelType; label?: string; fromMult?: string; toMult?: string; notes?: string }
export interface ClassDoc { classes: ClassBox[]; relations: Relation[]; pos: Record<string, { x: number; y: number }>; notes?: CanvasNote[] }
export interface ClsError { line: number; message: string }

export const blankCls = (): ClassDoc => ({ classes: [], relations: [], pos: {} });
const OP: Record<RelType, string> = { inherit: '--|>', implement: '..|>', composition: '*--', aggregation: 'o--', assoc: '-->', depend: '..>' };
export const REL_LABEL: Record<RelType, string> = { composition: 'has (owns)', aggregation: 'has', assoc: 'uses', inherit: 'extends', implement: 'implements', depend: 'depends on' };
const NAME_RE = /^[A-Za-z_$][\w$]*$/;
let seq = 0;
export const relId = () => 'k' + Date.now().toString(36).slice(-4) + (seq++).toString(36);
export const isMethod = (m: Member) => m.params !== undefined;

// ---------- members ----------

/** One member as text: `- id: UUID`, `+ submit(): void`, `+ {static} of(x: int): Money`. */
export function memberText(m: Member, enumConst = false): string {
  if (enumConst) return m.name;
  const mods = (m.static ? '{static} ' : '') + (m.abstract ? '{abstract} ' : '');
  const head = `${m.vis ? m.vis + ' ' : ''}${mods}${m.name}`;
  return isMethod(m) ? `${head}(${m.params})${m.type ? ': ' + m.type : ''}` : `${head}${m.type ? ': ' + m.type : ''}`;
}
/** Parse one member line; null if it isn't one. */
export function parseMember(line: string): Member | null {
  let s = line.trim().replace(/[;,]$/, '').trim();
  if (!s) return null;
  let vis: Vis = '';
  const v = /^([+\-#~])\s*/.exec(s); if (v) { vis = v[1] as Vis; s = s.slice(v[0].length); }
  let isStatic = false, isAbstract = false;
  for (;;) {
    const m = /^\{(static|abstract)\}\s*|^(static|abstract)\s+/.exec(s); if (!m) break;
    if ((m[1] ?? m[2]) === 'static') isStatic = true; else isAbstract = true;
    s = s.slice(m[0].length);
  }
  const meth = /^([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*(.+))?$/.exec(s);
  if (meth) return { vis, name: meth[1], params: meth[2].trim(), type: (meth[3] ?? '').trim(), ...(isStatic ? { static: true } : {}), ...(isAbstract ? { abstract: true } : {}) };
  const fld = /^([A-Za-z_$][\w$]*)\s*(?::\s*(.+))?$/.exec(s);
  if (fld) return { vis, name: fld[1], type: (fld[2] ?? '').trim(), ...(isStatic ? { static: true } : {}) };
  return null;
}

// ---------- text ----------

export function printCls(d: ClassDoc): string {
  const out: string[] = [];
  for (const c of d.classes) {
    const kw = c.kind === 'abstract' ? 'abstract class' : c.kind;
    const head = `${kw} ${c.name}${c.stereo ? ` <<${c.stereo}>>` : ''}`;
    const members = c.kind === 'enum' ? c.fields.map(f => f.name) : [...c.fields, ...c.methods].map(m => memberText(m));
    if (!members.length) { out.push(head); continue; }
    if (c.kind === 'enum') { out.push(`${head} { ${members.join(', ')} }`); continue; }
    out.push(head + ' {', ...members.map(m => '  ' + m), '}');
  }
  if (d.relations.length && out.length) out.push('');
  for (const r of d.relations) {
    out.push(`${r.from}${r.fromMult ? ` "${r.fromMult}"` : ''} ${OP[r.type]}${r.toMult ? ` "${r.toMult}"` : ''} ${r.to}${r.label ? ' : ' + r.label : ''}`);
  }
  return out.join('\n') + (out.length ? '\n' : '');
}

const REL_RE = /^([A-Za-z_$][\w$]*)\s*(?:"([^"]*)"\s*)?(<\|--|<\|\.\.|--\|>|\.\.\|>|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.|--|\.\.)\s*(?:"([^"]*)"\s*)?([A-Za-z_$][\w$]*)\s*(?::\s*(.*))?$/;
/** Normalise any arrow (either direction) to {from, to, type}. */
function relFrom(a: string, op: string, b: string): { from: string; to: string; type: RelType } {
  switch (op) {
    case '--|>': return { from: a, to: b, type: 'inherit' };
    case '<|--': return { from: b, to: a, type: 'inherit' };
    case '..|>': return { from: a, to: b, type: 'implement' };
    case '<|..': return { from: b, to: a, type: 'implement' };
    case '*--': return { from: a, to: b, type: 'composition' };
    case '--*': return { from: b, to: a, type: 'composition' };
    case 'o--': return { from: a, to: b, type: 'aggregation' };
    case '--o': return { from: b, to: a, type: 'aggregation' };
    case '<--': return { from: b, to: a, type: 'assoc' };
    case '..>': return { from: a, to: b, type: 'depend' };
    case '<..': return { from: b, to: a, type: 'depend' };
    case '..': return { from: a, to: b, type: 'depend' };
    default: return { from: a, to: b, type: 'assoc' };
  }
}

interface B { d: ClassDoc; errors: ClsError[] }
function ensureClass(b: B, name: string, kind: ClassKind = 'class'): ClassBox {
  let c = b.d.classes.find(x => x.name === name);
  if (!c) { c = { name, kind, fields: [], methods: [] }; b.d.classes.push(c); }
  return c;
}
function addMembers(c: ClassBox, parts: string[], line: number, errors: ClsError[]) {
  for (const p of parts) {
    const t = p.trim(); if (!t) continue;
    if (c.kind === 'enum') {
      for (const k of t.split(',').map(x => x.trim()).filter(Boolean)) { const n = /^([A-Za-z_$][\w$]*)/.exec(k); if (n) c.fields.push({ vis: '', name: n[1], type: '' }); }
      continue;
    }
    const m = parseMember(t);
    if (!m) { errors.push({ line, message: `Not a member: "${t}". Try  - name: Type  or  + method(arg: Type): Result` }); continue; }
    (isMethod(m) ? c.methods : c.fields).push(m);
  }
}

/** Parse any supported text: this app's format, Mermaid (classDiagram), or Java / Kotlin source. */
export function parseClsAny(text: string): { doc: ClassDoc; errors: ClsError[]; from: 'cistem' | 'mermaid' | 'code' } {
  const first = text.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('%%') && !l.startsWith('//') && !l.startsWith('#'));
  if (first && /^classDiagram\b/.test(first)) return { ...parseMermaidCls(text), from: 'mermaid' };
  if (looksLikeCode(text)) return { doc: parseJavaKotlin(text), errors: [], from: 'code' };
  return { ...parseCls(text), from: 'cistem' };
}
/** Java/Kotlin source has packages, imports, access modifiers before types, semicolons or `val`/`fun`. */
export function looksLikeCode(text: string): boolean {
  return /^\s*(package|import)\s+[\w.]+/m.test(text)
    || /\b(public|private|protected|data|sealed|open)\s+(abstract\s+|final\s+|static\s+)*(class|interface|enum|record)\s+\w+/.test(text)
    || /\bclass\s+\w+\s*\((\s*(val|var)\s)/.test(text)
    || /\brecord\s+\w+\s*\(/.test(text)
    || (/\b(class|interface|enum)\s+\w+[^{\n]*\{[^}]*;/.test(text) && !/<<|--|\.\./.test(text));
}

export function parseCls(text: string): { doc: ClassDoc; errors: ClsError[] } {
  const b: B = { d: blankCls(), errors: [] };
  const lines = text.split('\n');
  let open: { c: ClassBox; line: number } | null = null;
  lines.forEach((raw, line) => {
    const l = raw.replace(/\s+(%%|\/\/).*$/, '').trim();
    if (!l || l.startsWith('%%') || l.startsWith('//') || l.startsWith('#')) return;
    if (open) {
      if (l === '}') { open = null; return; }
      const closes = l.endsWith('}');
      addMembers(open.c, (closes ? l.slice(0, -1) : l).split(';'), line, b.errors);
      if (closes) open = null;
      return;
    }
    const decl = /^(abstract\s+class|class|interface|enum|record)\s+([A-Za-z_$][\w$]*)(?:\s*<<\s*([^>]*)>>)?\s*(\{(.*))?$/.exec(l);
    if (decl) {
      const kind: ClassKind = decl[1].startsWith('abstract') ? 'abstract' : decl[1] as ClassKind;
      if (b.d.classes.some(c => c.name === decl[2] && (c.fields.length || c.methods.length || c.kind !== 'class'))) { b.errors.push({ line, message: `"${decl[2]}" is declared twice` }); return; }
      const c = ensureClass(b, decl[2], kind); c.kind = kind;
      if (decl[3]) c.stereo = decl[3].trim();
      if (decl[4] !== undefined) {
        const rest = decl[5] ?? '';
        if (rest.trim().endsWith('}')) addMembers(c, rest.trim().slice(0, -1).split(';'), line, b.errors);
        else { if (rest.trim()) addMembers(c, rest.split(';'), line, b.errors); open = { c, line }; }
      }
      return;
    }
    const r = REL_RE.exec(l);
    if (r) {
      const [, a, m1, op, m2, z, label] = r;
      const rel = relFrom(a, op, z);
      const mult = op.startsWith('<') || op === '--*' || op === '--o' ? { fromMult: m2, toMult: m1 } : { fromMult: m1, toMult: m2 };
      ensureClass(b, a); ensureClass(b, z);
      b.d.relations.push({ id: relId(), ...rel, ...(label?.trim() ? { label: label.trim() } : {}), ...(mult.fromMult ? { fromMult: mult.fromMult } : {}), ...(mult.toMult ? { toMult: mult.toMult } : {}) });
      return;
    }
    b.errors.push({ line, message: 'Not understood. Try  class Name { - field: Type },  A --> B : label,  A --|> B' });
  });
  if (open) b.errors.push({ line: (open as { line: number }).line, message: `"${(open as { c: ClassBox }).c.name}" is missing its closing }` });
  return { doc: b.d, errors: b.errors.sort((x, y) => x.line - y.line) };
}

// ---------- Mermaid classDiagram ----------

function mermaidMember(s: string): Member | null {
  s = s.trim().replace(/[;,]$/, '');
  if (!s) return null;
  let vis: Vis = ''; const v = /^([+\-#~])/.exec(s); if (v) { vis = v[1] as Vis; s = s.slice(1).trim(); }
  const isStatic = /\$$|\)\$/.test(s), isAbstract = /\*$|\)\*/.test(s); s = s.replace(/[$*]$/, '').trim();
  const meth = /^([A-Za-z_$][\w$]*)\(([^)]*)\)\s*[$*]?\s*(.*)$/.exec(s);
  if (meth) return { vis, name: meth[1], params: meth[2].trim(), type: meth[3].replace(/^:\s*/, '').trim(), ...(isStatic ? { static: true } : {}), ...(isAbstract ? { abstract: true } : {}) };
  const colon = /^([A-Za-z_$][\w$]*)\s*:\s*(.+)$/.exec(s); if (colon) return { vis, name: colon[1], type: colon[2].trim() };
  const typed = /^(.+?)\s+([A-Za-z_$][\w$]*)$/.exec(s); if (typed) return { vis, name: typed[2], type: typed[1].replace(/~/g, m => m === '~' ? '<' : m).replace(/<([^<]*)$/, '<$1>').trim(), ...(isStatic ? { static: true } : {}) };
  if (NAME_RE.test(s)) return { vis, name: s, type: '' };
  return null;
}
export function parseMermaidCls(text: string): { doc: ClassDoc; errors: ClsError[] } {
  const b: B = { d: blankCls(), errors: [] };
  let open: ClassBox | null = null;
  const kindFrom = (st: string): ClassKind | null => { const s = st.toLowerCase(); return s === 'interface' ? 'interface' : s === 'enumeration' || s === 'enum' ? 'enum' : s === 'abstract' ? 'abstract' : s === 'record' ? 'record' : null; };
  const put = (c: ClassBox, raw: string) => {
    const st = /^<<\s*(.+?)\s*>>$/.exec(raw.trim());
    if (st) { const k = kindFrom(st[1]); if (k) c.kind = k; else c.stereo = st[1]; return; }
    if (c.kind === 'enum') { const n = /^([A-Za-z_$][\w$]*)/.exec(raw.trim()); if (n) c.fields.push({ vis: '', name: n[1], type: '' }); return; }
    const m = mermaidMember(raw); if (m) (isMethod(m) ? c.methods : c.fields).push(m);
  };
  text.split('\n').forEach((raw, line) => {
    let l = raw.replace(/%%.*$/, '').trim();
    if (!l || /^classDiagram\b/.test(l) || /^(direction|note|link|click|callback|style|classDef|cssClass|namespace|title)\b/.test(l)) return;
    if (open) { if (l === '}') { open = null; return; } put(open, l); return; }
    let m: RegExpExecArray | null;
    l = l.replace(/`([^`]+)`/g, (_m, n: string) => n.replace(/[^\w$]/g, ''));   // `Weird Name` → WeirdName
    if ((m = /^class\s+([A-Za-z_$][\w$]*)(?:~[^~]*~)?(?:\s*\[[^\]]*\])?(?:\s*:::\w+)?\s*(\{)?\s*(?:<<\s*(.+?)\s*>>)?\s*$/.exec(l))) {
      const c = ensureClass(b, m[1]);
      if (m[3]) { const k = kindFrom(m[3]); if (k) c.kind = k; else c.stereo = m[3]; }
      if (m[2]) open = c;
      return;
    }
    if ((m = /^<<\s*(.+?)\s*>>\s+([A-Za-z_$][\w$]*)$/.exec(l))) { const c = ensureClass(b, m[2]); const k = kindFrom(m[1]); if (k) c.kind = k; else c.stereo = m[1]; return; }
    if ((m = /^([A-Za-z_$][\w$]*)\s*:\s*(.+)$/.exec(l)) && !REL_RE.test(l)) { put(ensureClass(b, m[1]), m[2]); return; }
    const r = REL_RE.exec(l);
    if (r) {
      const [, a, m1, op, m2, z, label] = r;
      const rel = relFrom(a, op, z);
      const mult = op.startsWith('<') || op === '--*' || op === '--o' ? { fromMult: m2, toMult: m1 } : { fromMult: m1, toMult: m2 };
      ensureClass(b, a); ensureClass(b, z);
      b.d.relations.push({ id: relId(), ...rel, ...(label?.trim() ? { label: label.trim() } : {}), ...(mult.fromMult ? { fromMult: mult.fromMult } : {}), ...(mult.toMult ? { toMult: mult.toMult } : {}) });
      return;
    }
    b.errors.push({ line, message: 'Mermaid line not understood' });
  });
  return { doc: b.d, errors: b.errors };
}

// ---------- Java / Kotlin source ----------

function stripCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)'/g, "''")
    .replace(/@[\w.]+(\s*\((?:[^()]|\([^()]*\))*\))?/g, ' ');
}
/** Split on `sep` at nesting depth 0 (ignoring (), <>, [], {}). */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = []; let depth = 0, cur = '';
  for (const ch of s) {
    if ('(<[{'.includes(ch)) depth++;
    else if (')>]}'.includes(ch)) depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
const visOf = (mods: string, kotlin: boolean): Vis => /\bprivate\b/.test(mods) ? '-' : /\bprotected\b/.test(mods) ? '#' : /\bpublic\b/.test(mods) ? '+' : /\binternal\b/.test(mods) ? '~' : kotlin ? '+' : '~';
const MODS = '(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|value|inner|override|synchronized|native|transient|volatile|default|strictfp|lateinit|const|suspend|inline|enum|annotation|non-sealed)\\s+)*';
/** Normalise a type's spacing: `Map< String ,List<X> >` → `Map<String, List<X>>`, keeping `? extends T` and `T?`. */
const typeName = (t: string) => t.trim().replace(/\s+/g, ' ').replace(/\s*([<>,])\s*/g, (_m, c) => (c === ',' ? ', ' : c)).replace(/\s+\?(?=$|[>,])/g, '?').replace(/<\?(?=\w)/g, '<? ');

/** Read classes, interfaces, enums and records (and Kotlin data classes) with their members and relations. */
export function parseJavaKotlin(src: string): ClassDoc {
  const d = blankCls();
  const s = stripCode(src);
  const kotlin = /\bfun\s+\w|\b(val|var)\s+\w+\s*:/.test(s) || /\bclass\s+\w+[^{\n]*\)\s*:/.test(s);
  const declRe = new RegExp(`(${MODS})(class|interface|enum\\s+class|enum|record|object)\\s+([A-Za-z_$][\\w$]*)\\s*(<[^{(]*?>)?\\s*`, 'g');
  const pending: { from: string; to: string; type: RelType; label?: string; toMult?: string }[] = [];
  let m: RegExpExecArray | null;
  const consumed: [number, number][] = [];
  while ((m = declRe.exec(s))) {
    if (consumed.some(([a, b]) => m!.index > a && m!.index < b)) continue;   // nested types are read on their own pass below
    const mods = m[1], kwRaw = m[2].replace(/\s+/g, ' '), name = m[3];
    let i = declRe.lastIndex;
    // primary constructor / record components
    let ctor = '';
    if (s[i] === '(') { let depth = 0, j = i; for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')' && --depth === 0) break; } ctor = s.slice(i + 1, j); i = j + 1; }
    // header up to the body (or end of statement)
    let j = i; while (j < s.length && s[j] !== '{' && s[j] !== ';' && !(s[j] === '\n' && kotlin && !/[:,]\s*$/.test(s.slice(i, j)) && s.slice(i, j).trim() && !/^\s*(:|extends|implements|where)/.test(s.slice(j + 1)))) j++;
    const header = s.slice(i, j);
    let body = '';
    if (s[j] === '{') { let depth = 0, k = j; for (; k < s.length; k++) { if (s[k] === '{') depth++; else if (s[k] === '}' && --depth === 0) break; } body = s.slice(j + 1, k); consumed.push([j, k]); }
    const kind: ClassKind = kwRaw.startsWith('enum') || /\benum\b/.test(mods) ? 'enum' : kwRaw === 'interface' ? 'interface' : kwRaw === 'record' ? 'record' : /\babstract\b|\bsealed\b/.test(mods) ? 'abstract' : 'class';
    const c: ClassBox = { name, kind, fields: [], methods: [], ...(/\bdata\b/.test(mods) ? { stereo: 'data' } : kwRaw === 'object' ? { stereo: 'object' } : {}) };
    d.classes.push(c);
    // supertypes
    const ext = /\bextends\s+([^{]+?)(?=\bimplements\b|$)/.exec(header), imp = /\bimplements\s+([^{]+)$/.exec(header);
    const kt = /^\s*:\s*(.+)$/s.exec(header);
    const sup = (list: string, type: RelType) => splitTop(list, ',').forEach(x => { const n = /^\s*([A-Za-z_$][\w$.]*)/.exec(x)?.[1]?.split('.').pop(); if (n) pending.push({ from: name, to: n, type }); });
    if (ext) sup(ext[1], kind === 'interface' ? 'inherit' : 'inherit');
    if (imp) sup(imp[1], 'implement');
    if (kt) splitTop(kt[1], ',').forEach(x => { const n = /^\s*([A-Za-z_$][\w$.]*)/.exec(x)?.[1]?.split('.').pop(); if (n) pending.push({ from: name, to: n, type: /\(\s*\)?/.test(x) && /\(/.test(x) ? 'inherit' : 'implement' }); });
    // constructor properties
    for (const p of kind === 'enum' ? [] : splitTop(ctor, ',')) {   // an enum's constructor properties aren't constants
      const t = p.trim(); if (!t) continue;
      const kp = /^(?:(private|protected|public|internal)\s+)?(?:override\s+)?(val|var)?\s*([A-Za-z_$][\w$]*)\s*:\s*([^=]+)/.exec(t);
      const jp = /^(?:final\s+)?(.+?)\s+([A-Za-z_$][\w$]*)$/.exec(t);
      if (kp && (kp[2] || kwRaw !== 'class')) c.fields.push({ vis: kp[1] ? visOf(kp[1], true) : kind === 'record' ? '' : '+', name: kp[3], type: typeName(kp[4]) });
      else if (kp && kotlin) c.fields.push({ vis: '+', name: kp[3], type: typeName(kp[4]) });
      else if (jp && kind === 'record') c.fields.push({ vis: '', name: jp[2], type: typeName(jp[1]) });
    }
    // body members at depth 0
    let flat = '', depth = 0;
    for (const ch of body) { if (ch === '{') { depth++; if (depth === 1) flat += ';'; continue; } if (ch === '}') { depth--; if (depth === 0) flat += ';'; continue; } if (depth === 0) flat += ch; }
    let stmts = flat.split(/;|\n(?=\s*(?:fun|val|var|private|public|protected|internal|override|abstract|open)\b)/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (kind === 'enum') {
      const consts = (stmts.shift() ?? '').replace(/\(.*?\)/g, '');
      for (const k of consts.split(',')) { const n = /^\s*([A-Z_$][\w$]*)\s*$/.exec(k); if (n) c.fields.push({ vis: '', name: n[1], type: '' }); }
    }
    // nested types are declarations, not members ("enum" is also a modifier word in MODS, so test before stripping)
    stmts = stmts.filter(x => !/^(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|inner|value|annotation)\s+)*(class|interface|enum|record|object|companion|init|static\s*$)/.test(x) && !/^(class|interface|enum|record|object|companion|init|static\s*$)/.test(x.replace(MODS_RE, '')));
    for (const st of stmts) {
      // parameter lists can nest parentheses (suspend () -> T, lambdas): read them balanced
      const methJ = withParams(new RegExp(`^(${MODS})(?:<[^>]+>\\s+)?([\\w$.<>\\[\\]?, ]+?)\\s+([A-Za-z_$][\\w$]*)\\s*\\(`).exec(st), st);
      const methK = withParams(new RegExp(`^(${MODS})fun\\s+(?:<[^>]+>\\s+)?(?:[\\w.]+\\.)?([A-Za-z_$][\\w$]*)\\s*\\(`).exec(st), st, true);
      const fieldK2 = new RegExp(`^(${MODS})(val|var)\\s+([A-Za-z_$][\\w$]*)\\s*(=.*)?$`).exec(st);
      const ctorJ = new RegExp(`^(${MODS})${name}\\s*(\\(|$)`).exec(st);
      const fieldJ = new RegExp(`^(${MODS})([\\w$.<>\\[\\]?, ]+?)\\s+([A-Za-z_$][\\w$]*)\\s*(=.*)?$`).exec(st);
      const fieldK = new RegExp(`^(${MODS})(val|var)\\s+([A-Za-z_$][\\w$]*)\\s*:\\s*([^=]+)`).exec(st);
      if (ctorJ) continue;
      if (methK) { c.methods.push({ vis: visOf(methK[1], true), name: methK[2], params: kParams(methK[3]), type: typeName(methK[4] ?? 'Unit'), ...(/\babstract\b/.test(methK[1]) ? { abstract: true } : {}) }); continue; }
      if (fieldK) { c.fields.push({ vis: visOf(fieldK[1], true), name: fieldK[3], type: typeName(fieldK[4]) }); continue; }
      if (fieldK2) { c.fields.push({ vis: visOf(fieldK2[1], true), name: fieldK2[3], type: '' }); continue; }   // type inferred
      if (methJ && !/^(return|new|throw|if|for|while|switch)$/.test(methJ[2])) {
        c.methods.push({ vis: kind === 'interface' && !/\bprivate\b/.test(methJ[1]) ? '+' : visOf(methJ[1], false), name: methJ[3], params: jParams(methJ[4]), type: typeName(methJ[2]), ...(/\bstatic\b/.test(methJ[1]) ? { static: true } : {}), ...(/\babstract\b/.test(methJ[1]) ? { abstract: true } : {}) });
        continue;
      }
      if (fieldJ && !/^(return|throw|package|import|public|private|protected|static|final|abstract)$/.test(fieldJ[2])) c.fields.push({ vis: visOf(fieldJ[1], false), name: fieldJ[3], type: typeName(fieldJ[2]), ...(/\bstatic\b/.test(fieldJ[1]) ? { static: true } : {}) });
    }
  }
  // relations from supertypes, and from fields whose type is another class read here
  const names = new Set(d.classes.map(c => c.name));
  for (const p of pending) if (names.has(p.to) && !d.relations.some(r => r.from === p.from && r.to === p.to && r.type === p.type)) d.relations.push({ id: relId(), from: p.from, to: p.to, type: p.type });
  for (const c of d.classes) {
    if (c.kind === 'enum') continue;
    for (const f of c.fields) {
      const ref = typeRefs(f.type).find(t => names.has(t.name) && t.name !== c.name);
      if (!ref || d.relations.some(r => r.from === c.name && r.to === ref.name && (r.type === 'inherit' || r.type === 'implement' || r.label === f.name))) continue;
      d.relations.push({ id: relId(), from: c.name, to: ref.name, type: 'assoc', label: f.name, ...(ref.many ? { toMult: '*' } : {}) });
    }
  }
  return d;
}
const MODS_RE = new RegExp('^' + MODS);
/**
 * Complete a method match that stopped at its opening parenthesis: the balanced parameter list, then for
 * Kotlin the `: ReturnType`. Returns the same shape as the old single regex: [all, mods, …, params, return].
 */
function withParams(m: RegExpExecArray | null, st: string, kotlin = false): string[] | null {
  if (!m) return null;
  let depth = 0, i = m.index + m[0].length - 1, j = i;
  for (; j < st.length; j++) { if (st[j] === '(') depth++; else if (st[j] === ')' && --depth === 0) break; }
  if (j >= st.length) return null;
  const params = st.slice(i + 1, j);
  if (!kotlin) return [...m, params];
  const ret = /^\s*:\s*([^={]+)/.exec(st.slice(j + 1))?.[1];
  return [...m, params, ret as string];
}
const kParams = (p: string) => splitTop(p, ',').map(x => x.trim().replace(/^(vararg|noinline|crossinline)\s+/, '').replace(/\s*=.*$/, '')).filter(Boolean).join(', ');
const jParams = (p: string) => splitTop(p, ',').map(x => { const t = x.trim().replace(/^final\s+/, ''); const m = /^(.+?)\s+([A-Za-z_$][\w$]*)$/.exec(t); return m ? `${m[2]}: ${typeName(m[1])}` : t; }).filter(Boolean).join(', ');
/** The class names a type refers to: `List<Item>` → Item (many), `Money?` → Money. */
export function typeRefs(type: string): { name: string; many: boolean }[] {
  const t = type.replace(/[?\s]/g, '');
  const many = /^(List|Set|Collection|Iterable|Array|MutableList|MutableSet|Stream|Flux|Seq)<|\[\]$|^Map</.test(t);
  const inner = /<(.+)>$/.exec(t)?.[1] ?? t.replace(/\[\]$/, '');
  return splitTop(inner, ',').map(x => x.replace(/^(out|in)\s*/, '').replace(/<.*$/, '')).filter(x => NAME_RE.test(x)).map(name => ({ name, many }))
    .concat(many || !/</.test(t) ? [] : [{ name: t.replace(/<.*$/, ''), many: false }]);
}

/** Merge `incoming` into `into`: classes with the same name are replaced (keeping their position); relations are deduplicated. */
export function mergeCls(into: ClassDoc, incoming: ClassDoc): { added: string[]; updated: string[] } {
  const added: string[] = [], updated: string[] = [];
  for (const c of incoming.classes) {
    const i = into.classes.findIndex(x => x.name === c.name);
    if (i >= 0) {
      // a bare mention (relation only) doesn't wipe out a class that has members
      if (!c.fields.length && !c.methods.length && c.kind === 'class' && !c.stereo) continue;
      into.classes[i] = c; updated.push(c.name);
    } else { into.classes.push(c); added.push(c.name); }
  }
  for (const r of incoming.relations) if (!into.relations.some(x => x.from === r.from && x.to === r.to && x.type === r.type && (x.label ?? '') === (r.label ?? ''))) into.relations.push(r);
  return { added, updated };
}

// ---------- generators ----------

const PG_JAVA: [RegExp, string][] = [
  [/^uuid$/, 'UUID'], [/^(text|varchar|char|character|citext|inet|varchar\(\d+\)|char\(\d+\))/, 'String'], [/^(bigint|int8|bigserial)$/, 'long'],
  [/^(int|integer|int4|serial|smallint|int2)$/, 'int'], [/^(bool|boolean)$/, 'boolean'], [/^(timestamptz|timestamp)/, 'Instant'], [/^date$/, 'LocalDate'],
  [/^(numeric|decimal)/, 'BigDecimal'], [/^(real|float4)$/, 'float'], [/^(double precision|float8)$/, 'double'], [/^(json|jsonb)$/, 'JsonNode'], [/^bytea$/, 'byte[]'],
];
const javaType = (pg: string) => (PG_JAVA.find(([re]) => re.test(pg.toLowerCase().trim()))?.[1]) ?? pg;
export const pascal = (s: string) => s.replace(/(^|[_\-\s.]+)([a-zA-Z0-9])/g, (_m, _a, c) => c.toUpperCase()).replace(/[^\w$]/g, '');
const camel = (s: string) => { const p = pascal(s); return p ? p[0].toLowerCase() + p.slice(1) : s; };

/** One class per table; foreign keys become associations. */
export function fromTables(tables: Table[], dbName?: string): ClassDoc {
  const d = blankCls();
  const cname = (t: string) => pascal(t);
  for (const t of tables) {
    d.classes.push({ name: cname(t.name), kind: 'class', stereo: dbName ? `table · ${dbName}` : 'table', methods: [],
      fields: t.columns.filter(c => c.name).map(c => ({ vis: '-', name: camel(c.name), type: javaType(c.type) + (c.nullable && !c.pk ? '?' : '') })) });
  }
  for (const t of tables) for (const c of t.columns) {
    const ref = c.references && !c.references.includes(':') ? c.references.split('.')[0] : null;
    if (!ref || !tables.some(x => x.name === ref)) continue;
    // a unique foreign key is one-to-one; a nullable one may point at nothing
    d.relations.push({ id: relId(), from: cname(t.name), to: cname(ref), type: 'assoc', label: camel(c.name), fromMult: c.unique || c.pk ? '0..1' : '*', toMult: c.nullable ? '0..1' : '1' });
  }
  return d;
}

/** Avro records become records, nested records are owned (composition), enums become enums. */
export function fromAvro(schemaText: string): ClassDoc {
  const d = blankCls();
  let root: any; try { root = JSON.parse(schemaText); } catch { return d; }
  const named = new Map<string, any>();
  const typeOf = (t: any, owner: string, field: string): { type: string; refs: { name: string; many: boolean }[] } => {
    if (typeof t === 'string') {
      const prim: Record<string, string> = { string: 'String', long: 'long', int: 'int', boolean: 'boolean', double: 'double', float: 'float', bytes: 'byte[]', null: 'Void' };
      if (prim[t]) return { type: prim[t], refs: [] };
      const short = t.split('.').pop()!; return { type: short, refs: [{ name: short, many: false }] };
    }
    if (Array.isArray(t)) {
      const non = t.filter(x => x !== 'null');
      const r = typeOf(non.length === 1 ? non[0] : 'string', owner, field);
      return { type: r.type + (t.includes('null') ? '?' : ''), refs: r.refs };
    }
    if (t && typeof t === 'object') {
      if (t.logicalType) return { type: ({ 'timestamp-millis': 'Instant', 'timestamp-micros': 'Instant', 'local-timestamp-millis': 'LocalDateTime', date: 'LocalDate', 'time-millis': 'LocalTime', uuid: 'UUID', decimal: 'BigDecimal' } as Record<string, string>)[t.logicalType] ?? typeOf(t.type, owner, field).type, refs: [] };
      if (t.type === 'record') { visit(t); return { type: t.name, refs: [{ name: t.name, many: false }] }; }
      if (t.type === 'enum') { if (!d.classes.some(c => c.name === t.name)) d.classes.push({ name: t.name, kind: 'enum', fields: (t.symbols ?? []).map((s: string) => ({ vis: '', name: s, type: '' })), methods: [] }); return { type: t.name, refs: [{ name: t.name, many: false }] }; }
      if (t.type === 'array') { const r = typeOf(t.items, owner, field); return { type: `List<${r.type}>`, refs: r.refs.map(x => ({ ...x, many: true })) }; }
      if (t.type === 'map') { const r = typeOf(t.values, owner, field); return { type: `Map<String, ${r.type}>`, refs: r.refs.map(x => ({ ...x, many: true })) }; }
      return typeOf(t.type, owner, field);
    }
    return { type: 'Object', refs: [] };
  };
  const visit = (rec: any) => {
    if (!rec?.name || named.has(rec.name)) return;
    named.set(rec.name, rec);
    const c: ClassBox = { name: rec.name, kind: 'record', fields: [], methods: [], ...(rec.namespace ? { stereo: rec.namespace } : {}) };
    d.classes.push(c);
    for (const f of rec.fields ?? []) {
      const r = typeOf(f.type, rec.name, f.name);
      c.fields.push({ vis: '', name: f.name, type: r.type });
      for (const ref of r.refs) {
        const target = named.get(ref.name);
        d.relations.push({ id: relId(), from: rec.name, to: ref.name, type: target ? 'composition' : 'assoc', label: f.name, ...(ref.many ? { toMult: '*' } : {}) });
      }
    }
  };
  if (root?.type === 'record') visit(root); else if (Array.isArray(root)) root.forEach((r: any) => r?.type === 'record' && visit(r));
  d.relations = d.relations.filter(r => d.classes.some(c => c.name === r.to));
  return d;
}

// ---------- geometry ----------

export const CLS = { headH: 40, stereoH: 13, row: 18, pad: 8, minW: 150, maxW: 340 };
const monoW = (s: string) => s.length * 6.9;
export function boxSize(c: ClassBox): { w: number; h: number; headH: number; fieldsH: number } {
  const lines = c.kind === 'enum' ? c.fields.map(f => f.name) : [...c.fields, ...c.methods].map(m => memberText(m));
  const head = (c.stereo || c.kind !== 'class' ? CLS.stereoH : 0);
  const w = Math.min(CLS.maxW, Math.max(CLS.minW, monoW(c.name) * 1.1 + 40, ...(c.stereo ? [monoW(c.stereo) + 40] : []), ...lines.map(l => monoW(l) + 26)));
  const headH = CLS.headH - 12 + head;
  const fieldsH = Math.max(1, c.fields.length) * CLS.row + CLS.pad;
  const methodsH = c.kind === 'enum' || c.kind === 'record' && !c.methods.length ? 0 : Math.max(1, c.methods.length) * CLS.row + CLS.pad;
  return { w: Math.round(w), h: Math.round(headH + fieldsH + methodsH), headH, fieldsH };
}

/**
 * Layered layout: supertypes above their subtypes, owners above what they own or use. Within a layer,
 * boxes are ordered next to the ones they connect to.
 */
export function layoutCls(d: ClassDoc, only?: Set<string>): Record<string, { x: number; y: number }> {
  const names = d.classes.map(c => c.name);
  const level: Record<string, number> = Object.fromEntries(names.map(n => [n, 0]));
  // "a above b" constraints
  const above: [string, string][] = d.relations.map(r => (r.type === 'inherit' || r.type === 'implement' ? [r.to, r.from] : [r.from, r.to]) as [string, string]).filter(([a, b]) => a !== b && a in level && b in level);
  for (let it = 0; it < names.length + 1; it++) {
    let changed = false;
    for (const [a, b] of above) if (level[b] <= level[a] && level[a] < names.length) { level[b] = level[a] + 1; changed = true; }
    if (!changed) break;
  }
  const layers: string[][] = [];
  for (const n of names) (layers[level[n]] ??= []).push(n);
  const nb = (n: string) => d.relations.flatMap(r => r.from === n ? [r.to] : r.to === n ? [r.from] : []);
  const pos: Record<string, { x: number; y: number }> = {};
  let y = 40;
  layers.filter(Boolean).forEach((layer, li) => {
    if (li > 0) {
      const idx = (n: string) => { const xs = nb(n).map(m => pos[m]?.x).filter((v): v is number => v !== undefined); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Infinity; };
      layer.sort((a, b) => idx(a) - idx(b));
    }
    let x = 40, h = 0;
    for (const n of layer) { const s = boxSize(d.classes.find(c => c.name === n)!); pos[n] = { x, y }; x += s.w + 70; h = Math.max(h, s.h); }
    y += h + 90;
  });
  if (!only) return pos;
  // place only the new ones, to the right of what's there
  const out: Record<string, { x: number; y: number }> = {};
  const kept = Object.entries(d.pos).filter(([n]) => !only.has(n) && names.includes(n));
  const maxX = kept.length ? Math.max(...kept.map(([n, p]) => p.x + boxSize(d.classes.find(c => c.name === n)!).w)) + 100 : 40;
  const minY = kept.length ? Math.min(...kept.map(([, p]) => p.y)) : 40;
  const minNewX = Math.min(...[...only].map(n => pos[n]?.x ?? 40)), minNewY = Math.min(...[...only].map(n => pos[n]?.y ?? 40));
  for (const n of only) if (pos[n]) out[n] = { x: pos[n].x - minNewX + maxX, y: pos[n].y - minNewY + minY };
  return out;
}

/** Point where the segment from the centre of rect `a` toward point `p` leaves `a`. */
export function clipRect(a: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }) {
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2, dx = p.x - cx, dy = p.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = dx ? (a.w / 2) / Math.abs(dx) : Infinity, sy = dy ? (a.h / 2) / Math.abs(dy) : Infinity, s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** Renaming a class renames it everywhere: relations, positions, member types. */
export function renameClass(d: ClassDoc, from: string, to: string) {
  const c = d.classes.find(x => x.name === from); if (!c) return;
  c.name = to;
  for (const r of d.relations) { if (r.from === from) r.from = to; if (r.to === from) r.to = to; }
  if (d.pos[from]) { d.pos[to] = d.pos[from]; delete d.pos[from]; }
  const re = new RegExp(`\\b${from.replace(/\$/g, '\\$')}\\b`, 'g');
  for (const k of d.classes) for (const m of [...k.fields, ...k.methods]) { m.type = m.type.replace(re, to); if (m.params) m.params = m.params.replace(re, to); }
}

// ---------- reading untrusted documents ----------

const VISES: Vis[] = ['+', '-', '#', '~', ''];
const s_ = (v: unknown) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v));
function cleanMember(v: unknown, method: boolean): Member | null {
  if (typeof v === 'string') return NAME_RE.test(v) ? { vis: '', name: v, type: '', ...(method ? { params: '' } : {}) } : null;
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const name = s_(o.name).trim(); if (!NAME_RE.test(name)) return null;
  return { vis: VISES.includes(o.vis as Vis) ? o.vis as Vis : '', name, type: s_(o.type), ...(method || o.params !== undefined ? { params: s_(o.params) } : {}), ...(o.static === true ? { static: true } : {}), ...(o.abstract === true ? { abstract: true } : {}) };
}
/**
 * A class diagram from a file, the server or MCP, made safe: known kinds and relation types, identifier
 * names (unique), members that are members, relations between classes that exist, numeric positions.
 */
export function sanitizeCls(model: unknown, positions: unknown): ClassDoc {
  const m = (model && typeof model === 'object' ? model : {}) as Record<string, unknown>;
  const d = blankCls();
  for (const c of Array.isArray(m.classes) ? m.classes : []) {
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    let name = s_(o.name).replace(/[^\w$]/g, '');
    if (!NAME_RE.test(name)) name = 'Class' + name;
    if (d.classes.some(x => x.name === name)) { let i = 2; while (d.classes.some(x => x.name === name + i)) i++; name = name + i; }
    const kind = CLASS_KINDS.includes(o.kind as ClassKind) ? o.kind as ClassKind : 'class';
    const fields = (Array.isArray(o.fields) ? o.fields : []).map(f => cleanMember(f, false)).filter((x): x is Member => !!x).map(f => (isMethod(f) ? { ...f, params: undefined } : f));
    const methods = (Array.isArray(o.methods) ? o.methods : []).map(f => cleanMember(f, true)).filter((x): x is Member => !!x).map(f => ({ ...f, params: f.params ?? '' }));
    d.classes.push({ name, kind, fields: fields.map(f => { const { params: _p, ...rest } = f; return rest; }), methods, ...(s_(o.stereo) ? { stereo: s_(o.stereo) } : {}), ...itemNotes(o.notes) });
  }
  const names = new Set(d.classes.map(c => c.name)), seen = new Set<string>();
  for (const r of Array.isArray(m.relations) ? m.relations : []) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const from = s_(o.from), to = s_(o.to);
    if (!names.has(from) || !names.has(to)) continue;
    let id = s_(o.id).replace(/[^\w.-]/g, ''); if (!id || seen.has(id)) id = relId(); seen.add(id);
    const rel: Relation = { id, from, to, type: REL_TYPES.includes(o.type as RelType) ? o.type as RelType : 'assoc', ...itemNotes(o.notes) };
    for (const k of ['label', 'fromMult', 'toMult'] as const) if (s_(o[k])) rel[k] = s_(o[k]);
    d.relations.push(rel);
  }
  const p = (positions && typeof positions === 'object' ? positions : {}) as Record<string, unknown>;
  for (const [n, v] of Object.entries(p)) {
    const o = v as Record<string, unknown> | null;
    if (names.has(n) && o && Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.y))) d.pos[n] = { x: Number(o.x), y: Number(o.y) };
  }
  return d;
}
