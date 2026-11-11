/**
 * A connection's panel: its label, the endpoint it calls, whether its notes show on the line, its style, and —
 * with the load view on — calls per request and what it carries.
 */
import { detailOf, typeDef, edgeCalls, qty, type Edge } from '../../../domain/model';
import { fmt, fmtCalls } from '../../../lib/format';
import { select } from '../../../store/editor';
import { useLoadView } from '../../../store/loadView';
import { Icon } from '../../../ui/Icon';
import { deleteEdge } from '../actions';
import { edit, findNode, resultsOf, useSysDoc } from '../state';
import { NotesSection } from '../../../notes/ItemNotes';
import { hasNotes } from '../../../domain/notes';
import { CheckField, NumberField, TextAreaField } from './controls';
import { Seg, StyleRow, Swatches } from './StyleControls';

const LineIcon = ({ dash, cap }: { dash?: string; cap?: boolean }) =>
  <svg width="22" height="8" aria-hidden="true"><path d="M2 4h18" stroke="currentColor" strokeWidth="2" strokeDasharray={dash} strokeLinecap={cap ? 'round' : undefined} /></svg>;
const ArrowIcon = ({ start, end }: { start?: boolean; end?: boolean }) => (
  <svg width="26" height="10" viewBox="0 0 26 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M3 5h20" />{end && <path d="M18 1.5L23 5l-5 3.5" />}{start && <path d="M8 1.5L3 5l5 3.5" />}
  </svg>
);

/** Tick each endpoint the connection calls; with the load view on, each gets its own calls per request. */
function EndpointPicker({ e, eps, target, load, set }: { e: Edge; eps: { method: string; path: string }[]; target: string; load: boolean; set(f: (x: Edge) => void): void }) {
  const picked = new Map((e.endpoints ?? []).map(x => [x.i, x.calls]));
  const toggle = (i: number) => set(x => {
    const list = (x.endpoints ?? []).filter(y => y.i !== i);
    if (!picked.has(i)) list.push({ i, calls: list.length ? 1 : (qty(x.calls) || 1) });
    list.sort((p, q) => p.i - q.i);
    if (list.length) { x.endpoints = list; x.calls = edgeCalls(x); } else { delete x.endpoints; }
  });
  const setCalls = (i: number, v: string) => set(x => {
    const y = x.endpoints?.find(z => z.i === i); if (!y) return;
    y.calls = qty(v); x.calls = edgeCalls(x);
  });
  return (
    <div className="wide ep-pick" id="endpointPicker">
      <div className="ep-pick-h"><span>Endpoints called <span className="muted">· from {target}</span></span>{load && <span className="muted">calls / request</span>}</div>
      {eps.map((ep, i) => {
        const on = picked.has(i);
        return (
          <div key={i} className={'ep-pick-row' + (on ? ' on' : '')}>
            <label>
              <input type="checkbox" data-endpoint-pick={i} checked={on} onChange={() => toggle(i)} />
              <span className={'method m-' + ep.method.toLowerCase()}>{ep.method}</span>
              <span className="ep-path">{ep.path}</span>
            </label>
            {load && on && <input type="number" min={0} step="any" className="ep-calls" data-endpoint-calls={i} aria-label={`Calls per request to ${ep.method} ${ep.path}`}
              value={picked.get(i) ?? 0} onChange={ev => setCalls(i, ev.target.value)} />}
          </div>
        );
      })}
      <p className="note">{e.endpoints?.length ? 'Tick every endpoint this component calls.' : 'None ticked: the endpoint isn’t specified.'}</p>
    </div>
  );
}

export function EdgePanel({ e }: { e: Edge }) {
  const doc = useSysDoc();
  const load = useLoadView(s => s.on);
  const a = findNode(doc, e.from), b = findNode(doc, e.to);
  if (!a || !b) return null;
  const eps = detailOf(b) === 'endpoints' ? b.endpoints ?? [] : [];
  const behaviour = typeDef(a.kind).behaviour;
  const set = (f: (x: Edge) => void) => edit(d => { const x = d.edges.find(y => y.id === e.id); if (x) f(x); });
  const styled = !!(e.line || e.color || e.width || e.arrows);
  // crossing an environment draws dashed unless a pattern is picked
  const lineDefault = resultsOf(doc).crossings?.[e.id] ? 'dashed' : 'solid';
  const listed = !!e.endpoints?.length;
  // with endpoints ticked, calls are per endpoint and the connection's are their sum
  const calls = listed
    ? <div className="wide calls-total" id="callsTotal">Calls per incoming request <b>{fmtCalls(edgeCalls(e))}</b> <span className="muted">· the sum over its endpoints</span></div>
    : <NumberField path="calls" label="Calls per incoming request" wide value={e.calls} min={0} />;
  const notes = (
    <>
      {behaviour === 'cache' && <p className="note">Only cache misses travel down this edge.</p>}
      {behaviour === 'balancer' && <p className="note">The {typeDef(a.kind).label.toLowerCase()} splits its traffic evenly across outgoing edges.</p>}
    </>
  );
  return (
    <>
      <div className="head">
        <span className="k">Connection</span><strong>{a.name} → {b.name}</strong><span className="spacer" />
        <button type="button" className="icon danger" data-action="delete-edge" title="Delete" aria-label="Delete" onClick={() => { deleteEdge(e.id); select(null); }}>
          <Icon name="ic-trash" />
        </button>
      </div>
      <div className="tab">
        <div className="props">
          <TextAreaField path="label" label="Label · shown on the line (Enter for a new line)" wide rows={1} value={e.label ?? ''} />
          {eps.length > 0 && <EndpointPicker e={e} eps={eps} target={b.name} load={load} set={set} />}
          <CheckField path="showNotes" label={hasNotes(e.notes) ? 'Show notes on the line' : 'Show notes on the line (add some below)'} wide value={!!e.showNotes} />
          {load && calls}
        </div>
        {load && <div className="stats"><div className="stat-tile"><div className="l">Carries</div><div className="v">{fmt(resultsOf(doc).edges[e.id] || 0)} <small>rps</small></div></div></div>}
        {load && notes}
        <div className="props style-sec" id="edgeStyle">
          <div className="wide sec-h">Style</div>
          <StyleRow label="Line">
            <Seg attr="line" value={e.line ?? lineDefault} onPick={v => set(x => { if (v === lineDefault) delete x.line; else x.line = v; })}
              options={[['solid', <><LineIcon key="s" />Solid</>], ['dashed', <><LineIcon key="d" dash="5 3" />Dashed</>], ['dotted', <><LineIcon key="o" dash="0.1 4" cap />Dotted</>]] as const} />
          </StyleRow>
          <StyleRow label="Colour">
            <Swatches attr="color" value={e.color} fallback="var(--edge)" defaultLabel="Default grey" onPick={c => set(x => { if (c) x.color = c; else delete x.color; })} />
          </StyleRow>
          <StyleRow label="Width">
            <Seg attr="width" value={e.width ?? 'medium'} onPick={v => set(x => { if (v === 'medium') delete x.width; else x.width = v; })}
              options={[['thin', 'Thin'], ['medium', 'Medium'], ['thick', 'Thick']] as const} />
          </StyleRow>
          <StyleRow label="Arrows">
            <Seg attr="arrows" value={e.arrows ?? 'end'} onPick={v => set(x => { if (v === 'end') delete x.arrows; else x.arrows = v; })}
              options={[['end', <ArrowIcon key="e" end />, 'Arrow at the end'], ['both', <ArrowIcon key="b" start end />, 'Arrows at both ends'], ['none', <ArrowIcon key="n" />, 'No arrows']] as const} />
          </StyleRow>
          {styled && <button type="button" className="link wide" id="resetEdgeStyle" onClick={() => set(x => { delete x.line; delete x.color; delete x.width; delete x.arrows; })}>Reset style</button>}
        </div>
        {!load && (
          <details className="loadsec" id="loadSection">
            <summary>Load model <span className="muted">· hidden on the canvas</span></summary>
            <div className="props">{calls}</div>
            {notes}
          </details>
        )}
      </div>
      <NotesSection type="edge" id={e.id} value={e.notes ?? ''} />
    </>
  );
}
