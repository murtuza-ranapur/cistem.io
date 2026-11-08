import { useEffect, type RefObject } from 'react';

/** Close a popup on a pointer press outside it (and outside `also`, e.g. the button that opens it) or on Escape. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void, also?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const down = (ev: PointerEvent) => {
      const t = ev.target as Node;
      if (ref.current?.contains(t) || also?.current?.contains(t)) return;
      close();
    };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', down, true);
    ref.current?.addEventListener('keydown', key);
    const el = ref.current;
    window.addEventListener('blur', close);
    return () => { document.removeEventListener('pointerdown', down, true); el?.removeEventListener('keydown', key); window.removeEventListener('blur', close); };
  }, [open, close, ref, also]);
}

/** Arrow keys move focus between a menu's enabled items. */
export function moveFocus(container: HTMLElement, selector: string, dir: 1 | -1) {
  const items = [...container.querySelectorAll<HTMLElement>(selector)].filter(x => !(x as HTMLButtonElement).disabled && x.offsetParent);
  const i = items.indexOf(document.activeElement as HTMLElement);
  items[(i + dir + items.length) % items.length]?.focus();
}
