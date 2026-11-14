/** What a diagram puts in the floating palette: sections of things to add (or tools to pick). */
import type { ReactNode } from 'react';
import type { Point } from '../store/viewport';

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
  /** drag it onto the canvas: [mime type, data] */
  drag?: [string, string];
  /** draw the tile as a sticky note */
  sticky?: boolean;
}

export interface PaletteSection { title: string; items: PaletteItem[] }

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
