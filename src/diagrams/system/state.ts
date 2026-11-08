/** Access to the open system diagram: the document, its capacity results and the selected items. */
import { compute, type Results } from '../../domain/engine';
import { nextId, type Doc, type Node } from '../../domain/model';
import { change, editor, useEditor } from '../../store/editor';

export const sysDoc = (): Doc => editor().open.doc as Doc;
export const useSysDoc = (): Doc => useEditor(s => s.open.doc) as Doc;
/** Change the system diagram (an undo step, or part of the transaction in progress). */
export const edit = (recipe: (doc: Doc) => void) => change('system', d => recipe(d as unknown as Doc));

/**
 * Capacity results, computed once per document version — and not at all when only positions changed
 * (dragging): where things are drawn doesn't change the load model.
 */
const cache = new WeakMap<Doc, Results>();
let last: { doc: Doc; results: Results } | null = null;
export function resultsOf(doc: Doc): Results {
  let r = cache.get(doc);
  if (!r) {
    r = last && onlyMoved(last.doc, doc) ? last.results : compute(doc);
    cache.set(doc, r);
  }
  last = { doc, results: r };
  return r;
}
function onlyMoved(a: Doc, b: Doc): boolean {
  if (a.edges !== b.edges || a.containers !== b.containers || a.links !== b.links || a.nodes.length !== b.nodes.length) return false;
  return a.nodes.every((n, i) => {
    const m = b.nodes[i];
    if (n === m) return true;
    if (n.id !== m.id) return false;
    const keys = new Set([...Object.keys(n), ...Object.keys(m)]);
    for (const k of keys) if (k !== 'x' && k !== 'y' && (n as unknown as Record<string, unknown>)[k] !== (m as unknown as Record<string, unknown>)[k]) return false;
    return true;
  });
}
export const useResults = () => resultsOf(useSysDoc());

/** The selected nodes (primary first). */
export function selectedNodeIds(): string[] {
  const s = editor().selection;
  if (s?.type !== 'node') return [];
  const doc = sysDoc();
  return s.ids.filter(id => doc.nodes.some(n => n.id === id));
}
const maps = new WeakMap<Doc, Map<string, Node>>();
/** Nodes by id (built once per document version). */
export function nodeMap(doc: Doc): Map<string, Node> {
  let m = maps.get(doc);
  if (!m) { m = new Map(doc.nodes.map(n => [n.id, n])); maps.set(doc, m); }
  return m;
}
export const findNode = (doc: Doc, id: string | null | undefined): Node | undefined => (id ? nodeMap(doc).get(id) : undefined);

/** A new id that nothing in the diagram uses yet (`candidate` when it's free). */
export function freshId(doc: Doc, prefix: 'n' | 'e' | 'c' | 'l', candidate?: string): string {
  const taken = new Set<string>([...doc.nodes, ...doc.edges, ...doc.containers, ...doc.links].map(x => x.id));
  if (candidate && !taken.has(candidate)) return candidate;
  let id: string;
  do id = nextId(prefix); while (taken.has(id));
  return id;
}
