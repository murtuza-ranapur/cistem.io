/**
 * Copy and paste for system diagrams. The clipboard text is readable JSON marked `"cistem-clipboard": 1`
 * with the copied components, the connections between them, and copied environments with their contents.
 */
import { readAny } from '../../domain/document';
import type { Container, Doc, Edge, Frame, Link, Node } from '../../domain/model';
import { editor, select } from '../../store/editor';
import { pointerWorld, type Point } from '../../store/viewport';
import { snap } from './geometry';
import { edit, freshId, selectedNodeIds, sysDoc } from './state';

const MARK = 'cistem-clipboard';
interface Clip { nodes: Node[]; edges: Edge[]; containers: Container[]; links: Link[]; frames: Record<string, Frame> }

/** The selection as clipboard text (null: nothing copyable selected). */
export function copy(): string | null {
  const d = sysDoc(), s = editor().selection;
  // a selected environment brings everything inside it (nested environments included)
  const cids = new Set<string>(s?.type === 'container' ? [s.ids[0]] : []);
  for (let grew = true; grew;) { grew = false; for (const c of d.containers) if (c.parent && cids.has(c.parent) && !cids.has(c.id)) { cids.add(c.id); grew = true; } }
  const nids = new Set([...selectedNodeIds(), ...d.nodes.filter(n => n.container && cids.has(n.container)).map(n => n.id)]);
  if (!nids.size && !cids.size) return null;
  return JSON.stringify({
    [MARK]: 1, kind: 'system',
    nodes: d.nodes.filter(n => nids.has(n.id)),
    edges: d.edges.filter(e => nids.has(e.from) && nids.has(e.to)),
    containers: d.containers.filter(c => cids.has(c.id)),
    links: d.links.filter(l => cids.has(l.from) && cids.has(l.to)),
    frames: Object.fromEntries([...cids].filter(id => d.frames[id]).map(id => [id, d.frames[id]])),
  }, null, 2);
}

/** Read clipboard text: a selection copied here (or edited by hand), or a whole system file. Sanitised by the file reader. */
function readClip(text: string): { clip: Clip; homes: Record<string, string> } | null {
  let j: any;
  try { j = JSON.parse(text); } catch { return null; }
  // environments the copied items were in (the reader drops references to ones not in the copy)
  const homes: Record<string, string> = {};
  let file: unknown = null;
  if (j && j[MARK] === 1 && j.kind === 'system') {
    const nodes = Array.isArray(j.nodes) ? j.nodes : [], containers = Array.isArray(j.containers) ? j.containers : [];
    for (const n of nodes) if (n && typeof n.id === 'string' && typeof n.container === 'string') homes[n.id] = n.container;
    for (const c of containers) if (c && typeof c.id === 'string' && typeof c.parent === 'string') homes[c.id] = c.parent;
    file = { version: 4, kind: 'system', meta: { title: '' }, model: { nodes, edges: j.edges ?? [], containers, links: j.links ?? [] }, layout: { positions: Object.fromEntries(nodes.map((n: Node) => [n?.id, { x: n?.x, y: n?.y }])), frames: j.frames ?? {} } };
  } else if (j && j.kind === 'system' && j.model) file = j;
  if (!file) return null;
  try {
    const l = readAny(file);
    if (l.kind !== 'system') return null;
    return { clip: l.doc, homes };
  } catch { return null; }
}

/**
 * Paste at the pointer when it's over the canvas, otherwise stepped down-right of the original (`repeat` times).
 * Beside the original, pasted items stay in their environments; at the pointer they land outside any.
 */
export function paste(text: string, at: Point | null, repeat: number): boolean {
  const read = readClip(text);
  if (!read || (!read.clip.nodes.length && !read.clip.containers.length)) return false;
  const { clip, homes } = read;
  at ??= pointerWorld();
  const xs = [...clip.nodes.map(n => n.x), ...Object.values(clip.frames).map(f => f.x)], ys = [...clip.nodes.map(n => n.y), ...Object.values(clip.frames).map(f => f.y)];
  const dx = at ? snap(at.x - Math.min(...xs)) : 32 * repeat, dy = at ? snap(at.y - Math.min(...ys)) : 32 * repeat;
  const nmap: Record<string, string> = {}, cmap: Record<string, string> = {};
  edit(d => {
    const exists = (id: string | null | undefined) => !!id && d.containers.some(c => c.id === id);
    for (const c of clip.containers) { cmap[c.id] = freshId(d as Doc, 'c'); d.containers.push({ ...c, id: cmap[c.id] }); }
    for (const c of clip.containers) {
      const pasted = d.containers.find(x => x.id === cmap[c.id])!, up = c.parent ?? homes[c.id];
      pasted.parent = up ? (cmap[up] ?? (exists(up) ? up : null)) : null;
      const f = clip.frames[c.id]; if (f) d.frames[cmap[c.id]] = { ...f, x: f.x + dx, y: f.y + dy };
    }
    for (const n of clip.nodes) {
      const home = n.container ?? homes[n.id];
      nmap[n.id] = freshId(d as Doc, 'n');
      d.nodes.push({ ...structuredClone(n), id: nmap[n.id], x: n.x + dx, y: n.y + dy, container: home ? (cmap[home] ?? (exists(home) && !at ? home : null)) : null });
    }
    for (const e of clip.edges) if (nmap[e.from] && nmap[e.to]) d.edges.push({ ...e, id: freshId(d as Doc, 'e'), from: nmap[e.from], to: nmap[e.to] });
    for (const l of clip.links) if (cmap[l.from] && cmap[l.to]) d.links.push({ ...l, id: freshId(d as Doc, 'l'), from: cmap[l.from], to: cmap[l.to] });
  });
  const nodes = Object.values(nmap);
  select(nodes.length ? { type: 'node', ids: nodes } : { type: 'container', ids: [Object.values(cmap)[0]] });
  return true;
}
