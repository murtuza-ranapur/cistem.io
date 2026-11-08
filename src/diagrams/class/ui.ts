/** The class editor's own interface state: the relation picker, the inline editor, a relation being drawn, the panel tab. */
import { create } from 'zustand';

export type Editing =
  | { t: 'rename'; name: string }
  | { t: 'member'; name: string; kind: 'f' | 'm'; i: number };

interface ClsUi {
  /** After dropping a class's dot on another: choose how they relate (screen position within the stage). */
  picker: { from: string; to: string; left: number; top: number } | null;
  editing: Editing | null;
  /** A relation being dragged out of a class's dot (world coordinates). */
  drawing: { from: string; x: number; y: number; over: string | null } | null;
  panelTab: 'item' | 'code';
  /** Code-tab text that doesn't parse (the drawing keeps the last valid version). */
  draft: string | null;
}

export const useClsUi = create<ClsUi>(() => ({ picker: null, editing: null, drawing: null, panelTab: 'item', draft: null }));
export const clsUi = () => useClsUi.getState();
