/** The component rail, built from shared/component-types.json: click to add, or drag onto the canvas. */
import { TYPES, typeDef } from '../../domain/model';
import { Icon } from '../../ui/Icon';
import { addContainer, addNode } from './actions';
import { kindColour } from './geometry';

const GROUPS: Record<string, string> = { traffic: 'Traffic', compute: 'Compute', data: 'Data', messaging: 'Messaging', external: 'External' };

/** Kinds by rail group, in the rail's order (also the 1–9 quick-add order). */
const byGroup = () => {
  const out = new Map<string, string[]>();
  for (const k of Object.keys(TYPES)) { const g = typeDef(k).group; out.set(g, [...(out.get(g) ?? []), k]); }
  return out;
};
export const RAIL_ORDER = (): string[] => [...byGroup().values()].flat();

export function Rail() {
  let i = 0;
  return (
    <>
      <div id="railTypes">
        {[...byGroup()].map(([g, kinds]) => (
          <div key={g} className="rail-group" title={GROUPS[g] ?? g}>
            {kinds.map(k => {
              const t = typeDef(k), n = ++i;
              return (
                <button type="button" key={k} className={`comp k-${k}`} data-add={k} draggable style={{ '--kc': kindColour(k) } as React.CSSProperties}
                  title={`${t.label}${n <= 9 ? ` (${n})` : ''}`}
                  onDragStart={e => { e.dataTransfer.setData('text/kind', k); e.dataTransfer.effectAllowed = 'copy'; }}
                  onClick={() => addNode(k)}>
                  <Icon name={t.icon} /><span>{t.short}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="rail-sep" />
      <button type="button" className="comp k-container" data-add-container="1" title="Environment (container)" draggable
        onDragStart={e => { e.dataTransfer.setData('text/container', '1'); e.dataTransfer.effectAllowed = 'copy'; }}
        onClick={() => addContainer()}>
        <Icon name="ic-container" /><span>Env</span>
      </button>
      <div className="rail-hint">drag onto canvas</div>
    </>
  );
}
