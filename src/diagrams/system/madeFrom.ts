/** The + menu's "Made from this diagram": a sequence along a request path, class diagrams from tables and schemas. */
import { TYPES, isSource, type Node } from '../../domain/model';
import { sequenceFromPath } from '../../domain/seq';
import { fromTables, fromAvro, layoutCls } from '../../domain/cls';
import { seqToFile, clsToFile } from '../../domain/document';
import { editor } from '../../store/editor';
import { newTab, tabs, usesFor } from '../../store/tabs';
import { hint } from '../../store/ui';
import type { MadeFrom } from '../types';
import { findNode, sysDoc } from './state';

/** Where a request path starts: the selected component, else the first client, else anything. */
function pathStart(): Node | null {
  const doc = sysDoc(), s = editor().selection;
  return (s?.type === 'node' ? findNode(doc, s.ids[0]) : undefined) ?? doc.nodes.find(isSource) ?? doc.nodes[0] ?? null;
}

function sequenceFrom(start: Node) {
  const asyncKinds = new Set(Object.keys(TYPES).filter(k => TYPES[k].behaviour === 'async'));
  const seq = sequenceFromPath(sysDoc(), start.id, asyncKinds, usesFor(tabs().active) ?? undefined);
  if (!seq.rows.length) { hint(`${start.name} doesn't call anything yet`, 2000); return; }
  void newTab('sequence', seqToFile(seq, { title: `${start.name} flow` }));
}

function openClasses(doc: ReturnType<typeof fromTables>, title: string) {
  void newTab('class', clsToFile({ ...doc, pos: layoutCls(doc) }, { title }));
}

export function madeFrom(): MadeFrom | null {
  const start = pathStart();
  const extra = sysDoc().nodes.flatMap(n => {
    const out: MadeFrom['extra'] = [];
    if (n.tables?.length) out.push({ label: `Class diagram from ${n.name} tables`, run: () => openClasses(fromTables(n.tables!, n.name), `${n.name} model`) });
    if (typeof n.schema === 'string' && n.schema.trim().startsWith('{')) out.push({ label: `Class diagram from the ${n.name} schema`, run: () => openClasses(fromAvro(n.schema as string), `${n.name} schema`) });
    return out;
  });
  if (!start && !extra.length) return null;
  return { title: editor().meta.title, pathStart: start?.name ?? null, fromPath: () => start && sequenceFrom(start), extra };
}
