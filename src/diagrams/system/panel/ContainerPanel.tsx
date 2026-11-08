/** An environment's panel: name, kind, nesting, look, and links to other environments (with their latency). */
import { CONTAINER_COLORS, CONTAINER_KINDS, CROSSING_DEFAULT_MS, LINK_TYPES, ancestry, type Container, type ContainerKind } from '../../../domain/model';
import { capitalise } from '../../../lib/format';
import { select } from '../../../store/editor';
import { Icon } from '../../../ui/Icon';
import { deleteContainer } from '../actions';
import { edit, freshId, sysDoc, useSysDoc } from '../state';
import { AddButton, NumberField, RemoveButton, SelectField, TextField } from './controls';
import { editItem, setPath } from './paths';
import { KindIcon, containerOptions } from './NodePanel';

/** Fields of a link live on the document, not on the environment. */
function setLink(path: string, v: unknown) {
  edit(d => {
    setPath(d, path, v);
    // picking a link type sets its typical latency
    if (path.endsWith('.type') && typeof v === 'string' && v in LINK_TYPES) d.links[+path.split('.')[1]].latencyMs = LINK_TYPES[v];
  });
}
const STYLE_DEFAULTS: Record<string, string> = { color: '', fill: 'tint', border: 'dashed' };
function setStyle(prop: 'color' | 'fill' | 'border', val: string) {
  editItem(c => { if (!val || val === STYLE_DEFAULTS[prop]) delete c[prop]; else c[prop] = val; });
}

export function ContainerPanel({ c }: { c: Container }) {
  const doc = useSysDoc();
  const kind = CONTAINER_KINDS[c.kind], colour = `hsl(${kind.hue} 45% 45%)`;
  const members = doc.nodes.filter(n => (n.container ?? null) === c.id).length;
  const nested = doc.containers.filter(k => (k.parent ?? null) === c.id).length;
  const links = doc.links.map((l, i) => ({ l, i })).filter(({ l }) => l.from === c.id || l.to === c.id);
  const inside = containerOptions(doc, c.id), insideLabel = (v: string) => inside.find(o => o.value === v)?.label ?? v;
  const path = ancestry(doc, c.id).reverse().map(id => doc.containers.find(x => x.id === id)?.name ?? id).join(' / ');
  const addLink = () => {
    const d = sysDoc(), other = d.containers.find(x => x.id !== c.id && !ancestry(d, x.id).includes(c.id));
    if (!other) return;
    const id = freshId(d, 'l');
    edit(dd => { dd.links.push({ id, from: c.id, to: other.id, type: 'privatelink', latencyMs: LINK_TYPES.privatelink }); });
  };
  return (
    <>
      <div className="head">
        <span className="k" style={{ color: colour }}><KindIcon kind="container" colour={colour} />{kind.label}</span>
        <strong>{c.name}</strong><span className="spacer" />
        <button type="button" className="icon danger" data-action="delete-container" title="Delete (members stay)" aria-label="Delete" onClick={() => { deleteContainer(c.id); select(null); }}>
          <Icon name="ic-trash" />
        </button>
      </div>
      <div className="tab">
        <div className="props">
          <TextField path="name" label="name" wide value={c.name} required />
          <SelectField path="kind" label="kind" value={c.kind} options={Object.keys(CONTAINER_KINDS)} labelOf={k => CONTAINER_KINDS[k as ContainerKind].label} />
          <SelectField path="parent" label="Inside" value={c.parent ?? ''} empty="Top level" options={inside.map(o => o.value)} labelOf={insideLabel} />
          <TextField path="provider" label="provider" value={c.provider ?? ''} placeholder="aws · ibm · gcp · on-prem" />
          <TextField path="owner" label="owner" value={c.owner ?? ''} placeholder="team or company" />
          <TextField path="note" label="note" wide value={c.note ?? ''} />
        </div>
        <Look c={c} />
        <div className="stats">
          <div className="stat-tile"><div className="l">Components</div><div className="v">{members}</div></div>
          <div className="stat-tile"><div className="l">Nested</div><div className="v">{nested}</div></div>
        </div>
        {c.parent && <p className="note">{path}</p>}
        <section className="list" style={{ marginTop: 14 }}>
          <h3>Links to other environments <span className="spacer" /><AddButton action="add-link" label="link" onClick={addLink} /></h3>
          {links.map(({ l, i }) => {
            const end = l.from === c.id ? 'to' : 'from', other = l.from === c.id ? l.to : l.from;
            const opts = containerOptions(doc, c.id);
            const types = Object.keys(LINK_TYPES).includes(l.type) ? Object.keys(LINK_TYPES) : [l.type, ...Object.keys(LINK_TYPES)];
            return (
              <div className="item" key={l.id}>
                <div className="row topic">
                  <SelectField path={`links.${i}.${end}`} label="To" value={other} options={opts.map(o => o.value)} labelOf={v => opts.find(o => o.value === v)?.label ?? v} onSave={setLink} />
                  <SelectField path={`links.${i}.type`} label="type" value={l.type} options={types} onSave={setLink} />
                  <RemoveButton action={`rm-link:${i}`} onClick={() => edit(d => { d.links.splice(i, 1); })} />
                </div>
                <div className="row one">
                  <NumberField path={`links.${i}.latencyMs`} label="Added latency (ms)" value={l.latencyMs} min={0} onSave={setLink} />
                  <span />
                </div>
              </div>
            );
          })}
          {!links.length && <p className="empty">No links. Calls out of here cost {CROSSING_DEFAULT_MS.siblings} ms to a sibling and {CROSSING_DEFAULT_MS.differentRoots} ms to another cloud unless a link says otherwise.</p>}
        </section>
      </div>
    </>
  );
}

/** Colour, fill and border of the frame. */
function Look({ c }: { c: Container }) {
  const hue = CONTAINER_KINDS[c.kind].hue;
  const swatch = (key: string, hsl: string, title: string) => {
    const on = (c.color ?? '') === key;
    return <button type="button" key={key || 'default'} className={'swatch' + (on ? ' on' : '')} data-cstyle={`color:${key}`} style={{ '--sw': hsl } as React.CSSProperties}
      title={title} aria-label={title} aria-pressed={on} onClick={() => setStyle('color', key)} />;
  };
  const seg = (prop: 'fill' | 'border', cur: string, opts: [string, string][]) => (
    <span className="seg">{opts.map(([v, l]) => (
      <button type="button" key={v} data-cstyle={`${prop}:${v}`} className={cur === v ? 'on' : ''} aria-pressed={cur === v} onClick={() => setStyle(prop, v)}>{l}</button>
    ))}</span>
  );
  return (
    <div className="look">
      <div className="look-row"><span className="look-l">Colour</span>
        <span className="swatches">
          {swatch('', `hsl(${hue} 45% 55%)`, `Default for ${CONTAINER_KINDS[c.kind].label}`)}
          {(Object.keys(CONTAINER_COLORS) as (keyof typeof CONTAINER_COLORS)[]).map(k => swatch(k, `hsl(${CONTAINER_COLORS[k].h} ${CONTAINER_COLORS[k].s}% 55%)`, capitalise(k)))}
        </span>
      </div>
      <div className="look-row"><span className="look-l">Fill</span>{seg('fill', c.fill ?? 'tint', [['tint', 'Tinted'], ['solid', 'Solid'], ['outline', 'Outline']])}</div>
      <div className="look-row"><span className="look-l">Border</span>{seg('border', c.border ?? 'dashed', [['dashed', 'Dashed'], ['solid', 'Solid']])}</div>
    </div>
  );
}
