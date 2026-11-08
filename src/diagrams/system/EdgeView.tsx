/** A connection: the curve (with a wide invisible hit area) and its label — calls per request and the rps it carries. */
import { memo, useState } from 'react';
import type { EdgeGeometry } from './geometry';

interface LineProps { id: string; geo: EdgeGeometry; selected: boolean; crit: boolean; cross: boolean; animate: boolean }

export const EdgeLine = memo(function EdgeLine({ id, geo, selected, crit, cross, animate }: LineProps) {
  const [entering, setEntering] = useState(animate);
  const cls = ['edge', selected && 'sel', crit && 'crit', cross && 'cross', entering && 'enter'].filter(Boolean).join(' ');
  return (
    <g className={cls} data-edge={id}>
      <path className="hit" d={geo.d} />
      <path className="line" d={geo.d} markerEnd={selected ? 'url(#arrowSel)' : crit ? 'url(#arrowCrit)' : 'url(#arrow)'}
        style={entering ? { strokeDasharray: geo.len, '--len': geo.len } as React.CSSProperties : undefined}
        onAnimationEnd={() => setEntering(false)} />
    </g>
  );
}, (a, b) => a.geo.d === b.geo.d && a.selected === b.selected && a.crit === b.crit && a.cross === b.cross);

interface LabelProps { id: string; text: string; x: number; y: number; selected: boolean; hidden: boolean }

/** Labels sit on their own layer above the nodes; one that would be cramped or land on a node is hidden. */
export const EdgeLabel = memo(function EdgeLabel({ id, text, x, y, selected, hidden }: LabelProps) {
  const w = text.length * 6.1 + 12;
  return (
    <g className={'edge-label' + (selected ? ' sel' : '') + (hidden ? ' hidden' : '')} data-edge={id}>
      <rect className="lbl" x={x - w / 2} y={y - 9} width={w} height={18} />
      <text textAnchor="middle" x={x} y={y + 3.5}>{text}</text>
    </g>
  );
});
