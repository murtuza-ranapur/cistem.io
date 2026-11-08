/** Class-diagram helpers shared by the canvas, panel and actions: colours, labels, geometry, names. */
import { boxSize, clipRect, type ClassBox, type ClassDoc, type ClassKind, type RelType } from '../../domain/cls';
import type { Box, Point } from '../../store/viewport';

export const KIND_COLOR: Record<ClassKind, string> = { class: '#2f8a55', abstract: '#2f8a55', interface: '#7c3aed', enum: '#a16207', record: '#2f6fa8' };
export const KIND_LABEL: Record<ClassKind, string> = { class: 'Class', abstract: 'Abstract class', interface: 'Interface', enum: 'Enum', record: 'Record' };
/** The 1–5 keys and the rail, in order. */
export const QUICK: ClassKind[] = ['class', 'interface', 'enum', 'record', 'abstract'];

export const snap = (v: number) => Math.round(v / 8) * 8;
export const isName = (s: string) => /^[A-Za-z_$][\w$]*$/.test(s);

/** A class's box in world coordinates. */
export function rectOf(d: ClassDoc, c: ClassBox): Box {
  const p = d.pos[c.name] ?? { x: 0, y: 0 }, s = boxSize(c);
  return { x: p.x, y: p.y, w: s.w, h: s.h };
}
export const findClass = (d: ClassDoc, name: string) => d.classes.find(c => c.name === name);
export const hasClass = (d: ClassDoc, name: string) => d.classes.some(c => c.name === name);

/** `base`, or `base2`, `base3`… whichever isn't taken. */
export function freeName(taken: (n: string) => boolean, base: string, first = base): string {
  let n = first, i = 2;
  while (taken(n)) n = base + i++;
  return n;
}
/** A copy's name: OrderCopy, OrderCopy2… */
export const copyName = (taken: (n: string) => boolean, name: string) => freeName(taken, name + 'Copy');

/** The marker at each end of a relation line (UML). */
export const endMarker = (t: RelType) => (t === 'inherit' || t === 'implement' ? 'tri' : t === 'assoc' || t === 'depend' ? 'open' : '');
export const startMarker = (t: RelType) => (t === 'composition' ? 'dfill' : t === 'aggregation' ? 'dhollow' : '');

/** A point `dist` along the line from p towards q. */
export function along(p: Point, q: Point, dist: number): Point {
  const L = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  return { x: p.x + (q.x - p.x) / L * dist, y: p.y + (q.y - p.y) / L * dist };
}
export { clipRect };

/** The relation the picker suggests, from what the target is. */
export function suggestedRelation(d: ClassDoc, from: string, to: string): RelType {
  const a = findClass(d, from), b = findClass(d, to);
  if (b?.kind === 'interface') return a?.kind === 'interface' ? 'inherit' : 'implement';
  if (b?.kind === 'abstract') return 'inherit';
  return 'assoc';
}

/** Everything drawn. */
export function classBounds(d: ClassDoc): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of d.classes) {
    if (!d.pos[c.name]) continue;
    const r = rectOf(d, c);
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
