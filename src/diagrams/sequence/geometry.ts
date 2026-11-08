/** Where things are on the drawing. Everything is derived from the model by layoutSeq; nothing is placed by hand. */
import { layoutSeq, textW, type SeqDoc, type SeqGeo } from '../../domain/seq';
import type { Box } from '../../store/viewport';

const cache = new WeakMap<SeqDoc, SeqGeo>();
/** The layout of a document (documents are immutable, so it's computed once per version). */
export function geometry(d: SeqDoc): SeqGeo {
  let g = cache.get(d);
  if (!g) { g = layoutSeq(d); cache.set(d, g); }
  return g;
}

/** y of the gap before row `i` (rows.length = after the last). */
export function insertY(g: SeqGeo, i: number, firstRow: number): number {
  if (!g.rows.length) return firstRow + 6;
  if (i >= g.rows.length) { const last = g.rows[g.rows.length - 1]; return last.y + last.h; }
  return g.rows[i].y;
}
/** Index where something dropped at world y lands (skipping the rows being moved). */
export function indexAt(g: SeqGeo, y: number, skip?: { from: number; span: number }): number {
  for (let i = 0; i < g.rows.length; i++) {
    if (skip && i >= skip.from && i < skip.from + skip.span) continue;
    const r = g.rows[i]; if (y < r.y + r.h / 2) return i;
  }
  return g.rows.length;
}
/** The lifeline nearest world x (within reach), if any. */
export function nearestLife(g: SeqGeo, x: number): string | null {
  let best: string | null = null, bd = 90;
  for (const c of g.cols) { const d = Math.abs(c.x - x); if (d < bd) { bd = d; best = c.id; } }
  return best;
}
/** Activation depth of lifeline `pid` at y (0: not active). */
export function levelAt(g: SeqGeo, pid: string, y: number): number {
  return g.acts.filter(a => a.pid === pid && a.y1 <= y + 0.5 && a.y2 >= y - 0.5).reduce((m, a) => Math.max(m, a.level + 1), 0);
}
/** Where an arrow meets lifeline `pid` at y: the edge of its activation bar facing `toward`. */
export function edgeX(g: SeqGeo, pid: string, y: number, toward: number): number {
  const lv = levelAt(g, pid, y), c = (g.colX[pid] ?? 0) + Math.max(0, lv - 1) * 6;
  return lv ? (toward > c ? c + 5 : c - 5) : c;
}
/** Words wrapped into lines no wider than `width`. */
export function wrapText(s: string, width: number): string[] {
  const out: string[] = []; let line = '';
  for (const w of s.split(/\s+/)) {
    const next = line ? line + ' ' + w : w;
    if (textW(next) > width && line) { out.push(line); line = w; } else line = next;
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}
/** Everything drawn (at least a modest page, so a near-empty sequence doesn't zoom in). */
export function seqBounds(d: SeqDoc): Box {
  const g = geometry(d);
  return { x: 0, y: 0, w: Math.max(g.width, 400), h: Math.max(g.height, 300) };
}
