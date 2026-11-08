/** Interface state that isn't part of a document: the details panel, messages, menus and dialogs. */
import { create } from 'zustand';
import { storage } from '../lib/browser';

/**
 * auto:   opens when you click something, closes when nothing is selected
 * pinned: always open (a placeholder when nothing is selected)
 * hidden: never opens on its own; the toolbar button or `I` brings it back
 */
export type PanelMode = 'auto' | 'pinned' | 'hidden';
const PANEL_KEY = 'cistem.panel';

export interface ContextMenuState { x: number; y: number; world: { x: number; y: number } | null }

interface UiState {
  panelMode: PanelMode;
  /** A pointer gesture is in progress: picking something up by dragging must not pop the panel open. */
  panelHeld: boolean;
  /** Selection picked up by a drag (type:id): the panel stays shut for it until it's clicked. */
  panelQuietFor: string;
  /** Whether the panel is showing right now (derived by the inspector, read by others). */
  panelOpen: boolean;
  hint: string | null;
  toast: string | null;
  ioOpen: 'export' | 'import' | null;
  drawerOpen: boolean;
  /** The share dialog: open on the open diagram, or on a project. */
  shareOpen: { projectId?: string } | null;
  newMenuOpen: boolean;
  contextMenu: ContextMenuState | null;
}

export const useUi = create<UiState>(() => ({
  panelMode: (() => { const v = storage.get(PANEL_KEY); return v === 'pinned' || v === 'hidden' ? v : 'auto'; })(),
  panelHeld: false,
  panelQuietFor: '',
  panelOpen: false,
  hint: null,
  toast: null,
  ioOpen: null,
  drawerOpen: false,
  shareOpen: null,
  newMenuOpen: false,
  contextMenu: null,
}));
export const ui = () => useUi.getState();

export function setPanelMode(m: PanelMode) { storage.set(PANEL_KEY, m); useUi.setState({ panelMode: m }); }
/** Toolbar / `I`: hide if visible, otherwise show (pinned, so it stays put). */
export const togglePanel = () => setPanelMode(ui().panelOpen ? 'hidden' : 'pinned');
export const holdPanel = () => useUi.setState({ panelHeld: true });
/** End of a gesture: a plain click opens the panel; a drag keeps it shut for what was dragged. */
export const releasePanel = (clicked: boolean, selKey: string) => useUi.setState({ panelHeld: false, panelQuietFor: clicked ? '' : selKey });

let hintTimer = 0;
/** A short message over the canvas; `ms` = 0 keeps it until cleared. */
export function hint(text: string | null, ms = 0) {
  clearTimeout(hintTimer);
  useUi.setState({ hint: text });
  if (text && ms) hintTimer = window.setTimeout(() => useUi.setState({ hint: null }), ms);
}
let toastTimer = 0;
/** A message at the bottom of the window. */
export function toast(text: string, ms = 2200) {
  clearTimeout(toastTimer);
  useUi.setState({ toast: text });
  toastTimer = window.setTimeout(() => useUi.setState({ toast: null }), ms);
}
