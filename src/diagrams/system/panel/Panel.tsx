/**
 * The system diagram's details panel: the selected component, connection or environment.
 * Editing a field (from focus until it's left) is one undo step.
 */
import { useEffect, useRef } from 'react';
import { useEditor } from '../../../store/editor';
import * as history from '../../../store/history';
import { useSysDoc } from '../state';
import { currentItem } from './paths';
import { usePanelUi, setPanelUi } from './ui';
import { NodePanel } from './NodePanel';
import { EdgePanel } from './EdgePanel';
import { ContainerPanel } from './ContainerPanel';
import { BigEditorOverlay } from './BigEditor';

const isField = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || !!e.closest?.('.cm-editor'));
};

export function Panel() {
  const doc = useSysDoc();
  useEditor(s => s.selection);   // redraw when the selection changes
  const root = useRef<HTMLDivElement>(null);
  const editing = useRef(false);
  const focus = usePanelUi(s => s.focus);
  const cur = currentItem(doc);

  // one undo step per field: from focusing it until leaving it (also if the panel goes away meanwhile)
  const stop = () => { if (editing.current) { editing.current = false; history.end(); } };
  useEffect(() => stop, []);
  const selKey = cur ? cur.type + ':' + cur.item.id : '';
  useEffect(() => stop, [selKey]);

  // a field asked to be focused once drawn (a new column, the clients' rps…)
  useEffect(() => {
    if (!focus) return;
    const el = root.current?.querySelector<HTMLInputElement>(focus);
    if (el) { el.focus(); if (el.select && el.tagName === 'INPUT') el.select(); setPanelUi({ focus: null }); }
  });

  if (!cur) return <div className="placeholder"><strong>Nothing selected</strong><span>Click a component, connection or environment to see and edit its details.</span></div>;
  return (
    <div className="sys-panel" ref={root}
      onFocus={e => { if (isField(e.target) && !editing.current) { editing.current = true; history.begin(); } }}
      onBlur={e => { if (isField(e.target)) stop(); }}>
      {cur.type === 'node' && <NodePanel n={cur.item} />}
      {cur.type === 'edge' && <EdgePanel e={cur.item} />}
      {cur.type === 'container' && <ContainerPanel c={cur.item} />}
      <BigEditorOverlay />
    </div>
  );
}
