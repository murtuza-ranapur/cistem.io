/**
 * A request/response body (JSON) or an Avro schema. Stored as text; shown as code (CodeMirror, the default)
 * or as a tree of fields — name · type · example / nullable — that writes the text back on every change.
 * Anything the tree can't express keeps the Fields view disabled.
 */
import { Fragment, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { parseJsonFields, jsonFieldsToText, parseAvro, avroToText, listAt, J_TYPES, A_TYPES, type JField, type AField, type JType, type ARecord } from '../../../domain/fields';
import { CodeEditor, loadCode } from '../../../editor/CodeEditor';
import { Icon } from '../../../ui/Icon';
import { sysDoc } from '../state';
import { bodyVocab, editItem, getPath, setPath } from './paths';
import { focusInPanel, setPanelUi, usePanelUi } from './ui';

type Kind = 'json' | 'avro';
interface Props { nodeId: string; path: string; label: string; text: string; kind: Kind }

/** Save the text behind an editor. */
export const saveText = (path: string, text: string) => editItem(it => setPath(it, path, text));

/** The code editor options for a body or schema (shared with the large editor). */
export function mountBody(kind: Kind, nodeId: string, path: string, big = false) {
  return (code: typeof import('../../../editor/code'), host: HTMLElement, value: string) =>
    code.mountCode(host, { kind, big, doc: value, onChange: t => saveText(path, t), vocab: () => bodyVocab(sysDoc(), nodeId) });
}

export function FieldEditor({ nodeId, path, label, text, kind }: Props) {
  const key = nodeId + ':' + path;
  const parsed = kind === 'json' ? parseJsonFields(text) : parseAvro(text);
  const stored = usePanelUi(s => s.fieldMode[key]);
  const mode = parsed ? stored ?? 'code' : 'code';
  const view = useRef<EditorView | null>(null);
  const setMode = (m: 'code' | 'fields') => setPanelUi(s => ({ fieldMode: { ...s.fieldMode, [key]: m } }));
  const format = () => { const v = view.current; if (v) void loadCode().then(m => { m.formatJson(v); v.focus(); }); };
  return (
    <div className="fe" data-fe={path} data-kind={kind}>
      <div className="fe-head">
        <span>{label}</span><span className="spacer" />
        <button type="button" data-femode="code" className={mode === 'code' ? 'on' : ''} onClick={() => setMode('code')}>Code</button>
        <button type="button" data-femode="fields" className={mode === 'fields' ? 'on' : ''} disabled={!parsed} onClick={() => setMode('fields')}
          title={parsed ? undefined : kind === 'json' ? 'Fields view needs a JSON object at the top level' : 'Fields view handles records with primitive, logical, enum, array, map and nested record types'}>Fields</button>
        {mode === 'code' && <>
          <button type="button" className="fe-tool" data-feformat title="Format (⇧⌥F)" aria-label="Format" onClick={format}>{'{ }'}</button>
          <button type="button" className="fe-tool" data-feexpand title="Open larger" aria-label="Open larger" onClick={() => setPanelUi({ big: { t: 'field', path, kind, label } })}><Icon name="ic-expand" /></button>
        </>}
      </div>
      {mode === 'code'
        ? <CodeEditor value={text} latest={null} mount={mountBody(kind, nodeId, path)} onReady={v => { view.current = v; }} />
        : kind === 'json'
          ? <JsonTree path={path} fields={parsed as JField[]} />
          : <AvroTree path={path} rec={parsed as ARecord} />}
    </div>
  );
}

// ---------- the field tree ----------

/** Apply `fn` to the parsed tree behind an editor and write the text back (one undo step per call). */
function editTree(path: string, kind: Kind, fn: (root: any[], rec: ARecord | null) => void) {
  editItem(it => {
    const text = getPath(it, path) ?? '';
    if (kind === 'json') { const fs = parseJsonFields(text); if (fs) { fn(fs, null); setPath(it, path, jsonFieldsToText(fs)); } }
    else { const r = parseAvro(text); if (r) { fn(r.fields, r); setPath(it, path, avroToText(r)); } }
  });
}
const fieldAt = (root: any[], fpath: string) => { const idx = fpath.split('.'); const last = idx.pop()!; return listAt(root, idx.join('.'))[+last]; };
const parentPath = (p: string) => p.split('.').slice(0, -1).join('.');

/** Change one property of the field at `fpath`; type changes add what the new type needs. */
function setProp(path: string, kind: Kind, fpath: string, k: string, v: unknown) {
  editTree(path, kind, (root, rec) => {
    if (k === 'recname') { rec!.name = v as string; return; }
    if (k === 'namespace') { rec!.namespace = v as string; return; }
    const f = fieldAt(root, fpath);
    f[k] = v;
    if (k === 'type') {
      if (kind === 'json') { if (v === 'array' && !f.items) f.items = 'string'; if (v === 'object' || (v === 'array' && f.items === 'object')) f.children ??= []; }
      else if (v === 'array' || v === 'map') f.items ??= 'string';
      else if (v === 'record') f.children ??= [];
    }
    if (k === 'items' && (v === 'object' || v === 'record')) f.children ??= [];
  });
}
function addField(path: string, kind: Kind, list: string) {
  let at = 0;
  editTree(path, kind, root => {
    const l = listAt(root, list);
    l.push(kind === 'json' ? { name: '', type: 'string', example: '' } : { name: '', type: 'string', nullable: false });
    at = l.length - 1;
  });
  focusInPanel(`[data-fe="${path}"] [data-fpath="${list ? `${list}.${at}` : at}"] input.fname`);
}
const removeField = (path: string, kind: Kind, fpath: string) =>
  editTree(path, kind, root => { listAt(root, parentPath(fpath)).splice(+fpath.split('.').pop()!, 1); });

/** A text box that keeps what you type while it has focus (the stored text may normalise it). */
function Draft({ value, onSave, ...rest }: { value: string; onSave: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input {...rest} value={draft ?? value} onChange={e => { setDraft(e.target.value); onSave(e.target.value); }} onBlur={() => setDraft(null)} />;
}
const Options = ({ list }: { list: readonly string[] }) => <>{list.map(o => <option key={o} value={o}>{o}</option>)}</>;
const AddRow = ({ path, kind, list, depth }: { path: string; kind: Kind; list: string; depth: number }) => (
  <div className="fe-row add" style={{ '--d': depth } as React.CSSProperties}>
    <button type="button" className="small" data-feact="add" data-flist={list} onClick={() => addField(path, kind, list)}>+ field</button>
  </div>
);

const SCALARS: JType[] = ['string', 'number', 'integer', 'boolean', 'null'];

function JsonTree({ path, fields }: { path: string; fields: JField[] }) {
  return <><JsonRows path={path} fields={fields} parent="" depth={0} /><AddRow path={path} kind="json" list="" depth={0} /></>;
}
function JsonRows({ path, fields, parent, depth }: { path: string; fields: JField[]; parent: string; depth: number }) {
  return <>{fields.map((f, i) => {
    const p = parent ? `${parent}.${i}` : String(i);
    const t = f.type === 'array' ? (f.items || 'string') : f.type, nested = t === 'object';
    const set = (k: string, v: unknown) => setProp(path, 'json', p, k, v);
    return (
      <Fragment key={p}>
        <div className={'fe-row' + (nested ? ' nested' : '')} style={{ '--d': depth } as React.CSSProperties} data-fpath={p}>
          <Draft data-fk="name" className="fname" placeholder="field" value={f.name} onSave={v => set('name', v)} />
          <select data-fk="type" value={f.type} onChange={e => set('type', e.target.value)}><Options list={J_TYPES} /></select>
          {f.type === 'array' && <select data-fk="items" title="item type" value={t} onChange={e => set('items', e.target.value)}><Options list={[...SCALARS, 'object']} /></select>}
          {SCALARS.includes(t as JType) && t !== 'null'
            ? <Draft data-fk="example" className="fex" placeholder="example" value={String(f.example ?? '')} onSave={v => set('example', v)} />
            : !nested && <span />}
          <button type="button" className="x" data-feact="rm" aria-label="Remove" onClick={() => removeField(path, 'json', p)}>×</button>
        </div>
        {nested && <><JsonRows path={path} fields={f.children || []} parent={p} depth={depth + 1} /><AddRow path={path} kind="json" list={p} depth={depth + 1} /></>}
      </Fragment>
    );
  })}</>;
}

function AvroTree({ path, rec }: { path: string; rec: ARecord }) {
  return <>
    <div className="row rec">
      <label>Record<Draft data-fk="recname" placeholder="PaymentAuthorised" value={rec.name} onSave={v => setProp(path, 'avro', '', 'recname', v)} /></label>
      <label>Namespace<Draft data-fk="namespace" placeholder="com.example" value={rec.namespace} onSave={v => setProp(path, 'avro', '', 'namespace', v)} /></label>
    </div>
    <AvroRows path={path} fields={rec.fields} parent="" depth={0} />
    <AddRow path={path} kind="avro" list="" depth={0} />
  </>;
}
function AvroRows({ path, fields, parent, depth }: { path: string; fields: AField[]; parent: string; depth: number }) {
  return <>{fields.map((f, i) => {
    const p = parent ? `${parent}.${i}` : String(i);
    const t = f.type === 'array' || f.type === 'map' ? (f.items || 'string') : f.type, nested = t === 'record';
    const set = (k: string, v: unknown) => setProp(path, 'avro', p, k, v);
    const d = { '--d': depth } as React.CSSProperties;
    return (
      <Fragment key={p}>
        <div className={'fe-row avro' + (nested ? ' nested' : '')} style={d} data-fpath={p}>
          <Draft data-fk="name" className="fname" placeholder="field" value={f.name} onSave={v => set('name', v)} />
          <select data-fk="type" value={f.type} onChange={e => set('type', e.target.value)}><Options list={A_TYPES} /></select>
          {(f.type === 'array' || f.type === 'map') && (
            <select data-fk="items" title={f.type === 'array' ? 'item type' : 'value type'} value={t} onChange={e => set('items', e.target.value)}>
              <Options list={A_TYPES.filter(x => x !== 'array' && x !== 'map' && x !== 'enum')} />
            </select>
          )}
          <label className="check" title="nullable: union with null"><input type="checkbox" data-fk="nullable" checked={!!f.nullable} onChange={e => set('nullable', e.target.checked)} />null</label>
          <button type="button" className="x" data-feact="rm" aria-label="Remove" onClick={() => removeField(path, 'avro', p)}>×</button>
        </div>
        {f.type === 'enum' && <div className="fe-row sub1" style={d} data-fpath={p}><Draft data-fk="symbols" placeholder="symbols: NEW, PAID, FAILED" value={f.symbols ?? ''} onSave={v => set('symbols', v)} /></div>}
        {nested && <>
          <div className="fe-row sub1" style={d} data-fpath={p}><Draft data-fk="typeName" placeholder="record name (e.g. Line)" value={f.typeName ?? ''} onSave={v => set('typeName', v)} /></div>
          <AvroRows path={path} fields={f.children || []} parent={p} depth={depth + 1} />
          <AddRow path={path} kind="avro" list={p} depth={depth + 1} />
        </>}
      </Fragment>
    );
  })}</>;
}
