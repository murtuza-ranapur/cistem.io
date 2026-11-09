/**
 * Whether system diagrams show the load model (rps, capacity bars, utilisation, the verdict). A per-browser
 * preference, off by default: most diagrams are architecture, not capacity models.
 */
import { create } from 'zustand';

const KEY = 'cistem.loadView';
const read = () => { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } };

export const useLoadView = create<{ on: boolean }>(() => ({ on: read() }));
export const loadOn = () => useLoadView.getState().on;

export function setLoadView(on: boolean) {
  useLoadView.setState({ on });
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* per-session then */ }
}
export const toggleLoadView = () => setLoadView(!loadOn());
