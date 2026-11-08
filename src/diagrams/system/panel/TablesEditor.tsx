/**
 * A database's tables, as rows (read like the canvas node; click a row to edit its column) or as text
 * (DBML-style, with suggestions; text that doesn't parse is kept and the diagram keeps the last valid version).
 */
import { useState } from 'react';
import { detailOf, type Column, type Doc, type Node, type Table } from '../../../domain/model';
import { parseDbml, quickColumn, toDbml, PG_TYPE_LIST } from '../../../domain/dbml';
import { CodeEditor } from '../../../editor/CodeEditor';
import { Icon } from '../../../ui/Icon';
import { edit, sysDoc, useSysDoc } from '../state';
import { AddButton, DataList } from './controls';
import { setField } from './controls';
import { editItem, getPath, refLabel, refResolver, setPath } from './paths';
import { focusInPanel, panelUi, setDraft, setPanelUi, usePanelUi } from './ui';

/** Replace a database's tables (by node id, so the large editor can use it too). */
const setTables = (nodeId: string, tables: Table[]) => edit(d => { const n = d.nodes.find(x => x.id === nodeId); if (n) n.tables = tables; });

/** The DBML editor's options (the panel's and the large one's). */
export function mountTables(nodeId: string, big = false) {
  return (code: typeof import('../../../editor/code'), host: HTMLElement, value: string) => {
    const doc = sysDoc();
    return code.mountDbml(host, {
      big, doc: value, resolver: refResolver(doc),
      externalTargets: () => { const d = sysDoc(); return d.nodes.filter(x => detailOf(x) === 'tables' && x.id !== nodeId).flatMap(x => (x.tables || []).flatMap(t => (t.columns || []).filter(c => c.pk).map(c => `${x.name}.${t.name}.${c.name}`))); },
      onChange: text => {
        const p = parseDbml(text, refResolver(sysDoc()));
        if (p.errors.length) setDraft(nodeId, text);
        else { setDraft(nodeId, null); setTables(nodeId, p.tables); }
      },
    });
  };
}
export const tablesText = (doc: Doc, n: Node) => panelUi().dbDrafts[n.id] ?? toDbml(n.tables || [], refResolver(doc));

export function TablesEditor({ n }: { n: Node }) {
  const doc = useSysDoc();
  const mode = usePanelUi(s => s.tableMode[n.id] ?? 'rows');
  const draft = usePanelUi(s => s.dbDrafts[n.id]);
  const ts = n.tables || [];
  const setMode = (m: 'rows' | 'code') => {
    if (m === 'rows') setDraft(n.id, null);
    setPanelUi(s => ({ tableMode: { ...s.tableMode, [n.id]: m }, openCol: '' }));
  };
  const addTable = () => {
    editItem(it => { (it.tables ??= []).push({ name: 'new_table', columns: [{ name: 'id', type: 'uuid', pk: true, nullable: false }] }); });
    focusInPanel(`[data-t="${ts.length}"] .tname`);
  };
  return (
    <section className="list">
      <h3>Tables <span className="spacer" />
        <span className="seg">
          <button type="button" data-tblmode="rows" className={mode === 'rows' ? 'on' : ''} onClick={() => setMode('rows')}>Rows</button>
          <button type="button" data-tblmode="code" className={mode === 'code' ? 'on' : ''} onClick={() => setMode('code')}>Code</button>
        </span>
        {mode === 'code'
          ? <button type="button" className="fe-tool" data-tblexpand title="Open larger" aria-label="Open larger" onClick={() => setPanelUi({ big: { t: 'tables' } })}><Icon name="ic-expand" /></button>
          : <AddButton action="add-table" label="table" onClick={addTable} />}
      </h3>
      {mode === 'code' ? <>
        <CodeEditor value={draft ?? toDbml(ts, refResolver(doc))} latest={null} mount={mountTables(n.id)} attrs={{ 'data-cmdb': n.id }} />
        <p className="tbl-status" data-tblstatus><TableStatus doc={doc} n={n} draft={draft} /></p>
        <p className="tbl-hint">Type <code>name type</code> per column; flags in <code>[pk, unique, index, default: …, ref: &gt; table.col]</code>; <code>?</code> after a type = nullable. Paste <code>CREATE TABLE</code> SQL to convert it.</p>
      </> : <>
        {ts.map((t, i) => <TableCard key={i} doc={doc} n={n} t={t} i={i} />)}
        {!ts.length && <p className="empty">No tables yet.</p>}
      </>}
      <DataList id="pgTypes" values={PG_TYPE_LIST} />
    </section>
  );
}

export function TableStatus({ doc, n, draft }: { doc: Doc; n: Node; draft?: string }) {
  if (draft !== undefined) {
    const e = parseDbml(draft, refResolver(doc)).errors.length;
    return <><span className="bad">●</span> {e} problem{e === 1 ? '' : 's'} — the diagram keeps the last valid version</>;
  }
  const ts = n.tables || [], cols = ts.reduce((a, t) => a + (t.columns || []).length, 0);
  return <><span className="good">●</span> {ts.length} table{ts.length === 1 ? '' : 's'} · {cols} columns</>;
}

function TableCard({ doc, n, t, i }: { doc: Doc; n: Node; t: Table; i: number }) {
  const openCol = usePanelUi(s => s.openCol);
  const cols = t.columns || [];
  return (
    <div className="tcard" data-t={i}>
      <div className="thead">
        <input className="tname" data-path={`tables.${i}.name`} value={t.name} placeholder="table_name" spellCheck={false} aria-label="Table name" onChange={e => setField(`tables.${i}.name`, e.target.value)} />
        <span className="tcount">{cols.length} column{cols.length === 1 ? '' : 's'}</span>
        <button type="button" className="icon danger tdel" data-action={`rm-table:${i}`} title="Delete table" aria-label="Delete table"
          onClick={() => { editItem(it => { it.tables.splice(i, 1); }); setPanelUi({ openCol: '' }); }}><Icon name="ic-trash" /></button>
      </div>
      {cols.map((c, j) => {
        const key = `${n.id}:${i}:${j}`;
        return openCol === key ? <ColumnEditor key={j} doc={doc} n={n} t={t} c={c} i={i} j={j} /> : <ColumnRow key={j} doc={doc} c={c} k={key} />;
      })}
      <AddColumn n={n} i={i} />
    </div>
  );
}

function ColumnRow({ doc, c, k }: { doc: Doc; c: Column; k: string }) {
  return (
    <button type="button" className="trow" data-opencol={k} title="Edit column" onClick={() => { setPanelUi({ openCol: k }); focusInPanel('.tedit .cname'); }}>
      <span className="tkey">{c.pk && <Icon name="ic-key" />}</span>
      <span className="tn"><span className="tnm">{c.name || <em>unnamed</em>}</span><span className="tty">{c.type}{c.nullable && !c.pk ? '?' : ''}</span></span>
      <span className="ttags">
        {c.references && <span className="tag fk">→ {refLabel(doc, c.references)}</span>}
        {c.unique && <span className="tag uq">UQ</span>}
        {c.index && <span className="tag ix">IX</span>}
        {c.default && <span className="tdef">= {c.default}</span>}
      </span>
    </button>
  );
}

/** Flip a column flag; a primary key is never null, and allowing null drops the primary key. */
function flip(path: string) {
  editItem(it => {
    const v = !getPath(it, path), col = path.replace(/\.[a-z]+$/, '');
    setPath(it, path, v);
    if (path.endsWith('.pk') && v) setPath(it, col + '.nullable', false);
    if (path.endsWith('.nullable') && v && getPath(it, col + '.pk')) setPath(it, col + '.pk', false);
  });
}

function ColumnEditor({ doc, n, t, c, i, j }: { doc: Doc; n: Node; t: Table; c: Column; i: number; j: number }) {
  const base = `tables.${i}.columns.${j}`;
  // references: other tables' columns here, and primary keys in other databases
  const targets: string[] = [];
  for (const ot of n.tables || []) if (ot !== t) for (const oc of ot.columns || []) targets.push(`${ot.name}.${oc.name}`);
  for (const on of doc.nodes) if (detailOf(on) === 'tables' && on.id !== n.id) for (const ot of on.tables || []) for (const oc of ot.columns || []) if (oc.pk) targets.push(`${on.id}:${ot.name}.${oc.name}`);
  const refOpts = ['', ...(c.references && !targets.includes(c.references) ? [c.references] : []), ...targets];
  const close = () => setPanelUi({ openCol: '' });
  const pill = (prop: string, label: string, on: boolean, cls: string) =>
    <button type="button" className={`pill ${cls}${on ? ' on' : ''}`} data-flip={`${base}.${prop}`} aria-pressed={on} onClick={() => flip(`${base}.${prop}`)}>{label}</button>;
  return (
    <div className="tedit" data-col={`${i}:${j}`}
      onKeyDown={e => { if ((e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'SELECT') || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <div className="te2">
        <label>Name<input className="cname" data-path={`${base}.name`} value={c.name} spellCheck={false} onChange={e => setField(`${base}.name`, e.target.value)} /></label>
        <label>Type<input className="ctype" data-path={`${base}.type`} value={c.type} list="pgTypes" spellCheck={false} onChange={e => setField(`${base}.type`, e.target.value)} /></label>
      </div>
      <div className="pills">
        {pill('pk', 'Primary key', c.pk, 'pk')}
        <button type="button" className={'pill nn' + (!c.nullable ? ' on' : '')} data-flip={`${base}.nullable`} aria-pressed={!c.nullable} onClick={() => flip(`${base}.nullable`)}>Not null</button>
        {pill('unique', 'Unique', !!c.unique, 'uq')}
        {pill('index', 'Index', !!c.index, 'ix')}
      </div>
      <div className="te2 wide">
        <label>References
          <select data-path={`${base}.references`} value={c.references ?? ''} onChange={e => setField(`${base}.references`, e.target.value || null)}>
            {refOpts.map(o => <option key={o} value={o}>{o ? refLabel(doc, o) : 'none'}</option>)}
          </select>
        </label>
        <label>Default<input data-path={`${base}.default`} value={c.default ?? ''} placeholder="now()" spellCheck={false} onChange={e => setField(`${base}.default`, e.target.value)} /></label>
      </div>
      <div className="tefoot">
        <button type="button" className="linkish danger" data-action={`rm-column:${i}:${j}`} onClick={() => { editItem(it => { it.tables[i].columns.splice(j, 1); }); close(); }}>Delete column</button>
        <button type="button" className="small primary" data-closecol onClick={close}>Done ↵</button>
      </div>
    </div>
  );
}

/** Add a column by typing one line ("refunded_at timestamptz?"); a line that isn't a column says why. */
function AddColumn({ n, i }: { n: Node; i: number }) {
  const [text, setText] = useState(''), [error, setError] = useState('');
  const add = () => {
    if (!text.trim()) return;
    const r = quickColumn(text, refResolver(sysDoc()));
    if (!r.col) { setError(r.error ?? 'Not a column'); return; }
    if ((n.tables?.[i]?.columns ?? []).some(c => c.name === r.col!.name)) { setError(`There's already a column "${r.col.name}"`); return; }
    const col = r.col;
    editItem(it => { it.tables[i].columns.push(col); });
    setText('');
  };
  return (
    <>
      <div className="tadd">
        <span aria-hidden="true">+</span>
        <input data-addcol={i} className={error ? 'bad' : undefined} value={text} placeholder="add column — e.g. refunded_at timestamptz?" spellCheck={false} aria-label="Add column"
          onChange={e => { setText(e.target.value); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
      </div>
      <p className="tadd-err" data-adderr={i} hidden={!error}>{error}</p>
    </>
  );
}
