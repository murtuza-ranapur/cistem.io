/** A component's panel: Capacity (its fields and live load numbers) and, for types with detail, its schema. */
import { CONTAINER_KINDS, LOAD_FIELDS, kindLabel, ancestry, detailOf, isSource, totalRps, typeDef, type Doc, type Node } from '../../../domain/model';
import { fmt, fmtMs } from '../../../lib/format';
import { select } from '../../../store/editor';
import { activate, peek, tabs, useTabs } from '../../../store/tabs';
import { Icon } from '../../../ui/Icon';
import { deleteNodes } from '../actions';
import { resultsOf, useSysDoc } from '../state';
import { CheckField, NumberField, SelectField, TextField, setField } from './controls';
import { usePanelUi, setPanelUi } from './ui';
import { ItemNotes, NotesLabel } from '../../../notes/ItemNotes';
import { SchemaTab } from './SchemaTab';
import { useLoadView } from '../../../store/loadView';
import { LogoField } from './LogoField';

const SCHEMA_LABEL: Record<string, string> = { endpoints: 'Endpoints', tables: 'Tables', topic: 'Topic', message: 'Message' };

export function NodePanel({ n }: { n: Node }) {
  const tab = usePanelUi(s => s.tab);
  const kind = /^[\w-]+$/.test(n.kind) ? n.kind : 'service';
  const dk = detailOf(n);
  const load = useLoadView(st => st.on);
  return (
    <>
      <div className="head">
        <span className="k" style={{ color: `var(--c-${kind})` }}><KindIcon kind={kind} />{kindLabel(n)}</span>
        <strong>{n.name}</strong><span className="spacer" />
        <button type="button" className="icon danger" data-action="delete-node" title="Delete (⌫)" aria-label="Delete" onClick={() => { deleteNodes([n.id]); select(null); }}>
          <Icon name="ic-trash" />
        </button>
      </div>
      <div className="tabs">
        <button type="button" data-tab="capacity" className={tab === 'capacity' ? 'on' : ''} onClick={() => setPanelUi({ tab: 'capacity' })}>{load ? 'Capacity' : 'Details'}</button>
        {dk && <button type="button" data-tab="schema" className={tab === 'schema' ? 'on' : ''} onClick={() => setPanelUi({ tab: 'schema' })}>{SCHEMA_LABEL[dk] ?? 'Detail'}</button>}
        <button type="button" data-tab="notes" className={tab === 'notes' ? 'on' : ''} onClick={() => setPanelUi({ tab: 'notes' })}><NotesLabel value={n.notes ?? ''} /></button>
      </div>
      {tab === 'notes' ? <ItemNotes type="node" id={n.id} value={n.notes ?? ''} />
        : tab === 'schema' && dk ? <SchemaTab n={n} /> : <CapacityTab n={n} />}
      <AppearsIn nodeId={n.id} />
    </>
  );
}

export const KindIcon = ({ kind, colour }: { kind: string; colour?: string }) => (
  <svg style={{ stroke: colour ?? `var(--c-${kind})`, fill: 'none', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }}><use href={`#ic-${kind}`} /></svg>
);

/** Environment picker options, indented by depth; `exclude` hides an environment and what's inside it. */
export function containerOptions(doc: Doc, exclude: string | null = null): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const walk = (parent: string | null) => {
    for (const c of doc.containers) {
      if ((c.parent ?? null) !== parent || (exclude && ancestry(doc, c.id).includes(exclude))) continue;
      out.push({ value: c.id, label: '  '.repeat(ancestry(doc, c.id).length - 1) + `${c.name} · ${CONTAINER_KINDS[c.kind].label}` });
      walk(c.id);
    }
  };
  walk(null);
  return out;
}

function CapacityTab({ n }: { n: Node }) {
  const doc = useSysDoc();
  const load = useLoadView(st => st.on);
  const opts = containerOptions(doc);
  const label = (v: string) => opts.find(o => o.value === v)?.label ?? v;
  // the type's own fields, as declared in shared/component-types.json
  const field = (f: ReturnType<typeof typeDef>['fields'][number]) => {
    const v = (n as unknown as Record<string, unknown>)[f.key];
    if (f.type === 'select') return <SelectField key={f.key} path={f.key} label={f.label} wide={f.wide} value={String(v ?? f.options?.[0] ?? '')} options={f.options ?? []} />;
    if (f.type === 'boolean') return <CheckField key={f.key} path={f.key} label={f.label} wide={f.wide} value={!!v} />;
    if (f.type === 'number') return <NumberField key={f.key} path={f.key} label={f.label} wide={f.wide} value={v} min={f.min} max={f.max} step={f.step} />;
    return <TextField key={f.key} path={f.key} label={f.label} wide={f.wide} value={String(v ?? '')} />;
  };
  const fields = typeDef(n.kind).fields;
  const loadFields = fields.filter(f => LOAD_FIELDS.has(f.key)), other = fields.filter(f => !LOAD_FIELDS.has(f.key));
  const numbers = isSource(n)
    ? <p className="note">Peak requests per second these clients send. The diagram is tested at the sum of all clients — {fmt(totalRps(doc))} rps — shown in the top bar.</p>
    : <Stats doc={doc} id={n.id} />;
  return (
    <div className="tab">
      <div className="props">
        <TextField path="name" label="name" wide value={n.name} required />
        <SelectField path="container" label="Environment" wide value={n.container ?? ''} empty="No environment" options={opts.map(o => o.value)} labelOf={label} />
        <LogoField n={n} />
        {(load ? fields : other).map(field)}
        {isSource(n) && <Platforms n={n} />}
      </div>
      {load ? numbers : loadFields.length > 0 && (
        <details className="loadsec" id="loadSection">
          <summary>Load model <span className="muted">· hidden on the canvas</span></summary>
          <div className="props">{loadFields.map(field)}</div>
          <p className="note">These feed the load simulation. Turn it on with the gauge in the top bar (L) to see rps, capacity and utilisation.</p>
        </details>
      )}
    </div>
  );
}

function Platforms({ n }: { n: Node }) {
  const ps = n.platforms || [];
  const flip = (p: string) => setField('platforms', ps.includes(p) ? ps.filter(x => x !== p) : [...ps, p]);
  return (
    <label className="wide">Platforms
      <div className="chips">
        {['web', 'app'].map(p => <button type="button" key={p} data-platform={p} className={ps.includes(p) ? 'on' : ''} onClick={() => flip(p)}>{p === 'web' ? 'Web' : 'App'}</button>)}
      </div>
    </label>
  );
}

/** Load / capacity / utilisation / latency tiles; they follow the fields as you type. */
function Stats({ doc, id }: { doc: Doc; id: string }) {
  const r = resultsOf(doc).nodes[id]; if (!r) return null;
  const pct = Number.isFinite(r.util) ? Math.round(r.util * 100) : 100;
  return (
    <>
      <div className="stats">
        <div className="stat-tile"><div className="l">Load</div><div className="v">{fmt(r.load)} <small>rps</small></div></div>
        <div className="stat-tile"><div className="l">Capacity</div><div className="v">{fmt(r.cap)} <small>rps</small></div></div>
        <div className={'stat-tile ' + r.status}><div className="l">Utilisation</div><div className="v">{Number.isFinite(r.util) ? pct + '%' : '∞'}</div></div>
        <div className="stat-tile"><div className="l">Effective latency</div><div className="v">{r.lat >= 1e4 ? fmtMs(r.lat) : <>{r.lat.toFixed(1)} <small>ms</small></>}</div></div>
        <div className={'meter ' + r.status}><i style={{ width: Math.min(100, pct) + '%' }} /></div>
      </div>
      <p className="note headroom">Headroom {Number.isFinite(r.cap) ? fmt(Math.max(0, r.cap - r.load)) + ' rps' : 'unlimited'}. Latency inflates as utilisation climbs (M/M/1 approximation).</p>
    </>
  );
}

/** Open sequences that use this component (as a linked lifeline). */
function AppearsIn({ nodeId }: { nodeId: string }) {
  const list = useTabs(s => s.list);
  const me = list.find(t => t.key === tabs().active);
  if (!me || me.kind !== 'system') return null;
  const seqs = list.flatMap(t => {
    if (t.kind !== 'sequence') return [];
    const p = peek(t.key);
    if (p?.open.kind !== 'sequence') return [];
    const u = p.open.doc.uses;
    if (!u || !((u.id && u.id === me.cloudId) || (u.tab && u.tab === me.key))) return [];
    return p.open.doc.participants.some(x => x.ref === nodeId) ? [{ key: t.key, title: p.title }] : [];
  });
  if (!seqs.length) return null;
  return (
    <div className="appears"><span>Appears in</span>
      {seqs.map(s => <button type="button" key={s.key} className="chip" data-opentab={s.key} onClick={() => void activate(s.key)}>⇅ {s.title}</button>)}
    </div>
  );
}
