/** A connection's panel: calls per request, which endpoint it calls, and what it carries. */
import { detailOf, typeDef, type Edge } from '../../../domain/model';
import { fmt } from '../../../lib/format';
import { select } from '../../../store/editor';
import { Icon } from '../../../ui/Icon';
import { deleteEdge } from '../actions';
import { findNode, resultsOf, useSysDoc } from '../state';
import { NotesSection } from '../../../notes/ItemNotes';
import { NumberField, SelectField } from './controls';

export function EdgePanel({ e }: { e: Edge }) {
  const doc = useSysDoc();
  const a = findNode(doc, e.from), b = findNode(doc, e.to);
  if (!a || !b) return null;
  const eps = detailOf(b) === 'endpoints' ? b.endpoints ?? [] : [];
  const behaviour = typeDef(a.kind).behaviour;
  return (
    <>
      <div className="head">
        <span className="k">Edge</span><strong>{a.name} → {b.name}</strong><span className="spacer" />
        <button type="button" className="icon danger" data-action="delete-edge" title="Delete" aria-label="Delete" onClick={() => { deleteEdge(e.id); select(null); }}>
          <Icon name="ic-trash" />
        </button>
      </div>
      <div className="tab">
        <div className="props">
          <NumberField path="calls" label="Calls per incoming request" wide value={e.calls} min={0} />
          {eps.length > 0 && (
            <SelectField path="endpoint" label="Endpoint called" wide int empty="Unspecified" value={e.endpoint == null ? '' : String(e.endpoint)}
              options={eps.map((_, i) => String(i))} labelOf={i => `${eps[+i].method} ${eps[+i].path}`} />
          )}
        </div>
        <div className="stats"><div className="stat-tile"><div className="l">Carries</div><div className="v">{fmt(resultsOf(doc).edges[e.id] || 0)} <small>rps</small></div></div></div>
        {behaviour === 'cache' && <p className="note">Only cache misses travel down this edge.</p>}
        {behaviour === 'balancer' && <p className="note">The {typeDef(a.kind).label.toLowerCase()} splits its traffic evenly across outgoing edges.</p>}
      </div>
      <NotesSection type="edge" id={e.id} value={e.notes ?? ''} />
    </>
  );
}
