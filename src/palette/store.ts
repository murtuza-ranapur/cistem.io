/** The palette's own state, per browser: open or collapsed, and what you add most (for the collapsed pill). */
import { create } from 'zustand';
import { storage } from '../lib/browser';

const OPEN = 'cistem.palette', USE = 'cistem.palette.use';
const readUse = (): Record<string, number> => { try { return JSON.parse(storage.get(USE) ?? '{}') ?? {}; } catch { return {}; } };

export const usePalette = create<{ open: boolean; use: Record<string, number>; quick: { x: number; y: number } | null }>(() => ({
  open: storage.get(OPEN) !== 'closed',
  use: readUse(),
  /** quick add: where it opened (client coordinates), or null */
  quick: null,
}));

export function setPaletteOpen(open: boolean) { usePalette.setState({ open }); storage.set(OPEN, open ? 'open' : 'closed'); }
export function countUse(key: string) {
  const use = { ...usePalette.getState().use, [key]: (usePalette.getState().use[key] ?? 0) + 1 };
  usePalette.setState({ use }); storage.set(USE, JSON.stringify(use));
}
export const openQuickAdd = (x: number, y: number) => usePalette.setState({ quick: { x, y } });
export const closeQuickAdd = () => usePalette.setState({ quick: null });

/** The 4 you add most; until you've added anything, the first 4. */
export function mostUsed<T extends { key: string }>(items: T[], use: Record<string, number>, n = 4): T[] {
  return [...items].map((it, i) => ({ it, i, c: use[it.key] ?? 0 })).sort((a, b) => b.c - a.c || a.i - b.i).slice(0, n).map(x => x.it);
}
