/** The class diagram's details panel: a class's members, a relation, or the diagram (generators, tips); and the Code tab. */
import { useState } from 'react';
import {
  CLASS_KINDS, REL_LABEL, REL_TYPES, parseClsAny, printCls, typeRefs,
  type ClassBox, type ClassDoc, type ClassKind, type Relation, type RelType, type Vis,
} from '../../domain/cls';
import { change, editor, select, selectOne, useEditor } from '../../store/editor';
import * as history from '../../store/history';
import { CodeEditor } from '../../editor/CodeEditor';
import { Icon } from '../../ui/Icon';
import { docOf, useDoc } from '../shared';
import { addMember, importDoc, remove, removeMember, sources, tryRename, updateMember } from './actions';
import { KIND_LABEL, findClass, hasClass } from './model';
import { useClsUi } from './ui';

export function Panel() {
  const d = useDoc('class');
  const sel = useEditor(s => s.selection);
  const title = useEditor(s => s.meta.title);
  const tab = useClsUi(s => s.panelTab);
  const c = sel?.type === 'class' ? findClass(d, sel.ids[0]) : undefined;
  const r = sel?.type === 'rel' ? d.relations.find(x => x.id === sel.ids[0]) : undefined;
  const itemName = c ? KIND_LABEL[c.kind] : r ? 'Relation' : 'Diagram';
  const setTab = (t: 'item' | 'code') => useClsUi.setState({ panelTab: t, draft: null });
  return (
    <>
      <div className="head">
        <span className="k">{c ? itemName : r ? 'Relation' : 'Classes'}</span>
        <strong>{c ? c.name : r ? `${r.from} ${REL_LABEL[r.type]} ${r.to}` : title}</strong>
        <span className="spacer" />
        {(c || r) && <button type="button" className="icon danger" data-cl="delete" title="Delete" aria-label="Delete" onClick={remove}><Icon name="ic-trash" /></button>}
      </div>
      <div className="tabs">
        <button type="button" data-cltab="item" className={tab === 'item' ? 'on' : ''} onClick={() => setTab('item')}>{c ? 'Members' : itemName}</button>
        <button type="button" data-cltab="code" className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')}>Code</button>
      </div>
      {tab === 'code' ? <CodeTab /> : c ? <ClassTab key={c.name} c={c} d={d} /> : r ? <RelationTab r={r} d={d} /> : <DiagramTab />}
    </>
  );
}

/**
 * A text field that edits the document as you type (one undo step per visit) without the document's
 * normalised value fighting the cursor; Enter leaves it.
 */
function Field({ value, onInput, onDone, ...props }: { value: string; onInput?: (v: string) => void; onDone?: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onInput'> & Record<`data-${string}`, string>) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input {...props} spellCheck={false} value={draft ?? value}
      onFocus={() => { history.begin(); setDraft(value); }}
      onChange={e => { setDraft(e.target.value); onInput?.(e.target.value); }}
      onBlur={e => { const v = e.target.value; setDraft(null); onDone?.(v); history.end(); }}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
  );
}

// ---------- a class ----------
const VIS: Vis[] = ['+', '-', '#', '~', ''];
const VIS_TITLE: Record<string, string> = { '+': 'public', '-': 'private', '#': 'protected', '~': 'package', '': 'unspecified' };
const JAVA_TYPES = ['String', 'UUID', 'int', 'long', 'boolean', 'double', 'BigDecimal', 'Instant', 'LocalDate', 'List<>', 'Set<>', 'Map<String, >', 'Optional<>', 'void'];
const editClass = (name: string, fn: (c: ClassBox) => void) => change('class', d => { const c = findClass(d as ClassDoc, name); if (c) fn(c); });

function ClassTab({ c, d }: { c: ClassBox; d: ClassDoc }) {
  const rels = d.relations.filter(r => r.from === c.name || r.to === c.name);
  const setKind = (kind: ClassKind) => editClass(c.name, x => {
    const was = x.kind; x.kind = kind;
    if (kind === 'enum' && was !== 'enum') { x.fields = x.fields.map(f => ({ vis: '', name: f.name, type: '' })); x.methods = []; }
  });
  return (
    <div className="tab">
      <div className="props">
        <label>Name<Field data-clp="name" value={c.name} onDone={v => { if (v.trim() !== c.name) tryRename(c.name, v.trim()); }} /></label>
        <label>Kind<select data-clp="kind" value={c.kind} onChange={e => setKind(e.target.value as ClassKind)}>{CLASS_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
        <label className="wide">Stereotype<Field data-clp="stereo" value={c.stereo ?? ''} placeholder="entity, aggregate root, value object…"
          onDone={v => editClass(c.name, x => { if (v.trim()) x.stereo = v.trim(); else delete x.stereo; })} /></label>
      </div>
      <datalist id="clTypes">{[...d.classes.map(x => x.name), ...JAVA_TYPES].map(t => <option key={t} value={t} />)}</datalist>
      {c.kind === 'enum' ? <>
        <div className="cl-sec">Constants</div>
        <MemberRows c={c} d={d} kind="f" />
        <AddMember c={c} kind="f" placeholder="+ add constant — e.g. REFUNDED" />
      </> : <>
        <div className="cl-sec">Fields</div>
        <MemberRows c={c} d={d} kind="f" />
        <AddMember c={c} kind="f" placeholder="+ add field — e.g. - fee: Money" />
        <div className="cl-sec">Methods</div>
        <MemberRows c={c} d={d} kind="m" />
        <AddMember c={c} kind="m" placeholder="+ add method — e.g. + retry(n: int): void" />
      </>}
      {rels.length > 0 && <>
        <div className="cl-sec">Relations</div>
        <div className="cl-rels">
          {rels.map(r => (
            <button type="button" key={r.id} className="chip" data-cl={'rel:' + r.id} onClick={() => selectOne('rel', r.id)}>
              {r.from === c.name ? `${REL_LABEL[r.type]} ${r.to}` : `${r.from} ${REL_LABEL[r.type]} this`}{r.label ? ` · ${r.label}` : ''}
            </button>
          ))}
        </div>
      </>}
      <p className="hint-line">Drag the dot on the box's right edge onto another class to relate them. Double-click a member on the box to edit it in place.</p>
    </div>
  );
}

function MemberRows({ c, d, kind }: { c: ClassBox; d: ClassDoc; kind: 'f' | 'm' }) {
  const list = kind === 'f' ? c.fields : c.methods;
  const rm = (i: number) => <button type="button" className="x" data-cl={`rm:${kind}:${i}`} aria-label="Remove" onClick={() => removeMember(c.name, kind, i)}>×</button>;
  return <>{list.map((m, i) => {
    if (c.kind === 'enum') return (
      <div className="cl-mrow enum" key={i}>
        <Field data-clm={`${kind}:${i}:name`} value={m.name} onInput={v => updateMember(c.name, kind, i, x => { x.name = v.trim(); })} />{rm(i)}
      </div>
    );
    const ref = typeRefs(m.type).find(t => hasClass(d, t.name) && t.name !== c.name);
    return (
      <div className="cl-mrow" key={i}>
        <button type="button" className="cl-visbtn" data-cl={`vis:${kind}:${i}`} title={`${VIS_TITLE[m.vis]} — click to change`}
          onClick={() => updateMember(c.name, kind, i, x => { x.vis = VIS[(VIS.indexOf(x.vis) + 1) % VIS.length]; })}>{m.vis || '·'}</button>
        <Field data-clm={`${kind}:${i}:sig`} aria-label={kind === 'm' ? 'Method name' : 'Field name'} value={kind === 'm' ? `${m.name}(${m.params})` : m.name}
          onInput={v => { const mm = /^\s*([A-Za-z_$][\w$]*)\s*(?:\(([^)]*)\)?)?/.exec(v); if (mm) updateMember(c.name, kind, i, x => { x.name = mm[1]; if (kind === 'm') x.params = (mm[2] ?? '').trim(); }); }} />
        <Field data-clm={`${kind}:${i}:type`} aria-label="Type" value={m.type} placeholder={kind === 'm' ? 'void' : 'Type'} list="clTypes"
          onInput={v => updateMember(c.name, kind, i, x => { x.type = v.trim(); })} />
        {m.name === 'id' ? <span className="cl-tag id">ID</span>
          : ref ? <button type="button" className="cl-tag ref" data-cl={'goto:' + ref.name} onClick={() => selectOne('class', ref.name)}>→ {ref.name}</button> : null}
        {rm(i)}
      </div>
    );
  })}</>;
}

/** The one-line add: type a member and press Enter. */
function AddMember({ c, kind, placeholder }: { c: ClassBox; kind: 'f' | 'm'; placeholder: string }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return <>
    <input className={'cl-add' + (error ? ' bad' : '')} data-cladd={kind} placeholder={placeholder} spellCheck={false} value={text}
      onChange={e => { setText(e.target.value); setError(''); }}
      onKeyDown={e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const err = addMember(c.name, kind, text);
        if (err) setError(err); else setText('');
      }} />
    {c.kind !== 'enum' && <p className="cl-adderr" hidden={!error}>{error}</p>}
  </>;
}

// ---------- a relation ----------
const editRelation = (id: string, fn: (r: Relation) => void) => change('class', d => { const r = d.relations.find(x => x.id === id); if (r) fn(r as Relation); });

function RelationTab({ r, d }: { r: Relation; d: ClassDoc }) {
  const names = d.classes.map(c => c.name);
  const text = (key: 'label' | 'fromMult' | 'toMult') => (v: string) => editRelation(r.id, x => { if (v.trim()) x[key] = v.trim(); else delete x[key]; });
  const swap = () => editRelation(r.id, x => {
    [x.from, x.to] = [x.to, x.from];
    [x.fromMult, x.toMult] = [x.toMult, x.fromMult];
    if (!x.fromMult) delete x.fromMult;
    if (!x.toMult) delete x.toMult;
  });
  return (
    <div className="tab">
      <div className="seg cl-types" role="group" aria-label="Kind">
        {REL_TYPES.map(t => <button type="button" key={t} data-cltype={t} className={r.type === t ? 'on' : ''} onClick={() => editRelation(r.id, x => { x.type = t as RelType; })}>{REL_LABEL[t]}</button>)}
      </div>
      <div className="props" style={{ marginTop: 12 }}>
        <label>From<select data-clr="from" value={r.from} onChange={e => editRelation(r.id, x => { x.from = e.target.value; })}>{names.map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>To<select data-clr="to" value={r.to} onChange={e => editRelation(r.id, x => { x.to = e.target.value; })}>{names.map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>From multiplicity<Field data-clr="fromMult" value={r.fromMult ?? ''} list="clMults" placeholder="1" onInput={text('fromMult')} /></label>
        <label>To multiplicity<Field data-clr="toMult" value={r.toMult ?? ''} list="clMults" placeholder="*" onInput={text('toMult')} /></label>
        <label className="wide">Label<Field data-clr="label" value={r.label ?? ''} placeholder="items, card…" onInput={text('label')} /></label>
      </div>
      <datalist id="clMults">{['1', '0..1', '*', '1..*', '0..*'].map(m => <option key={m} value={m} />)}</datalist>
      <p className="sq-actions"><button type="button" className="small" data-cl="swap" onClick={swap}>Swap direction</button></p>
    </div>
  );
}

// ---------- the diagram ----------
function DiagramTab() {
  const src = sources();
  return (
    <div className="tab">
      <div className="cl-sec">Generate</div>
      {src.length ? <>
        <div className="cl-rels">{src.map((s, i) => <button type="button" key={i} className="chip" data-cl={'gen:' + i} onClick={() => importDoc(s.make(), s.label)}>From {s.label}</button>)}</div>
        <p className="hint-line">Adds classes from the tables or Avro schemas in the system diagrams you have open.</p>
      </> : <p className="hint-line">Open a system diagram with database tables or Kafka/SQS schemas in another tab to generate classes from them.</p>}
      <div className="sq-tips"><strong>Drawing</strong><ul>
        <li>Add classes from the left (1–5), or double-click empty canvas.</li>
        <li>Paste Java, Kotlin or a Mermaid classDiagram anywhere on the canvas to read classes in.</li>
        <li>Drag the dot on a box's right edge onto another class, then pick: has many, has, uses, extends, implements, depends.</li>
        <li>Double-click a name or member to edit it. O organises the layout.</li>
      </ul></div>
    </div>
  );
}

// ---------- the Code tab ----------
/** Code and drawing are the same thing: valid text replaces the diagram (keeping where boxes are); other text waits as a draft. */
function applyCode(text: string) {
  const cur = docOf('class');
  if (text === printCls(cur)) return;   // the editor catching up with the drawing (undo, another view)
  const p = parseClsAny(text);
  if (p.errors.length || p.from !== 'cistem') { useClsUi.setState({ draft: text }); return; }
  useClsUi.setState({ draft: null });
  const pos: ClassDoc['pos'] = {};
  for (const c of p.doc.classes) if (cur.pos[c.name]) pos[c.name] = cur.pos[c.name];
  // a class renamed in the text is the same box: keep its place (same position in the list, old name gone)
  const nextNames = new Set(p.doc.classes.map(c => c.name));
  p.doc.classes.forEach((c, i) => { const old = cur.classes[i]; if (!pos[c.name] && old && !nextNames.has(old.name) && cur.pos[old.name]) pos[c.name] = cur.pos[old.name]; });
  const relations = p.doc.relations.map((r, i) => { const o = cur.relations[i]; return o && o.from === r.from && o.to === r.to ? { ...r, id: o.id } : r; });
  change('class', d => { d.classes = p.doc.classes; d.relations = relations; d.pos = pos; });
  const s = editor().selection;
  if (s && !s.ids.every(id => (s.type === 'class' ? nextNames.has(id) : relations.some(r => r.id === id)))) select(null);
}

function CodeTab() {
  const d = useDoc('class');
  const draft = useClsUi(s => s.draft);
  const text = printCls(d);
  const problems = draft !== null ? parseClsAny(draft).errors.length : 0;
  return (
    <div className="sq-code">
      <div onFocus={() => history.begin()} onBlur={() => history.end()}>
        <CodeEditor className="cm-host cl-cm" value={draft ?? text} latest={{ classes: () => docOf('class').classes.map(c => c.name) }}
          mount={(code, host, value, latest) => code.mountCls(host, { doc: value, onChange: applyCode, classes: () => latest.current.classes() })} />
      </div>
      <p className="sq-status">{draft !== null
        ? <><span className="bad">●</span> {problems} problem{problems === 1 ? '' : 's'} — the drawing keeps the last valid version</>
        : <><span className="good">●</span> {d.classes.length} classes · {d.relations.length} relations</>}</p>
      <p className="sq-help">Code and drawing are the same thing. <code>class A {'{ - id: UUID }'}</code>, <code>interface</code>, <code>enum A {'{ X, Y }'}</code>, <code>record</code>; relations <code>A *-- B</code> owns, <code>o--</code> has, <code>--&gt;</code> uses, <code>--|&gt;</code> extends, <code>..|&gt;</code> implements, <code>..&gt;</code> depends. Paste Java, Kotlin or Mermaid to read it in.</p>
    </div>
  );
}
