/** The details panel's own view state (which tab, which column is open, editor modes…), kept across redraws. */
import { create } from 'zustand';

export type FieldMode = 'fields' | 'code';
export type BigEditor = { t: 'field'; path: string; kind: 'json' | 'avro'; label: string } | { t: 'tables' };

interface PanelUi {
  tab: 'capacity' | 'schema';
  /** The one table column being edited ("node:table:col"). */
  openCol: string;
  /** Tables shown as rows or as text, per database node. */
  tableMode: Record<string, 'rows' | 'code'>;
  /** Fields or code, per "nodeId:path" body/schema editor. */
  fieldMode: Record<string, FieldMode>;
  /** Table text that doesn't parse yet, per node (kept so a redraw doesn't lose it). */
  dbDrafts: Record<string, string>;
  big: BigEditor | null;
  /** A field to focus once the panel has drawn (a CSS selector within the panel). */
  focus: string | null;
}

export const usePanelUi = create<PanelUi>(() => ({ tab: 'capacity', openCol: '', tableMode: {}, fieldMode: {}, dbDrafts: {}, big: null, focus: null }));
export const panelUi = () => usePanelUi.getState();
export const setPanelUi = (patch: Partial<PanelUi> | ((s: PanelUi) => Partial<PanelUi>)) => usePanelUi.setState(patch);

/** Focus (and select) a field in the panel once it's drawn, optionally after the panel has slid in. */
export function focusInPanel(selector: string, delay = 0) {
  if (delay) setTimeout(() => setPanelUi({ focus: selector }), delay);
  else setPanelUi({ focus: selector });
}
export function setDraft(nodeId: string, text: string | null) {
  setPanelUi(s => {
    const dbDrafts = { ...s.dbDrafts };
    if (text === null) delete dbDrafts[nodeId]; else dbDrafts[nodeId] = text;
    return { dbDrafts };
  });
}
