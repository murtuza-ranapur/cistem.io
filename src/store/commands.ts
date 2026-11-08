/** Commands that act on whichever diagram is open, through its module. Used by the toolbar, keys and menus. */
import { diagram } from '../diagrams';
import { editor } from './editor';
import { fitTo, reveal } from './viewport';

export const active = () => diagram(editor().open.kind);

/** Fit everything into view. */
export function fitView(animated = true) {
  const { open } = editor();
  fitTo(active().bounds(open.doc as never), { animated });
}
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
