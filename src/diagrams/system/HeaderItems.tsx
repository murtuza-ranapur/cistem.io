/** System-only header items: the total load (click: go to the clients) and expand-all. */
import { useRef } from 'react';
import { isSource, totalRps } from '../../domain/model';
import { fmt } from '../../lib/format';
import { selectOne } from '../../store/editor';
import { revealSelection } from '../../store/commands';
import { hint } from '../../store/ui';
import { IconButton } from '../../ui/Icon';
import { toggleAllDetail, useExpandAll } from './actions';
import { focusInPanel } from './panel/ui';
import { sysDoc, useSysDoc } from './state';

/** Peak load: the sum of every client's rps. Each click selects the next client and focuses its rps. */
export function LoadButton() {
  const doc = useSysDoc();
  const cursor = useRef(0);
  const go = () => {
    const clients = sysDoc().nodes.filter(isSource);
    if (!clients.length) { hint('Add a Clients component — its peak rps is the load'); return; }
    selectOne('node', clients[cursor.current++ % clients.length].id);
    revealSelection();
    focusInPanel('input[data-path="rps"]', 260);
  };
  return (
    <button type="button" id="totalRps" className="total" title="Peak load: the sum of every client's rps. Click to go to the clients." onClick={go}>
      <span className="tlabel">Load</span><strong id="totalVal">{fmt(totalRps(doc))}</strong><span className="unit">rps</span>
    </button>
  );
}

export function ExpandAllButton() {
  const on = useExpandAll(s => s.on);
  return <IconButton id="expandAll" icon="ic-expand" label="Expand all" title="Expand all schemas (⇧Space)" className={on ? 'active' : ''} onClick={toggleAllDetail} />;
}
