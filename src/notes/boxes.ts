/** Where sticky notes are, for fitting the view: their saved box, with the height measured on screen when it follows the text. */
import type { CanvasNote } from '../domain/notes';
import type { Box } from '../store/viewport';

export function noteBoxes(notes: CanvasNote[] | undefined): Box[] {
  return (notes ?? []).map(n => {
    const shown = typeof document !== 'undefined' ? document.querySelector<HTMLElement>(`[data-note="${CSS.escape(n.id)}"]`) : null;
    return { x: n.x, y: n.y, w: n.w, h: n.h ?? shown?.offsetHeight ?? 90 };
  });
}
