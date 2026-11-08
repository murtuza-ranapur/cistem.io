/**
 * The system diagram a sequence draws on ("uses"): lifelines link to its components, which gives the
 * sequence timings, status colours and label suggestions — and the components a list of where they appear.
 */
import { create } from 'zustand';
import { typeDef, type Doc } from '../../domain/model';
import { compute, type Results } from '../../domain/engine';
import { fromFile } from '../../domain/document';
import type { Participant, SeqDoc } from '../../domain/seq';
import { api } from '../../lib/api';
import { peek, tabFor, tabs, useTabs } from '../../store/tabs';
import { useCloud } from '../../store/cloud';
import { editor } from '../../store/editor';

export interface LinkedSystem { doc: Doc; res: Results; title: string; key?: string }

/** System diagrams not open on this device, fetched once from the account. */
const useFetched = create(() => ({ docs: {} as Record<string, Doc> }));
const fetching = new Set<string>();

const results = new WeakMap<Doc, Results>();
function resultsOf(d: Doc): Results {
  let r = results.get(d);
  if (!r) { r = compute(d); results.set(d, r); }
  return r;
}

/** The system diagram `d` uses, with its capacity results; null when unlinked or unavailable (yet). */
export function linkedSystem(d: SeqDoc): LinkedSystem | null {
  const u = d.uses; if (!u) return null;
  const t = tabFor(u);
  if (t) {
    const p = peek(t.key);
    if (p?.open.kind === 'system') return { doc: p.open.doc, res: resultsOf(p.open.doc), title: p.title, key: t.key };
  }
  if (!u.id) return null;
  const fetched = useFetched.getState().docs[u.id];
  if (fetched) return { doc: fetched, res: resultsOf(fetched), title: u.title ?? 'system' };
  if (useCloud.getState().user && !fetching.has(u.id)) {
    const id = u.id;
    fetching.add(id);
    api.get(id)
      .then(s => { if ((s.document as { kind?: string }).kind !== 'sequence') useFetched.setState(f => ({ docs: { ...f.docs, [id]: fromFile(s.document).doc } })); })
      .catch(() => {});
  }
  return null;
}
/** The linked system for the open sequence, re-evaluated when the document, the tabs or a fetch change. */
export function useLinkedSystem(d: SeqDoc): LinkedSystem | null {
  useTabs(s => s.list);
  useFetched(s => s.docs);
  return linkedSystem(d);
}
/** Same, from the open document (for code outside components). */
export const openLinkedSystem = () => linkedSystem(editor().open.doc as SeqDoc);

/** The component a lifeline is linked to, if it exists in the linked system. */
export const nodeOf = (p: Participant | undefined, sys: { doc: Doc } | null) => (p?.ref && sys ? sys.doc.nodes.find(n => n.id === p.ref) : undefined);

export const REPLY_LABELS = ['200 OK', '201 Created', '202 Accepted', '204 No Content', '400 Bad Request', '404 Not Found'];

/** What a message to `to` is likely to say: its endpoints, topic actions, table queries. */
export function labelSuggestions(d: SeqDoc, to: string): string[] {
  const n = nodeOf(d.participants.find(p => p.id === to), linkedSystem(d));
  if (!n) return [];
  const out: string[] = [];
  (n.endpoints ?? []).forEach(e => out.push(`${e.method} ${e.path}`));
  (n.tables ?? []).forEach(t => out.push(`query ${t.name}`, `insert ${t.name}`));
  const beh = typeDef(n.kind).behaviour;
  if (beh === 'async') out.push(`publish ${n.name}`, 'consume');
  if (beh === 'cache') out.push('get', 'set');
  return out;
}

/** Which open sequences use component `nodeId` of the open system diagram (for its panel's "Appears in"). */
export function appearsIn(nodeId: string): { key: string; title: string }[] {
  const { list, active } = tabs();
  const me = list.find(t => t.key === active);
  if (!me || me.kind !== 'system') return [];
  const out: { key: string; title: string }[] = [];
  for (const t of list) {
    if (t.kind !== 'sequence') continue;
    const p = peek(t.key);
    if (p?.open.kind !== 'sequence') continue;
    const u = p.open.doc.uses;
    if (!u || !((u.id && u.id === me.cloudId) || (u.tab && u.tab === me.key))) continue;
    if (p.open.doc.participants.some(x => x.ref === nodeId)) out.push({ key: t.key, title: p.title });
  }
  return out;
}
