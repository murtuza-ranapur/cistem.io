/** The details panel: opens for what's selected (or stays pinned / hidden), with the open diagram's panel inside. */
import { useEffect, useRef } from 'react';
import { useEditor } from '../store/editor';
import { useUi, setPanelMode } from '../store/ui';
import { revealSelection } from '../store/commands';
import { diagram } from '../diagrams';
import { IconButton } from './Icon';

export function Inspector() {
  const kind = useEditor(s => s.open.kind);
  const selection = useEditor(s => s.selection);
  const { panelMode, panelHeld, panelQuietFor, panelOpen } = useUi();
  const m = diagram(kind);
  const selKey = selection ? selection.type + ':' + selection.ids[0] : '';
  const quiet = panelQuietFor !== '' && panelQuietFor === selKey;
  const wanted = panelMode === 'hidden' ? false : panelMode === 'pinned' ? true : m.panelFor(selection) && (panelOpen || (!panelHeld && !quiet));

  // a different selection ends the "picked up by a drag" quiet spell
  useEffect(() => { if (panelQuietFor && panelQuietFor !== selKey) useUi.setState({ panelQuietFor: '' }); }, [selKey, panelQuietFor]);
  useEffect(() => { if (wanted !== panelOpen) useUi.setState({ panelOpen: wanted }); }, [wanted, panelOpen]);

  // keep whatever was selected out from under the panel once it has slid in
  const el = useRef<HTMLElement>(null);
  const lastSel = useRef('');
  useEffect(() => {
    if (selKey && selKey !== lastSel.current && panelOpen) setTimeout(revealSelection, 230);
    lastSel.current = selKey;
  }, [selKey, panelOpen]);

  const pinned = panelMode === 'pinned';
  return (
    <aside id="inspector" ref={el} className={wanted ? '' : 'closed'} aria-label="Details"
      onTransitionEnd={e => { if (e.propertyName === 'width' && wanted) revealSelection(); }}>
      <div id="inspBar">
        <span>Details</span><span className="spacer" />
        <IconButton icon="ic-pin" label="Pin panel" data-panel="pin" className={pinned ? 'on' : ''}
          title={pinned ? 'Unpin — close when nothing is selected' : 'Pin — keep this panel open'}
          onClick={() => setPanelMode(pinned ? 'auto' : 'pinned')} />
        <IconButton icon="ic-close" label="Hide panel" data-panel="close" title="Hide panel (I)" onClick={() => setPanelMode('hidden')} />
      </div>
      <div id="sheetBody">{wanted && <m.Panel />}</div>
    </aside>
  );
}
