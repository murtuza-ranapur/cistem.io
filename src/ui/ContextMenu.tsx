/** The right-click menu on every canvas: Cut, Copy, Paste, Duplicate, Delete. */
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUi } from '../store/ui';
import { editor, select } from '../store/editor';
import { active, duplicateSelection, removeSelection } from '../store/commands';
import { canCopy, canPaste, copy, cut, paste } from '../store/clipboard';
import { toWorld } from '../store/viewport';
import { modLabel } from '../lib/browser';
import { useDismiss, moveFocus } from './hooks';

/** Right-click on a canvas: select what's under the pointer (unless it's already selected), then open the menu. */
export function openContextMenu(ev: React.MouseEvent) {
  ev.preventDefault();
  const under = active().selectionAt(ev.target as Element);
  const cur = editor().selection;
  if (!under) select(null);
  else if (!(cur?.type === under.type && under.ids.every(id => cur.ids.includes(id)))) select(under);
  useUi.setState({ contextMenu: { x: ev.clientX, y: ev.clientY, world: toWorld(ev.clientX, ev.clientY) } });
}

export function ContextMenu() {
  const state = useUi(s => s.contextMenu);
  if (!state) return null;
  // on <body>, so no panel or rail can paint over it
  return createPortal(<Menu x={state.x} y={state.y} world={state.world} />, document.body);
}

function Menu({ x, y, world }: { x: number; y: number; world: { x: number; y: number } | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const close = () => useUi.setState({ contextMenu: null });
  useDismiss(ref, true, close);
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ left: Math.min(x, innerWidth - r.width - 8), top: Math.min(y, innerHeight - r.height - 8) });
    ref.current!.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);
  const has = canCopy(), pastable = canPaste();
  const item = (act: string, label: string, keys: string, enabled: boolean, run: () => void) => (
    <button type="button" role="menuitem" data-ctx={act} disabled={!enabled} onClick={() => { close(); run(); }}>
      <span>{label}</span><kbd>{keys}</kbd>
    </button>
  );
  return (
    <div id="ctxMenu" className="ctx" role="menu" aria-label="Edit" ref={ref} style={pos}
      onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveFocus(ref.current!, 'button', e.key === 'ArrowDown' ? 1 : -1); } }}>
      {item('cut', 'Cut', `${modLabel}X`, has, () => { cut(); })}
      {item('copy', 'Copy', `${modLabel}C`, has, () => { copy(); })}
      {item('paste', 'Paste', `${modLabel}V`, pastable, () => { paste(undefined, world); })}
      <hr />
      {item('dup', 'Duplicate', `${modLabel}D`, has, duplicateSelection)}
      {item('del', 'Delete', '⌫', has, removeSelection)}
    </div>
  );
}
