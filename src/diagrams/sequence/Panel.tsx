/** The sequence's details panel: the selected message, note, block or lifeline (or the diagram), and the Code tab. */
import { BLOCK_KINDS, balanced, blockEnd, keepIds, parseSeq, printSeq, timing, type BlockKind, type MsgStyle, type Participant, type Row, type SeqDoc } from '../../domain/seq';
import { TYPES, typeDef } from '../../domain/model';
import { fmtMs } from '../../lib/format';
import * as history from '../../store/history';
import { change, useEditor } from '../../store/editor';
import { activate, systemTabs, tabFor, usesFor, useTabs } from '../../store/tabs';
import { fitView } from '../../store/commands';
import { hint } from '../../store/ui';
import { CodeEditor } from '../../editor/CodeEditor';
import { Icon } from '../../ui/Icon';
import { docOf, useDoc } from '../shared';
import { useSeqUi } from './state';
import { useLinkedSystem, nodeOf, labelSuggestions, REPLY_LABELS, type LinkedSystem } from './linked';
import { NotesSection } from '../../notes/ItemNotes';
import { addBranch, addReply, depthOf, linkByName, nameOf, removeRow, removeSelection, renameId, unwrap } from './actions';

/** A field's focus-to-blur is one undo step. */
const field = { onFocus: () => history.begin(), onBlur: () => history.end() };
/** Change the row with `id` (when it's of the expected kind). */
function editRow<T extends Row['t']>(id: string, t: T, fn: (r: Extract<Row, { t: T }>) => void) {
  change('sequence', d => { const r = d.rows.find(x => x.id === id); if (r?.t === t) fn(r as Extract<Row, { t: T }>); });
}
const ITEM: Record<Row['t'], string> = { msg: 'Message', note: 'Note', open: 'Block', else: 'Branch', close: 'Block' };

export function SeqPanel() {
  const d = useDoc('sequence');
  const sel = useEditor(s => s.selection);
  const title = useEditor(s => s.meta.title);
  const tab = useSeqUi(s => s.tab);
  const sys = useLinkedSystem(d);
  const row = sel?.type === 'row' ? d.rows.find(r => r.id === sel.ids[0]) : undefined;
  const part = sel?.type === 'part' ? d.participants.find(p => p.id === sel.ids[0]) : undefined;
  const itemName = row ? ITEM[row.t] : part ? 'Participant' : 'Diagram';
  const heading = row?.t === 'msg' ? row.label || `${nameOf(d, row.from)} → ${nameOf(d, row.to)}` : part ? part.name : title;
  const setTab = (t: 'item' | 'code') => useSeqUi.setState({ tab: t, draft: null });
  return (
    <>
      <div className="head">
        <span className="k">{itemName === 'Diagram' ? 'Sequence' : itemName}</span><strong>{heading}</strong><span className="spacer" />
        {(row || part) && <button type="button" className="icon danger" data-sq="delete" title="Delete" aria-label="Delete" onClick={removeSelection}><Icon name="ic-trash" /></button>}
      </div>
      <div className="tabs">
        <button type="button" data-sqtab="item" className={tab === 'item' ? 'on' : ''} onClick={() => setTab('item')}>{itemName}</button>
        <button type="button" data-sqtab="code" className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')}>Code</button>
      </div>
      {tab === 'code' ? <CodeTab d={d} />
        : row?.t === 'msg' ? <MessageFields d={d} r={row} sys={sys} />
        : row?.t === 'note' ? <NoteFields d={d} r={row} />
        : row ? <BlockFields d={d} r={row} />
        : part ? <ParticipantFields d={d} p={part} sys={sys} />
        : <DiagramFields d={d} sys={sys} />}
      {tab !== 'code' && part && <NotesSection type="part" id={part.id} value={part.notes ?? ''} />}
    </>
  );
}

const Options = ({ d }: { d: SeqDoc }) => <>{d.participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</>;

function MessageFields({ d, r, sys }: { d: SeqDoc; r: Extract<Row, { t: 'msg' }>; sys: LinkedSystem | null }) {
  const sugg = r.style === 'reply' ? REPLY_LABELS : labelSuggestions(d, r.to);
  const i = d.rows.indexOf(r);
  const needsReply = r.style === 'sync' && r.from !== r.to && !d.rows.slice(i + 1).some(x => x.t === 'msg' && x.style === 'reply' && x.from === r.to && x.to === r.from);
  const linked = !!nodeOf(d.participants.find(p => p.id === r.to), sys);
  return (
    <div className="tab">
      <div className="props">
        <label>From<select data-sqf="from" value={r.from} {...field} onChange={e => editRow(r.id, 'msg', m => { m.from = e.target.value; })}><Options d={d} /></select></label>
        <label>To<select data-sqf="to" value={r.to} {...field} onChange={e => editRow(r.id, 'msg', m => { m.to = e.target.value; })}><Options d={d} /></select></label>
        <label className="wide">Label<input data-sqf="label" value={r.label} list="sqLabelList" placeholder={r.style === 'reply' ? '200 OK' : 'POST /payments'} {...field}
          onChange={e => editRow(r.id, 'msg', m => { m.label = e.target.value; })} /></label>
        <datalist id="sqLabelList">{sugg.map(o => <option key={o} value={o} />)}</datalist>
        <div className="wide seg" role="group" aria-label="Kind">
          {(['sync', 'reply', 'async'] as MsgStyle[]).map(st => (
            <button type="button" key={st} data-sqstyle={st} className={r.style === st ? 'on' : ''} onClick={() => editRow(r.id, 'msg', m => { m.style = st; })}>
              {st === 'sync' ? 'Call' : st === 'reply' ? 'Reply' : 'Async'}
            </button>
          ))}
        </div>
      </div>
      {needsReply && <p><button type="button" className="small" data-sq="add-reply" onClick={() => addReply(r.id)}>+ Add the reply</button></p>}
      {r.style !== 'reply' && (sugg.length
        ? <p className="hint-line">Suggestions come from {nameOf(d, r.to)}'s {sys ? 'linked component' : 'component'}.</p>
        : !linked && <p className="hint-line">Link {nameOf(d, r.to)} to a component to get its endpoints here.</p>)}
    </div>
  );
}

function NoteFields({ d, r }: { d: SeqDoc; r: Extract<Row, { t: 'note' }> }) {
  const toggle = (id: string, on: boolean) => editRow(r.id, 'note', n => {
    n.over = on ? d.participants.map(p => p.id).filter(p => p === id || n.over.includes(p)) : n.over.filter(o => o !== id);
    if (!n.over.length) n.over = [id];
  });
  return (
    <div className="tab">
      <div className="props"><label className="wide">Text<textarea data-sqf="text" rows={3} value={r.text} {...field} onChange={e => editRow(r.id, 'note', n => { n.text = e.target.value; })} /></label></div>
      <div className="sq-over"><span>Over</span>
        {d.participants.map(p => (
          <label key={p.id} className="check"><input type="checkbox" data-sqover={p.id} checked={r.over.includes(p.id)} onChange={e => toggle(p.id, e.target.checked)} />{p.name}</label>
        ))}
      </div>
    </div>
  );
}

/** A block, from its header, one of its branches or its end. */
function BlockFields({ d, r }: { d: SeqDoc; r: Row }) {
  const rows = d.rows;
  let i = rows.indexOf(r);
  if (r.t !== 'open') { let depth = 0; for (let k = i; k >= 0; k--) { const x = rows[k]; if (x.t === 'close' && k !== i) depth++; else if (x.t === 'open') { if (depth === 0) { i = k; break; } depth--; } } }
  const open = rows[i];
  if (open?.t !== 'open') return null;
  const end = blockEnd(rows, i), inner = depthOf(rows, i) + 1;
  const branches = rows.slice(i + 1, end).filter((x, k) => x.t === 'else' && depthOf(rows, i + 1 + k) === inner) as Extract<Row, { t: 'else' }>[];
  const setKind = (kind: BlockKind) => {
    const next = rows.map(y => (y === open ? { ...open, kind } : y));
    if (!balanced(next)) { hint('Only alt and par can have branches; remove them first', 2200); return; }
    editRow(open.id, 'open', o => { o.kind = kind; });
  };
  const guard = (x: Extract<Row, { t: 'open' | 'else' }>, placeholder: string) => (
    <input data-sqb="guard" data-id={x.id} value={x.guard} placeholder={placeholder} {...field}
      onChange={e => change('sequence', dd => { const y = dd.rows.find(z => z.id === x.id); if (y && y.t !== 'msg' && y.t !== 'note' && y.t !== 'close') y.guard = e.target.value; })} />
  );
  return (
    <div className="tab">
      <div className="props">
        <label>Kind<select data-sqb="kind" data-id={open.id} value={open.kind} onChange={e => setKind(e.target.value as BlockKind)}>{BLOCK_KINDS.map(k => <option key={k} value={k}>{k}</option>)}</select></label>
        <label>{open.kind === 'loop' ? 'Repeats' : 'Condition'}{guard(open, open.kind === 'loop' ? 'for each item' : 'condition')}</label>
      </div>
      {(open.kind === 'alt' || open.kind === 'par') && (
        <div className="sq-branches"><span>{open.kind === 'alt' ? 'Other branches' : 'In parallel with'}</span>
          {branches.map(x => (
            <div key={x.id} className="sq-branch">{guard(x, open.kind === 'alt' ? 'else' : 'and')}
              <button type="button" className="x" data-sq={`rm-branch:${x.id}`} aria-label="Remove branch" onClick={() => removeRow(x.id)}>×</button>
            </div>
          ))}
          <button type="button" className="small" data-sq={`add-branch:${open.id}`} onClick={() => addBranch(open.id)}>+ {open.kind === 'alt' ? 'Else branch' : 'Parallel branch'}</button>
        </div>
      )}
      <p className="sq-actions"><button type="button" className="small" data-sq={`unwrap:${open.id}`} onClick={() => unwrap(open.id)}>Unwrap — keep the messages</button></p>
    </div>
  );
}

const TYPE_OPTIONS = () => [['', 'Participant'], ['actor', 'Actor'], ...Object.keys(TYPES).map(k => [k, typeDef(k).label])];

function ParticipantFields({ d, p, sys }: { d: SeqDoc; p: Participant; sys: LinkedSystem | null }) {
  const edit = (fn: (q: Participant) => void) => change('sequence', dd => { const q = dd.participants.find(x => x.id === p.id); if (q) fn(q); });
  const setRef = (ref: string) => {
    const n = sys?.doc.nodes.find(x => x.id === ref);
    edit(q => {
      if (!ref) { delete q.ref; return; }
      q.ref = ref;
      if (n) { q.type = n.kind; if (/^Participant \d+$/.test(q.name)) q.name = n.name; }
    });
  };
  const n = nodeOf(p, sys), res = n && sys!.res.nodes[n.id];
  const count = d.rows.filter(r => r.t === 'msg' && (r.from === p.id || r.to === p.id)).length;
  return (
    <div className="tab">
      <div className="props">
        <label className="wide">Name<input data-sqp="name" value={p.name} {...field} onChange={e => edit(q => { q.name = e.target.value || q.id; })} /></label>
        <label>Id (used in code)<input key={p.id} data-sqp="id" defaultValue={p.id} spellCheck={false}
          onBlur={e => { if (e.target.value.trim() !== p.id && !renameId(p.id, e.target.value.trim())) e.target.value = p.id; }}
          onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} /></label>
        <label>Type<select data-sqp="type" value={p.type ?? ''} onChange={e => edit(q => { if (e.target.value) q.type = e.target.value; else delete q.type; })}>
          {TYPE_OPTIONS().map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>
      </div>
      {sys ? (
        <>
          <div className="props"><label className="wide">Linked component in {sys.title}
            <select data-sqp="ref" value={p.ref ?? ''} onChange={e => setRef(e.target.value)}>
              <option value="">Not linked</option>
              {sys.doc.nodes.map(x => <option key={x.id} value={x.id}>{x.name} · {typeDef(x.kind).label}</option>)}
            </select></label></div>
          {n && res && <p className="hint-line">{n.name}: ~{fmtMs(res.lat)} at {Math.round(res.util * 100)}% load in the capacity model.</p>}
          {sys.key && <p><button type="button" className="small" data-sq="goto-system" onClick={() => void activate(sys.key!)}>Open {sys.title}</button></p>}
        </>
      ) : !d.uses && <p className="hint-line">Pick a system diagram for this sequence (with nothing selected) to link lifelines to its components.</p>}
      <p className="hint-line">{count} message{count === 1 ? '' : 's'}. ←/→ move the lifeline; drag its head to reorder.</p>
    </div>
  );
}

function DiagramFields({ d, sys }: { d: SeqDoc; sys: LinkedSystem | null }) {
  useTabs(s => s.list);   // the "Draws on" list follows the open tabs
  const cur = d.uses ? (tabFor(d.uses)?.key ?? '__other') : '';
  const setUses = (key: string) => {
    if (key === '__other') return;
    change('sequence', dd => { const u = key ? usesFor(key) : null; if (u) dd.uses = u; else delete dd.uses; });
  };
  const tm = sys && timing(d, sys.doc, sys.res);
  const canLinkByName = !!sys && d.participants.some(p => !nodeOf(p, sys) && sys.doc.nodes.some(n => n.name.toLowerCase() === p.name.toLowerCase() || n.name.toLowerCase() === p.id.toLowerCase()));
  return (
    <div className="tab">
      <div className="props">
        <label className="wide">Draws on<select data-sqd="uses" value={cur} onChange={e => setUses(e.target.value)}>
          <option value="">No system diagram</option>
          {systemTabs().map(t => <option key={t.key} value={t.key}>{t.title}</option>)}
          {cur === '__other' && <option value="__other">{(d.uses?.title ?? 'a diagram') + ' (not open)'}</option>}
        </select></label>
      </div>
      {tm && <p className="hint-line">{tm.linked} of {d.participants.length} lifelines linked. {tm.linked ? `End to end ~${fmtMs(tm.total)} from the capacity model.` : ''}</p>}
      {canLinkByName && <p><button type="button" className="small" data-sq="link-by-name" onClick={linkByName}>Link lifelines to components with the same name</button></p>}
      <div className="sq-tips"><strong>Drawing</strong><ul>
        <li>Drag from one lifeline to another to add a message where you let go; onto the same lifeline for a self-call.</li>
        <li>Drag a message up or down to move it; drag a head sideways to reorder lifelines.</li>
        <li>Double-click anything to edit its text. Shift-click messages, then Alt / Loop… to wrap them.</li>
        <li>Keys: P participant · C call · A async · R reply · N note · L loop · ↑/↓ move · Enter edit · Delete.</li>
      </ul></div>
    </div>
  );
}

/** Code and drawing are the same thing: edits in the text redraw the diagram while it parses. */
function CodeTab({ d }: { d: SeqDoc }) {
  const draft = useSeqUi(s => s.draft);
  const onChange = (text: string) => {
    // the editor following the document (undo, edits on the canvas) isn't an edit: recording it would wipe redo
    if (text === printSeq(docOf('sequence'))) { useSeqUi.setState({ draft: null }); return; }
    const p = parseSeq(text);
    if (p.errors.length) { useSeqUi.setState({ draft: text }); return; }
    useSeqUi.setState({ draft: null });
    const prev = docOf('sequence'), next = keepIds(prev, p.doc);
    if (!prev.participants.length && next.participants.length) requestAnimationFrame(() => fitView());
    change('sequence', dd => {
      dd.participants = next.participants; dd.rows = next.rows;
      if (next.uses) dd.uses = next.uses; else delete dd.uses;
    });
  };
  const errors = draft !== null ? parseSeq(draft).errors.length : 0;
  return (
    <div className="sq-code">
      <div onFocus={field.onFocus} onBlur={field.onBlur}>
        <CodeEditor className="cm-host sq-cm" value={printSeq(d)} latest={{ onChange, d }}
          mount={(code, host, value, latest) => code.mountSeq(host, {
            doc: value,
            onChange: t => latest.current.onChange(t),
            participants: () => latest.current.d.participants.map(p => p.id),
            labels: to => labelSuggestions(latest.current.d, to),
          })} />
      </div>
      <p className="sq-status">
        {draft !== null
          ? <><span className="bad">●</span> {errors} problem{errors === 1 ? '' : 's'} — the drawing keeps the last valid version</>
          : <><span className="good">●</span> {d.participants.length} lifeline{d.participants.length === 1 ? '' : 's'} · {d.rows.filter(r => r.t === 'msg').length} messages</>}
      </p>
      <p className="sq-help">Code and drawing are the same thing: edit either. <code>-&gt;</code> call, <code>--&gt;</code> reply, <code>-&gt;&gt;</code> async, <code>note over a: …</code>, <code>alt</code> / <code>else</code> / <code>end</code> (also <code>opt</code>, <code>loop</code>, <code>par</code>). Paste Mermaid or PlantUML to convert it.</p>
    </div>
  );
}
