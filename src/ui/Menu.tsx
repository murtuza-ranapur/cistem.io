/**
 * A popup menu anywhere (a ⋯ button, a right-click on a tab or a diagram): `openMenu(at, items)`. An item with
 * `items` opens them in place, with a way back. Rendered once, on <body>, by <MenuHost />.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useDismiss, moveFocus } from './hooks';

export interface MenuItem {
  label: string;
  run?: () => void;
  /** A submenu, shown in place of this menu. */
  items?: () => MenuItem[];
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  /** A line above this item. */
  sep?: boolean;
  id?: string;
}
interface Open { x: number; y: number; label: string; items: MenuItem[]; back?: Open }

const useMenu = create(() => ({ open: null as Open | null }));
const close = () => useMenu.setState({ open: null });

/** Open a menu at a point, or below an element (a button). */
export function openMenu(at: { x: number; y: number } | Element, label: string, items: MenuItem[]) {
  const r = at instanceof Element ? at.getBoundingClientRect() : null;
  useMenu.setState({ open: { x: r ? r.left : (at as { x: number }).x, y: r ? r.bottom + 4 : (at as { y: number }).y, label, items } });
}

export function MenuHost() {
  const open = useMenu(s => s.open);
  return open ? createPortal(<Popup open={open} />, document.body) : null;
}

function Popup({ open }: { open: Open }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: open.x, top: open.y });
  useDismiss(ref, true, close);
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(open.x, innerWidth - r.width - 8)), top: Math.max(8, Math.min(open.y, innerHeight - r.height - 8)) });
    ref.current!.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [open]);
  const pick = (it: MenuItem) => {
    if (it.items) { useMenu.setState({ open: { ...open, label: it.label, items: it.items(), back: open } }); return; }
    close(); it.run?.();
  };
  return (
    <div className="ctx popmenu" role="menu" aria-label={open.label} ref={ref} style={pos}
      onKeyDown={e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveFocus(ref.current!, 'button', e.key === 'ArrowDown' ? 1 : -1); }
        if (e.key === 'ArrowLeft' && open.back) { e.preventDefault(); useMenu.setState({ open: open.back }); }
      }}>
      {open.back && (
        <button type="button" className="pm-back" onClick={() => useMenu.setState({ open: open.back })}><span>‹ {open.label}</span></button>
      )}
      {open.items.map((it, i) => (
        <div key={it.id ?? it.label + i} style={{ display: 'contents' }}>
          {it.sep && i > 0 && <hr />}
          <button type="button" role={it.checked !== undefined ? 'menuitemradio' : 'menuitem'} aria-checked={it.checked} data-menu={it.id}
            className={it.danger ? 'danger' : undefined} disabled={it.disabled} onClick={() => pick(it)}>
            <span>{it.checked ? '✓ ' : ''}{it.label}</span>{it.items ? <kbd>›</kbd> : null}
          </button>
        </div>
      ))}
    </div>
  );
}
