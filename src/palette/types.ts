/** What a diagram puts in the floating palette: sections of things to add (or tools to pick). */
import type { ReactNode } from 'react';
import type { Box, Point } from '../store/viewport';

export interface PaletteItem {
  /** unique in the palette; also what "most used" counts */
  key: string;
  label: string;
  icon: ReactNode;
  /** one line, shown on hover and in search results */
  about?: string;
  /** other words search finds it by */
  aliases?: string[];
  /** extra attributes on its tile (ids and data-* the rest of the app and the tests know it by) */
  attrs?: Record<string, string>;
  /** a tool that's currently picked */
  active?: boolean;
  /** add it: in the middle of the view, or at a point (quick add) */
  add(at?: Point): void;
  /** drag it onto the canvas: its size there (world units). Without it the tile only clicks. */
  place?: {
    w: number; h: number;
    /** feedback while it's over the canvas, given where its top-left would land (on the grid) */
    preview?(at: Point): DropPreview;
    /** put it there (default: add at its middle) */
    drop?(at: Point): void;
  };
  /** draw the tile as a sticky note */
  sticky?: boolean;
}

export interface PaletteSection { title: string; items: PaletteItem[] }

/** What dropping here would do, drawn under the dragged copy (world units). */
export interface DropPreview {
  /** a moved top-left, e.g. lined up with a card nearby */
  at?: Point;
  /** an area that lights up, e.g. the environment it would go into */
  highlight?: { box: Box; label: string };
  /** lines across the canvas where it lines up with something */
  guides?: { x?: number; y?: number }[];
  /** a vertical slot marker, e.g. where a lifeline would go */
  slot?: { x: number; y1: number; y2: number };
  /** hide the copy itself (the slot says it all) */
  noGhost?: boolean;
}

/** Items matching a search, best first: label starts with it, then a word of it, then aliases, then anywhere. */
export function searchItems(sections: PaletteSection[], q: string): PaletteItem[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const scored: [number, number, PaletteItem][] = [];
  let i = 0;
  for (const sec of sections) for (const it of sec.items) {
    const label = it.label.toLowerCase(), aliases = (it.aliases ?? []).map(a => a.toLowerCase());
    const score = label.startsWith(s) ? 0
      : label.split(/[\s/-]+/).some(w => w.startsWith(s)) ? 1
      : aliases.some(a => a.startsWith(s)) ? 2
      : aliases.some(a => a.includes(s)) || label.includes(s) ? 3
      : (it.about ?? '').toLowerCase().includes(s) ? 4 : -1;
    if (score >= 0) scored.push([score, i, it]);
    i++;
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
}

/** Why a result matched, when it wasn't by its name ("matches sql"). */
export function matchedAlias(it: PaletteItem, q: string): string | null {
  const s = q.trim().toLowerCase();
  if (!s || it.label.toLowerCase().includes(s)) return null;
  return (it.aliases ?? []).find(a => a.toLowerCase().includes(s)) ?? null;
}
