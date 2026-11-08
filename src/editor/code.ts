/**
 * The code editor for JSON bodies and Avro schemas (CodeMirror 6). Loaded on demand, so the main bundle
 * stays small. Avro smarts live in ./avro (pure, unit-tested); body suggestions come from the diagram.
 */
import { EditorView, keymap, drawSelection, placeholder as cmPlaceholder, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippet, startCompletion, type CompletionContext, type CompletionResult, type Completion } from '@codemirror/autocomplete';
import { linter, lintKeymap, type Diagnostic } from '@codemirror/lint';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { tags as t } from '@lezer/highlight';
import { contextAt, avroSuggestions, avroProblems, problemRange, type Suggestion } from '../domain/avro';
import { StreamLanguage } from '@codemirror/language';
import { parseSeq, printSeq } from '../domain/seq';
import { parseCls, parseClsAny, printCls, mergeCls } from '../domain/cls';
import { parseDbml, parseSql, toDbml, PG_TYPE_LIST, FLAG_LIST, type RefResolver } from '../domain/dbml';
import type { Table } from '../domain/model';


export interface BodyVocab {
  /** field names worth suggesting, with where they come from */
  keys: { name: string; from: string; example?: unknown }[];
}
export interface CodeOptions {
  kind: 'json' | 'avro';
  doc: string;
  onChange: (text: string) => void;
  onFocus?: () => void;
  vocab?: () => BodyVocab;
  big?: boolean;
  placeholder?: string;
}

const highlight = HighlightStyle.define([
  { tag: t.propertyName, color: 'var(--syn-key)' },
  { tag: t.string, color: 'var(--syn-str)' },
  { tag: t.number, color: 'var(--syn-num)' },
  { tag: [t.bool, t.null], color: 'var(--syn-kw)', fontWeight: '500' },
  { tag: [t.brace, t.squareBracket, t.separator, t.punctuation], color: 'var(--muted)' },
]);

const theme = EditorView.theme({
  '&': { fontSize: '12px', border: '1px solid var(--node-line)', borderRadius: '7px', background: 'var(--panel)', color: 'var(--fg)' },
  '&.cm-focused': { outline: 'none', borderColor: 'var(--sel)', boxShadow: '0 0 0 3px var(--sel-soft)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
  '.cm-content': { padding: '6px 0', caretColor: 'var(--fg)' },
  '.cm-line': { padding: '0 8px' },
  '.cm-gutters': { background: 'transparent', border: 'none', color: 'var(--muted)', opacity: '.7' },
  '.cm-activeLine': { background: 'var(--sel-soft)' },
  '.cm-activeLineGutter': { background: 'transparent' },
  '&.cm-focused .cm-matchingBracket': { background: 'var(--sel-soft)', outline: '1px solid var(--sel)' },
  '.cm-placeholder': { color: 'var(--muted)', fontStyle: 'normal' },
  '.cm-tooltip': { border: '1px solid var(--line)', borderRadius: '7px', background: 'var(--panel)', boxShadow: 'var(--shadow)', overflow: 'hidden' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--mono)', fontSize: '12px', maxHeight: '240px' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px 3px 8px !important', lineHeight: '1.5' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--sel-soft)', color: 'var(--fg)' },
  '.cm-completionDetail': { color: 'var(--muted)', fontStyle: 'normal', marginLeft: '10px', fontSize: '11px' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '600', color: 'var(--sel)' },
  '.cm-completionInfo': { fontFamily: 'var(--font)', fontSize: '11.5px', padding: '6px 9px', maxWidth: '240px', color: 'var(--fg)' },
  '.cm-diagnostic': { fontFamily: 'var(--font)', fontSize: '11.5px', padding: '5px 9px' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--crit)', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn)', textUnderlineOffset: '3px' },
  '.cm-foldGutter span': { padding: '0 2px' },
});

/** Format = re-indent valid JSON with two spaces (keeps the text as-is when it doesn't parse). */
export function formatJson(view: EditorView): boolean {
  const text = view.state.doc.toString();
  try {
    const out = JSON.stringify(JSON.parse(text), null, 2);
    if (out !== text) view.dispatch({ changes: { from: 0, to: text.length, insert: out } });
  } catch { /* leave invalid JSON alone; the linter already says why */ }
  return true;
}

const KIND_TYPE: Record<Suggestion['kind'], string> = { property: 'property', type: 'type', keyword: 'keyword', snippet: 'text', value: 'enum' };
function toCompletion(s: Suggestion): Completion {
  const c: Completion = { label: s.label, detail: s.detail, info: s.info, type: KIND_TYPE[s.kind], boost: s.boost };
  c.apply = s.apply.includes('${') ? snippet(s.apply) : s.apply;
  return c;
}
/** We do our own matching: CodeMirror's filter would compare against the quote too. */
function rank(options: Suggestion[], partial: string): Suggestion[] {
  if (!partial) return options;
  const p = partial.toLowerCase();
  const starts = options.filter(o => o.label.toLowerCase().startsWith(p));
  const contains = options.filter(o => !o.label.toLowerCase().startsWith(p) && o.label.toLowerCase().includes(p));
  return [...starts, ...contains];
}

function avroSource(ctx: CompletionContext): CompletionResult | null {
  const text = ctx.state.doc.toString();
  const c = contextAt(text, ctx.pos);
  if (c.where === 'none') return null;
  const opts = rank(avroSuggestions(text, c), c.partial);
  if (!opts.length) return null;
  return { from: c.from, to: c.to, options: opts.map(toCompletion), filter: false };
}

/** A sensible example value for a field, from its name (snippet syntax: ${} marks the editable part). */
export const exampleFor = (name: string): string => {
  if (/^id$|_id$|[a-z]Id$/.test(name)) return '"${<uuid>}"';
  if (/_at$|[a-z]At$|date|time/i.test(name)) return '"${2026-01-01T00:00:00Z}"';
  if (/currency/i.test(name)) return '"${GBP}"';
  if (/amount|price|total|count|qty|quantity|minor/i.test(name)) return '${1000}';
  if (/^(is|has)[_A-Z]/.test(name)) return '${true}';
  if (/status|state/i.test(name)) return '"${PENDING}"';
  if (/email/i.test(name)) return '"${name@example.com}"';
  if (/[^s]s$/.test(name)) return '[${}]';
  return '"${}"';
};

function bodySource(vocab?: () => BodyVocab) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const text = ctx.state.doc.toString();
    const c = contextAt(text, ctx.pos);
    if (c.where === 'key') {
      const seen = new Set(c.present);
      const pool = (vocab?.().keys ?? []).filter(k => !seen.has(k.name));
      const uniq = new Map<string, { name: string; from: string; example?: unknown }>();
      pool.forEach(k => { if (!uniq.has(k.name)) uniq.set(k.name, k); });
      const opts = rank([...uniq.values()].map((k, i) => ({
        label: k.name, detail: k.from, kind: 'property' as const, boost: -i * 0.001,
        apply: c.hasColon ? `"${k.name}"` : `"${k.name}": ${k.example !== undefined ? JSON.stringify(k.example).replace(/\$/g, '\\$') : exampleFor(k.name)}`,
      })), c.partial);
      if (!opts.length) return null;
      return { from: c.from, to: c.to, options: opts.map(toCompletion), filter: false };
    }
    if (c.where === 'value' && !c.inString && !c.partial) {
      const opts: Suggestion[] = [
        { label: '{ }', apply: '{\n  "${}": ""\n}', detail: 'object', kind: 'snippet' },
        { label: '[ ]', apply: '[${}]', detail: 'array', kind: 'snippet' },
        { label: 'true', apply: 'true', kind: 'value' }, { label: 'false', apply: 'false', kind: 'value' }, { label: 'null', apply: 'null', kind: 'value' },
      ];
      if (c.key) opts.unshift({ label: 'example', apply: exampleFor(c.key), detail: 'for ' + c.key, kind: 'snippet', boost: 5 });
      return { from: c.from, to: c.to, options: opts.map(toCompletion), filter: false };
    }
    return null;
  };
}

/** JSON syntax errors come back as a point; stretch them over the offending token so they're visible. */
function syntaxErrors(view: EditorView): Diagnostic[] {
  const text = view.state.doc.toString();
  return jsonParseLinter()(view).map(d => {
    if (d.to > d.from) return d;
    let from = d.from, to = d.from;
    while (to < text.length && /[^\s,:{}[\]]/.test(text[to])) to++;
    if (to === from) { // at a delimiter or the end: underline the previous token instead
      while (from > 0 && /\s/.test(text[from - 1])) from--;
      to = from; while (from > 0 && /[^\s,:{}[\]]/.test(text[from - 1])) from--;
      if (from === to) { from = Math.max(0, d.from - 1); to = Math.min(text.length, from + 1); }
    }
    return { ...d, from, to };
  });
}

function avroLinter(view: EditorView): Diagnostic[] {
  const base = syntaxErrors(view);
  if (base.length) return base;
  const text = view.state.doc.toString();
  if (!text.trim()) return [];
  return avroProblems(text).map(p => { const [from, to] = problemRange(text, p); return { from, to, severity: p.severity, message: p.message }; });
}
function jsonLinter(view: EditorView): Diagnostic[] {
  return view.state.doc.length && view.state.doc.toString().trim() ? syntaxErrors(view) : [];
}

/** Open completions as soon as a quote, colon, comma or bracket opens a slot (not just on letters). */
const autoOpen = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (/^["{,:[ ]$/.test(text)) setTimeout(() => { if (view.hasFocus) startCompletion(view); }, 0);
  return false;
});

export function mountCode(parent: HTMLElement, o: CodeOptions): EditorView {
  const exts: Extension[] = [
    history(), drawSelection(), indentOnInput(), bracketMatching(), closeBrackets(),
    json(), syntaxHighlighting(highlight), theme,
    EditorState.tabSize.of(2),
    autocompletion({ override: [o.kind === 'avro' ? avroSource : bodySource(o.vocab)], icons: false, activateOnTyping: true, closeOnBlur: true, maxRenderedOptions: 40 }),
    autoOpen,
    linter(o.kind === 'avro' ? avroLinter : jsonLinter, { delay: 350 }),
    keymap.of([...closeBracketsKeymap, ...completionKeymap, ...lintKeymap, ...foldKeymap, { key: 'Shift-Alt-f', run: formatJson }, { key: 'Mod-s', run: v => { formatJson(v); return false; } }, ...historyKeymap, indentWithTab, ...defaultKeymap]),
    EditorView.updateListener.of(u => { if (u.docChanged) o.onChange(u.state.doc.toString()); }),
    EditorView.domEventHandlers({ focus: () => { o.onFocus?.(); return false; } }),
    EditorView.lineWrapping,
    cmPlaceholder(o.placeholder ?? (o.kind === 'avro' ? 'Type { and pick from the suggestions…' : '{ "field": "value" } — suggestions as you type')),
  ];
  if (o.big) exts.push(lineNumbers(), foldGutter(), highlightActiveLine());
  parent.textContent = '';
  return new EditorView({ parent, state: EditorState.create({ doc: o.doc, extensions: exts }) });
}

// ---------- tables as text (DBML-style) ----------

const dbmlLang = StreamLanguage.define<{ inBracket: boolean; word: number }>({
  startState: () => ({ inBracket: false, word: 0 }),
  token(stream, st) {
    if (stream.sol()) { st.word = 0; st.inBracket = false; }
    if (stream.eatSpace()) return null;
    if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (st.inBracket) {
      if (stream.eat(']')) { st.inBracket = false; return 'bracket'; }
      if (stream.match(/^`[^`]*`?/) || stream.match(/^'[^']*'?/) || stream.match(/^"[^"]*"?/)) return 'string';
      if (stream.match(/^(pk|primary key|unique|index|not null|null|increment|default|ref|note)\b/i)) return 'keyword';
      if (stream.match(/^-?\d+(\.\d+)?/)) return 'number';
      if (stream.match(/^[<>:,-]/)) return 'punctuation';
      stream.match(/^[\w.$()-]+/) || stream.next(); return 'variableName';
    }
    if (stream.eat('[')) { st.inBracket = true; return 'bracket'; }
    if (stream.match(/^[{}]/)) return 'brace';
    if (stream.match(/^table\b/i) && st.word === 0) { st.word = -1; return 'keyword'; }
    if (st.word === -1) { stream.match(/^[\w."$]+/) || stream.next(); return 'typeName'; }
    if (stream.eat('?')) return 'operator';
    if (stream.match(/^[\w"$]+/)) { st.word++; return st.word === 1 ? 'propertyName' : 'typeName'; }
    if (stream.match(/^\w+\s*\([\d, ]*\)/)) { st.word++; return 'typeName'; }
    stream.next(); return null;
  },
});
const dbmlHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-kw)', fontWeight: '500' },
  { tag: t.propertyName, color: 'var(--fg)' },
  { tag: t.typeName, color: 'var(--syn-key)' },
  { tag: t.string, color: 'var(--syn-str)' },
  { tag: t.number, color: 'var(--syn-num)' },
  { tag: t.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: t.operator, color: 'var(--pk)', fontWeight: '600' },
  { tag: [t.brace, t.squareBracket, t.punctuation], color: 'var(--muted)' },
  { tag: t.variableName, color: 'var(--fk)' },
]);

export interface DbmlOptions {
  doc: string;
  onChange: (text: string) => void;
  onFocus?: () => void;
  resolver: RefResolver;
  /** `db-name.table.column` targets in other databases (their primary keys) */
  externalTargets: () => string[];
  big?: boolean;
}

function dbmlSource(o: DbmlOptions) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const doc = ctx.state.doc, line = doc.lineAt(ctx.pos), before = line.text.slice(0, ctx.pos - line.from);
    // are we inside a table body?
    let inTable = false;
    for (let n = line.number - 1; n >= 1; n--) { const l = doc.line(n).text.trim(); if (/^}/.test(l)) break; if (/^table\b/i.test(l)) { inTable = true; break; } }
    const word = /[\w.$>-]*$/.exec(before)![0], from = ctx.pos - word.length;
    const open = before.lastIndexOf('['), close = before.lastIndexOf(']');
    if (inTable && open > close) {
      const seg = before.slice(open + 1).split(',').pop()!;
      if (/^\s*ref\s*:\s*>?\s*[\w.$-]*$/i.test(seg)) {
        const parsed = parseDbml(doc.toString(), o.resolver);
        const local = parsed.tables.flatMap(tb => tb.columns.map(c => ({ label: `${tb.name}.${c.name}`, detail: c.type + (c.pk ? ' · pk' : ''), boost: c.pk ? 1 : 0 })));
        const ext = o.externalTargets().map(x => ({ label: x, detail: 'other database' }));
        const tf = /[\w.$-]*$/.exec(before)![0];
        return { from: ctx.pos - tf.length, options: [...local, ...ext].map(x => ({ ...x, type: 'variable' })), validFor: /^[\w.$-]*$/ };
      }
      if (/^\s*[\w ]*$/.test(seg)) {
        const fw = /[\w ]*$/.exec(seg)![0].trimStart();
        return { from: ctx.pos - fw.length, options: FLAG_LIST.map(f => ({ label: f.label, apply: f.apply, info: f.info, type: 'keyword' })), validFor: /^[\w ]*$/ };
      }
      return null;
    }
    if (inTable && /^\s+[\w"$]+\s+[\w(),]*$/.test(before)) {
      return { from, options: PG_TYPE_LIST.map((x, i) => ({ label: x, type: 'type', boost: -i * 0.01 })), validFor: /^[\w(),]*$/ };
    }
    if (inTable && /^\s+[\w"$]+\s+\S+\s+$/.test(before) && ctx.explicit) {
      return { from: ctx.pos, options: [{ label: '[ ]', apply: snippet('[${}]'), type: 'text', detail: 'flags' }, { label: '?', apply: '?', type: 'text', detail: 'nullable' }] };
    }
    if (!inTable && /^\s*\w*$/.test(before)) {
      return { from: line.from, options: [{ label: 'Table', apply: snippet('Table ${name} {\n  id uuid [pk]\n  ${}\n}'), detail: 'new table', type: 'keyword' }] };
    }
    return null;
  };
}

function dbmlLinter(o: DbmlOptions) {
  return (view: EditorView): Diagnostic[] => {
    const text = view.state.doc.toString();
    if (!text.trim()) return [];
    return parseDbml(text, o.resolver).errors.map(e => {
      const l = view.state.doc.line(Math.min(e.line + 1, view.state.doc.lines));
      const lead = l.text.length - l.text.trimStart().length;
      return { from: l.from + lead, to: Math.max(l.from + lead + 1, l.to), severity: 'error' as const, message: e.message };
    });
  };
}

/** Paste CREATE TABLE … and get the text format instead. */
const sqlPaste = (o: DbmlOptions) => EditorView.domEventHandlers({
  paste(ev, view) {
    const text = ev.clipboardData?.getData('text/plain') ?? '';
    if (!/create\s+table/i.test(text)) return false;
    const p = parseSql(text);
    if (!p.tables.length) return false;
    ev.preventDefault();
    const sel = view.state.selection.main;
    const cur = view.state.doc.toString();
    const lead = sel.from > 0 && !cur.slice(0, sel.from).endsWith('\n\n') ? (cur.slice(0, sel.from).endsWith('\n') ? '\n' : '\n\n') : '';
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: lead + toDbml(p.tables, o.resolver) } });
    return true;
  },
});

export function mountDbml(parent: HTMLElement, o: DbmlOptions): EditorView {
  const exts: Extension[] = [
    history(), drawSelection(), bracketMatching(), closeBrackets(), indentOnInput(),
    dbmlLang, syntaxHighlighting(dbmlHighlight), theme, EditorState.tabSize.of(2),
    autocompletion({ override: [dbmlSource(o)], icons: false, activateOnTyping: true, maxRenderedOptions: 60 }),
    EditorView.inputHandler.of((view, _f, _t, text) => { if (text === ' ' || text === '[' || text === ',' || text === '>') setTimeout(() => { if (view.hasFocus) startCompletion(view); }, 0); return false; }),
    linter(dbmlLinter(o), { delay: 300 }),
    sqlPaste(o),
    keymap.of([...closeBracketsKeymap, ...completionKeymap, ...lintKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
    EditorView.updateListener.of(u => { if (u.docChanged) o.onChange(u.state.doc.toString()); }),
    EditorView.domEventHandlers({ focus: () => { o.onFocus?.(); return false; } }),
    cmPlaceholder('Table payments {\n  id uuid [pk]\n}\n\n— or paste CREATE TABLE … SQL'),
  ];
  if (o.big) exts.push(lineNumbers(), highlightActiveLine());
  parent.textContent = '';
  return new EditorView({ parent, state: EditorState.create({ doc: o.doc, extensions: exts }) });
}
// ---------- sequence diagrams as text ----------

const seqLang = StreamLanguage.define<{ afterColon: boolean }>({
  startState: () => ({ afterColon: false }),
  token(stream, st) {
    if (stream.sol()) st.afterColon = false;
    if (st.afterColon) { stream.skipToEnd(); return 'string'; }
    if (stream.eatSpace()) return null;
    if (stream.match('#') || stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (stream.sol() || /^\s*$/.test(stream.string.slice(0, stream.start))) {
      if (stream.match(/^(alt|else|and|opt|loop|par)\b/i)) { st.afterColon = true; return 'keyword'; }
      if (stream.match(/^(participant|actor|note|over|left of|right of|end)\b/i)) return 'keyword';
    }
    if (stream.match(/^(over|left of|right of)\b/i)) return 'keyword';
    if (stream.match(/^(->>|-->|->)/)) return 'operator';
    if (stream.eat(':')) { st.afterColon = true; return 'punctuation'; }
    if (stream.match(/^"[^"]*"?/)) return 'string';
    if (stream.match(/^@[\w.$-]+/)) return 'number';
    if (stream.eat(',')) return 'punctuation';
    if (stream.match(/^[A-Za-z_$][\w.$-]*/)) {
      const before = stream.string.slice(0, stream.start).trim();
      return /^(participant|actor)\b/i.test(before) && /"/.test(before) ? 'typeName' : 'variableName';
    }
    stream.next(); return null;
  },
});
const seqHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-kw)', fontWeight: '600' },
  { tag: t.variableName, color: 'var(--syn-key)' },
  { tag: t.typeName, color: 'var(--syn-num)' },
  { tag: t.operator, color: 'var(--fg)', fontWeight: '700' },
  { tag: t.string, color: 'var(--fg)' },
  { tag: t.number, color: 'var(--fk)' },
  { tag: t.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: t.punctuation, color: 'var(--muted)' },
]);
export interface SeqOptions { doc: string; onChange: (text: string) => void; participants: () => string[]; labels: (to: string) => string[]; big?: boolean }
function seqSource(o: SeqOptions) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos), before = line.text.slice(0, ctx.pos - line.from);
    const ids = () => o.participants().map(id => ({ label: id, type: 'variable' }));
    let m = /^\s*(\S+?)\s*(->>|-->|->)\s*(\S+?)\s*:\s*([^]*)$/.exec(before);
    if (m) { const opts = o.labels(m[3]); if (!opts.length) return null; return { from: ctx.pos - m[4].length, options: opts.map(l => ({ label: l, type: 'text' })), validFor: /^[^]*$/ }; }
    if ((m = /^\s*\S+?\s*(?:->>|-->|->)\s*([\w.$-]*)$/.exec(before))) return { from: ctx.pos - m[1].length, options: ids(), validFor: /^[\w.$-]*$/ };
    if ((m = /^\s*([\w.$-]+)\s+$/.exec(before)) && o.participants().includes(m[1])) return { from: ctx.pos, options: [{ label: '->', detail: 'call', type: 'keyword' }, { label: '-->', detail: 'reply', type: 'keyword' }, { label: '->>', detail: 'async', type: 'keyword' }] };
    if ((m = /^\s*note\s+over\s+(?:[\w.$-]+\s*,\s*)*([\w.$-]*)$/i.exec(before))) return { from: ctx.pos - m[1].length, options: ids(), validFor: /^[\w.$-]*$/ };
    if ((m = /^\s*([\w.$-]*)$/.exec(before)) && (m[1].length || ctx.explicit)) {
      const kw = [
        { label: 'participant', apply: snippet('participant ${name}'), type: 'keyword' }, { label: 'note over', apply: snippet('note over ${who}: ${text}'), type: 'keyword' },
        { label: 'alt', apply: snippet('alt ${condition}\n  ${}\nelse\n  \nend'), type: 'keyword', detail: 'alternatives' },
        { label: 'opt', apply: snippet('opt ${condition}\n  ${}\nend'), type: 'keyword' }, { label: 'loop', apply: snippet('loop ${for each item}\n  ${}\nend'), type: 'keyword' },
        { label: 'par', apply: snippet('par ${}\n  \nand\n  \nend'), type: 'keyword' }, { label: 'else', type: 'keyword' }, { label: 'end', type: 'keyword' },
      ];
      return { from: ctx.pos - m[1].length, options: [...ids(), ...kw], validFor: /^[\w.$-]*$/ };
    }
    return null;
  };
}
function seqLinter(view: EditorView): Diagnostic[] {
  const text = view.state.doc.toString();
  if (!text.trim()) return [];
  return parseSeq(text).errors.map(e => {
    const l = view.state.doc.line(Math.min(e.line + 1, view.state.doc.lines));
    const lead = l.text.length - l.text.trimStart().length;
    return { from: l.from + lead, to: Math.max(l.from + lead + 1, l.to), severity: 'error' as const, message: e.message };
  });
}
/** Paste Mermaid or PlantUML and get this format instead. */
const seqPaste = EditorView.domEventHandlers({
  paste(ev, view) {
    const text = ev.clipboardData?.getData('text/plain') ?? '';
    const p = parseSeq(text);
    if (p.from === 'cistem') return false;
    ev.preventDefault();
    const printed = printSeq(p.doc);
    const sel = view.state.selection.main;
    const whole = sel.from === 0 && sel.to === view.state.doc.length;
    view.dispatch({ changes: whole || !view.state.doc.length ? { from: 0, to: view.state.doc.length, insert: printed } : { from: sel.from, to: sel.to, insert: printed } });
    return true;
  },
});
export function mountSeq(parent: HTMLElement, o: SeqOptions): EditorView {
  const exts: Extension[] = [
    history(), drawSelection(), indentOnInput(), seqLang, syntaxHighlighting(seqHighlight), theme, EditorState.tabSize.of(2),
    autocompletion({ override: [seqSource(o)], icons: false, activateOnTyping: true, maxRenderedOptions: 40 }),
    EditorView.inputHandler.of((view, _f, _t, text) => { if (text === ' ' || text === '>' || text === ':' || text === ',') setTimeout(() => { if (view.hasFocus) startCompletion(view); }, 0); return false; }),
    linter(seqLinter, { delay: 300 }), seqPaste, lineNumbers(), highlightActiveLine(),
    keymap.of([...completionKeymap, ...lintKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
    EditorView.updateListener.of(u => { if (u.docChanged) o.onChange(u.state.doc.toString()); }),
    cmPlaceholder('client -> api: POST /orders\napi --> client: 201 Created\n\n— or paste Mermaid / PlantUML'),
  ];
  parent.textContent = '';
  return new EditorView({ parent, state: EditorState.create({ doc: o.doc, extensions: exts }) });
}
// ---------- class diagrams as text ----------

const clsLang = StreamLanguage.define<{ inBody: boolean; afterColon: boolean }>({
  startState: () => ({ inBody: false, afterColon: false }),
  token(stream, st) {
    if (stream.sol()) st.afterColon = false;
    if (stream.eatSpace()) return null;
    if (stream.match('%%') || stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (stream.eat('{')) { st.inBody = true; return 'brace'; }
    if (stream.eat('}')) { st.inBody = false; return 'brace'; }
    if (stream.match(/^<<[^>]*>>/)) return 'meta';
    if (stream.match(/^"[^"]*"?/)) return 'number';
    if (!st.inBody && stream.match(/^(abstract\s+class|class|interface|enum|record)\b/)) return 'keyword';
    if (stream.match(/^(<\|--|<\|\.\.|--\|>|\.\.\|>|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.|--|\.\.)/)) return 'operator';
    if (st.inBody && stream.match(/^[+\-#~](?=\s*[A-Za-z_{])/)) return 'operator';
    if (stream.match(/^\{(static|abstract)\}/)) return 'meta';
    if (stream.eat(':')) { st.afterColon = true; return 'punctuation'; }
    if (stream.match(/^[A-Za-z_$][\w$]*/)) return st.afterColon ? 'typeName' : st.inBody ? 'propertyName' : 'variableName';
    stream.next(); return null;
  },
});
const clsHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-kw)', fontWeight: '600' },
  { tag: t.variableName, color: 'var(--syn-key)', fontWeight: '600' },
  { tag: t.propertyName, color: 'var(--fg)' },
  { tag: t.typeName, color: 'var(--syn-num)' },
  { tag: t.operator, color: 'var(--fk)', fontWeight: '700' },
  { tag: t.meta, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: t.number, color: 'var(--syn-str)' },
  { tag: t.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [t.brace, t.punctuation], color: 'var(--muted)' },
]);
export interface ClsOptions { doc: string; onChange: (text: string) => void; classes: () => string[] }
function clsSource(o: ClsOptions) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos), before = line.text.slice(0, ctx.pos - line.from);
    const w = /[\w$]*$/.exec(before)![0];
    if (!w && !ctx.explicit) return null;
    const names = o.classes().map(n => ({ label: n, type: 'class' }));
    const types = ['String', 'UUID', 'int', 'long', 'boolean', 'double', 'BigDecimal', 'Instant', 'LocalDate', 'List<', 'Set<', 'Map<String, ', 'Optional<', 'void'].map(n => ({ label: n, type: 'type' }));
    if (/:\s*[\w$<>, ]*$/.test(before)) return { from: ctx.pos - w.length, options: [...names, ...types], validFor: /^[\w$]*$/ };
    if (/^\s*[\w$]*$/.test(before)) return { from: ctx.pos - w.length, options: [
      { label: 'class', apply: snippet('class ${Name} {\n  - ${id}: ${UUID}\n}'), type: 'keyword' }, { label: 'interface', apply: snippet('interface ${Name} {\n  + ${method}(): ${void}\n}'), type: 'keyword' },
      { label: 'enum', apply: snippet('enum ${Name} { ${A}, ${B} }'), type: 'keyword' }, { label: 'record', apply: snippet('record ${Name} { ${field}: ${Type} }'), type: 'keyword' },
      { label: 'abstract class', apply: snippet('abstract class ${Name}'), type: 'keyword' }, ...names], validFor: /^[\w$ ]*$/ };
    if (/^\s*[\w$]+\s*(?:"[^"]*"\s*)?(?:<\|--|<\|\.\.|--\|>|\.\.\|>|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.)\s*(?:"[^"]*"\s*)?[\w$]*$/.test(before)) return { from: ctx.pos - w.length, options: names, validFor: /^[\w$]*$/ };
    return null;
  };
}
function clsLinter(view: EditorView): Diagnostic[] {
  const text = view.state.doc.toString();
  if (!text.trim()) return [];
  return parseCls(text).errors.map(e => {
    const l = view.state.doc.line(Math.min(e.line + 1, view.state.doc.lines));
    const lead = l.text.length - l.text.trimStart().length;
    return { from: l.from + lead, to: Math.max(l.from + lead + 1, l.to), severity: 'error' as const, message: e.message };
  });
}
/** Paste Java, Kotlin or Mermaid and it's merged into the text in this format. */
const clsPaste = EditorView.domEventHandlers({
  paste(ev, view) {
    const text = ev.clipboardData?.getData('text/plain') ?? '';
    const p = parseClsAny(text);
    if (p.from === 'cistem' || !p.doc.classes.length) return false;
    ev.preventDefault();
    const cur = parseCls(view.state.doc.toString());
    const base = cur.errors.length ? null : cur.doc;
    if (base) { mergeCls(base, p.doc); view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: printCls(base) } }); }
    else { const sel = view.state.selection.main; view.dispatch({ changes: { from: sel.from, to: sel.to, insert: printCls(p.doc) } }); }
    return true;
  },
});
export function mountCls(parent: HTMLElement, o: ClsOptions): EditorView {
  const exts: Extension[] = [
    history(), drawSelection(), bracketMatching(), closeBrackets(), indentOnInput(), clsLang, syntaxHighlighting(clsHighlight), theme, EditorState.tabSize.of(2),
    autocompletion({ override: [clsSource(o)], icons: false, activateOnTyping: true, maxRenderedOptions: 40 }),
    linter(clsLinter, { delay: 300 }), clsPaste, lineNumbers(), highlightActiveLine(),
    keymap.of([...closeBracketsKeymap, ...completionKeymap, ...lintKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
    EditorView.updateListener.of(u => { if (u.docChanged) o.onChange(u.state.doc.toString()); }),
    cmPlaceholder('class Order {\n  - id: UUID\n}\nOrder *-- LineItem\n\n— or paste Java, Kotlin or Mermaid'),
  ];
  parent.textContent = '';
  return new EditorView({ parent, state: EditorState.create({ doc: o.doc, extensions: exts }) });
}
export { parseDbml, toDbml };
export type { Table };
