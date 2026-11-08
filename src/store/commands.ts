/** Commands that act on whichever diagram is open, through its module. Used by the toolbar, keys and menus. */
import { diagram } from '../diagrams';
import { editor } from './editor';
import { fitTo, reveal, whenDrawn } from './viewport';

export const active = () => diagram(editor().open.kind);

/** Fit everything into view. */
export function fitView(animated = true) {
  const { open } = editor(), m = active();
  if (m.fit) { m.fit(animated); return; }
  fitTo(m.bounds(open.doc as never), { animated });
}
/** Fit once the newly opened document is drawn (opening a tab, loading from the cloud). */
export const fitWhenDrawn = () => whenDrawn(() => fitView(false));
/** Keep the selected item clear of the panel and the canvas edges. */
export function revealSelection() {
  const { open, selection } = editor();
  if (!selection) return;
  reveal(active().selectionBox?.(open.doc as never, selection) ?? null);
}
export const removeSelection = () => active().remove();
export const duplicateSelection = () => active().duplicate();
export const selectAll = () => active().selectAll();
export const organise = () => active().organise?.();
