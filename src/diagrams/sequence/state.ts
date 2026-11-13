/** Sequence editor state that isn't part of the document: the message tool, the gesture in progress, inline editing and the panel tab. */
import { create } from 'zustand';
import type { MsgStyle } from '../../domain/seq';

/** A pointer gesture on the drawing. Drawing follows the model, so gestures are about order. */
export type Drag =
  | { t: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  /** from a lifeline: insert a message where the pointer lets go */
  | { t: 'msg'; from: string; x: number; y: number; to: string | null; at: number; moved: boolean }
  /** a message, note or block moved up or down */
  | { t: 'move'; rowId: string; span: number; y0: number; y: number; at: number; moved: boolean; x0?: number; shift?: number }
  /** a selected head's right edge dragged to resize it */
  | { t: 'hresize'; pid: string; x0: number; w0: number; moved: boolean }
  /** a selected note's edge dragged to span more or fewer lifelines */
  | { t: 'nedge'; rowId: string; side: 'l' | 'r'; moved: boolean }
  /** a lifeline head dragged sideways to reorder */
  | { t: 'head'; pid: string; x0: number; x: number; at: number; moved: boolean };

/** The text box over the drawing: a row's label/text/guard, or a lifeline's name. */
export interface Editing { id: string; part: boolean; x: number; y: number; w: number; value: string; list: boolean }

interface SeqUi {
  tool: MsgStyle;
  drag: Drag | null;
  editing: Editing | null;
  tab: 'item' | 'code';
  /** Code text that doesn't parse yet (kept so redraws don't lose it). */
  draft: string | null;
}
export const useSeqUi = create<SeqUi>(() => ({ tool: 'sync', drag: null, editing: null, tab: 'item', draft: null }));
export const seqUi = () => useSeqUi.getState();
export const setDrag = (drag: Drag | null) => useSeqUi.setState({ drag });
