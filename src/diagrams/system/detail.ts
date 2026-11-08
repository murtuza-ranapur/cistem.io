/**
 * What an expanded node shows under its header — tables with their columns, endpoints, or a topic's fields —
 * laid out in node-local coordinates. Pure: the node view draws it and the foreign-key lines aim at its rows.
 */
import { NODE_H, EXP, detailOf, topicFields, foreignKeys, type Doc, type Node } from '../../domain/model';
import { trunc } from '../../lib/format';
import { nodeW } from './geometry';

export interface Tag { x: number; label: string; cls: string }
export type DetailItem =
  | { t: 'table'; y: number; h: number; name: string; count: string }
  | { t: 'row'; y: number; tags: Tag[]; nameX: number; name: string; pk?: boolean; type: string; anchor?: string }
  | { t: 'endpoint'; y: number; method: string; path: string; meta: string }
  | { t: 'topic'; y: number; name: string; partitions: string };

const tagW = (label: string) => label.length * 6 + 8;
function tags(x: number, list: [string, string][]): { tags: Tag[]; x: number } {
  const out: Tag[] = [];
  for (const [label, cls] of list) { out.push({ x, label, cls }); x += tagW(label) + 4; }
  return { tags: out, x };
}

export function layoutDetail(n: Node, w: number): DetailItem[] {
  const items: DetailItem[] = [];
  let y = NODE_H + EXP.sectionPad;
  const dk = detailOf(n);
  if (dk === 'tables') {
    for (const t of n.tables ?? []) {
      const cols = t.columns ?? [];
      items.push({ t: 'table', y, h: EXP.tableHead + cols.length * EXP.row + EXP.tablePad, name: t.name, count: `${cols.length} cols` });
      let ry = y + EXP.tableHead + 12;
      for (const c of cols) {
        const tg = tags(20, [
          ...(c.pk ? [['PK', 'pk'] as [string, string]] : []),
          ...(c.references ? [['FK', 'fk'] as [string, string]] : []),
          ...(c.unique && !c.pk ? [['UQ', 'uq'] as [string, string]] : []),
          ...(c.index && !c.pk && !c.unique ? [['IX', 'ix'] as [string, string]] : []),
        ]);
        items.push({ t: 'row', y: ry, tags: tg.tags, nameX: tg.x, name: trunc(c.name, Math.max(6, (w - tg.x - 90) / 6.4)), pk: c.pk, type: c.type + (c.nullable ? '?' : ''), anchor: `${t.name}|${c.name}` });
        ry += EXP.row;
      }
      y += EXP.tableHead + cols.length * EXP.row + EXP.tablePad + EXP.tableGap;
    }
  } else if (dk === 'endpoints') {
    for (const ep of n.endpoints ?? []) {
      const hc = ep.headers?.length ?? 0;
      items.push({ t: 'endpoint', y, method: ep.method, path: trunc(ep.path, (w - 74 - 40) / 6.4), meta: [hc ? `${hc}h` : '', ep.req ? 'req' : '', ep.res ? 'res' : ''].filter(Boolean).join(' ') });
      y += EXP.endpointRow;
    }
  } else if (dk === 'topic' || dk === 'message') {
    const fields = topicFields(n);
    if (fields.length) {
      let rec = '';
      try { rec = JSON.parse(n.schema ?? '').name ?? ''; } catch { /* no record name */ }
      items.push({ t: 'topic', y, name: trunc(rec || 'value', (w - 110) / 7), partitions: `${n.partitions ?? '?'} partitions` });
      y += EXP.topicHead;
      for (const [fname, ftype] of fields) {
        const tg = tags(22, n.key && n.key === fname ? [['KEY', 'pk']] : []);
        items.push({ t: 'row', y: y + 10, tags: tg.tags, nameX: tg.x, name: fname, type: ftype });
        y += EXP.topicRow;
      }
    }
  }
  return items;
}

/** Foreign-key lines between table rows, where both ends are drawn expanded. */
export function fkPaths(doc: Doc): string[] {
  const anchors = new Map<string, { x: number; y: number; w: number }>();
  for (const n of doc.nodes) {
    if (doc.detail?.[n.id] !== 'expanded' || detailOf(n) !== 'tables') continue;
    const w = nodeW(doc, n);
    for (const it of layoutDetail(n, w)) if (it.t === 'row' && it.anchor) anchors.set(`${n.id}|${it.anchor}`, { x: n.x + 12, y: n.y + it.y - 4, w: w - 24 });
  }
  const out: string[] = [];
  for (const fk of foreignKeys(doc)) {
    const a = anchors.get(`${fk.from.node}|${fk.from.table}|${fk.from.col}`), b = anchors.get(`${fk.to.node}|${fk.to.table}|${fk.to.col}`);
    if (!a || !b) continue;
    // leave from the right edge of the row; within one node, loop outside the box back to the target row
    const ax = a.x + a.w, bx = b.x + b.w;
    if (fk.from.node === fk.to.node) out.push(`M${ax} ${a.y} C${ax + 22} ${a.y} ${bx + 22} ${b.y} ${bx} ${b.y}`);
    else { const bulge = Math.max(40, Math.abs(bx - ax) / 2); out.push(`M${ax} ${a.y} C${ax + bulge} ${a.y} ${b.x - bulge} ${b.y} ${b.x} ${b.y}`); }
  }
  return out;
}
