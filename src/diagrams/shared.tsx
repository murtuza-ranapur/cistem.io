/** Pieces every diagram uses: typed access to the open document, the inline text editor, double-tap detection. */
import { useEffect, useRef } from 'react';
import type { DiagramKind } from '../domain/document';
import { editor, useEditor, type DocOf } from '../store/editor';

/** The open document when it's of `kind` (components of a kind only render while it's open). */
export function useDoc<K extends DiagramKind>(_kind: K): DocOf<K> {
  return useEditor(s => s.open.doc) as DocOf<K>;
}
/** The open document of `kind`, outside React. */
export const docOf = <K extends DiagramKind>(_kind: K): DocOf<K> => editor().open.doc as DocOf<K>;

/**
 * A text box over the canvas for editing a label in place. It takes focus once the click that opened it
 * has landed, selects its text, commits on Enter or blur and cancels on Escape. An empty value isn't committed.
 */
export function InlineEdit({ id, value, style, onCommit, onCancel, onKeyDown, list, mono, allowEmpty, ariaLabel = 'Edit text' }: {
  id: string; value: string; style: React.CSSProperties;
  /** Commit an emptied box too (a label can be cleared; a name can't). */
  allowEmpty?: boolean;
  onCommit: (value: string) => void; onCancel: () => void;
  onKeyDown?: (ev: React.KeyboardEvent<HTMLInputElement>) => boolean | void;
  list?: string; mono?: boolean; ariaLabel?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    // focus after the double-click's own mouseup/click have landed, or they'd take focus straight back
    const t = setTimeout(() => { input.current?.focus({ preventScroll: true }); input.current?.select(); }, 0);
    return () => clearTimeout(t);
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const v = input.current?.value.trim() ?? '';
    if (commit && (v || allowEmpty)) onCommit(v); else onCancel();
  };
  const finishRef = useRef(finish); finishRef.current = finish;
  useEffect(() => {
    // a press anywhere else commits first: the canvas closes the box on pointerdown, which unmounts the
    // input before its blur could save the text
    const outside = (ev: PointerEvent) => { if (ev.target !== input.current) finishRef.current(true); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, []);
  return (
    <input id={id} ref={input} type="text" aria-label={ariaLabel} autoComplete="off" spellCheck={false} list={list}
      defaultValue={value} style={{ ...style, ...(mono ? { fontFamily: 'var(--mono)' } : {}) }}
      onBlur={() => finish(true)}
      onKeyDown={ev => {
        ev.stopPropagation();
        if (onKeyDown?.(ev)) return;
        if (ev.key === 'Enter') finish(true);
        if (ev.key === 'Escape') finish(false);
      }} />
  );
}

/**
 * Double-click detection that survives re-rendering: a click re-renders what was clicked, which stops the
 * browser from pairing two clicks into a dblclick. Call on pointerdown; true on the second tap.
 */
export function useDoubleTap(ms = 400, slop = 6) {
  const last = useRef<{ key: string; t: number; x: number; y: number } | null>(null);
  return (key: string | null, ev: { clientX: number; clientY: number }): boolean => {
    const now = performance.now(), l = last.current;
    if (key && l && l.key === key && now - l.t < ms && Math.hypot(ev.clientX - l.x, ev.clientY - l.y) < slop) { last.current = null; return true; }
    last.current = key ? { key, t: now, x: ev.clientX, y: ev.clientY } : null;
    return false;
  };
}
