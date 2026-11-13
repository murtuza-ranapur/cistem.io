/** The system diagram: components with capacity, connections, environments and load. */
import { noteBoxes } from '../../notes/boxes';
import { adopt, makeNode } from '../../domain/model';
import { toFile } from '../../domain/document';
import { hasMod } from '../../lib/browser';
import type { DiagramModule } from '../types';
import { Canvas, requestRename } from './Canvas';
import { Rail, RAIL_ORDER } from './Rail';
import { Panel } from './panel/Panel';
import { SystemTools, LoadButton } from './HeaderItems';
import { loadOn, toggleLoadView } from '../../store/loadView';
import { addContainer, addNode, duplicateSelection, nudge, organise, removeSelection, selectAll, toggleAllDetail, toggleDetail } from './actions';
import { copy, paste } from './clipboard';
import { madeFrom } from './madeFrom';
import { bounds } from '../../store/viewport';
import { computeFrames, diagramBounds, nodeBox } from './geometry';
import { resultsOf, selectedNodeIds } from './state';
import { fmtMs } from '../../lib/format';
import { editor } from '../../store/editor';

const VERDICT = { ok: 'Handles it', warn: 'Near limit', crit: 'Breaks' } as const;
const ms = (v: number) => v >= 1e4 ? fmtMs(v) : v.toFixed(0) + ' ms';

function keydown(ev: KeyboardEvent): boolean {
  const mod = hasMod(ev), key = ev.key.toLowerCase();
  if (mod || ev.altKey) return false;
  const sel = editor().selection;
  if (key === 'o') { organise(); return true; }
  if (key === 'l') { toggleLoadView(); return true; }
  if (key === 'e') { addContainer(); return true; }
  if (ev.key === ' ') { if (ev.shiftKey) toggleAllDetail(); else if (sel?.type === 'node') toggleDetail(sel.ids[0]); return true; }
  if (ev.key === 'Enter' && sel?.type === 'node') { requestRename(sel.ids[0]); return true; }
  const step = ev.shiftKey ? 32 : 8;
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[ev.key]) { if (selectedNodeIds().length) nudge(...arrows[ev.key]); return true; }
  // quick-add: 1–9 in rail order
  if (/^[1-9]$/.test(ev.key)) { const k = RAIL_ORDER()[+ev.key - 1]; if (k) addNode(k); return true; }
  return false;
}

export const system: DiagramModule<'system'> = {
  kind: 'system', label: 'system', untitled: 'Untitled system',
  blank: () => adopt({ nodes: [makeNode('entry', 80, 200)], edges: [], containers: [], links: [], frames: {}, detail: {} }),
  toFile: (doc, meta) => toFile(doc, meta),

  Canvas, Rail, Panel,
  HeaderInfo: LoadButton,
  Tools: SystemTools,
  panelFor: sel => sel?.type === 'node' || sel?.type === 'edge' || sel?.type === 'container',
  verdict(doc) {
    if (!loadOn()) return null;
    const v = resultsOf(doc).verdict;
    return {
      status: v.status,
      text: (v.node && resultsOf(doc).nodes[v.node.id]?.lag ? 'Falls behind' : VERDICT[v.status]) + (v.node ? ` at ${v.node.name}` : ''),
      detail: `~${ms(v.lat)}` + (v.converged ? '' : ' · not converging'),
      // the time after a publish isn't part of the request: kept out of the badge, in its tooltip
      title: `Request: ~${ms(v.lat)} end to end` + (v.asyncLat > 0 ? `\nAfter a publish: ~${ms(v.asyncLat)} through the consumers${Object.values(resultsOf(doc).nodes).some(r => r.lag) ? ', plus the lag of any falling behind' : ''}` : ''),
    };
  },

  bounds: doc => bounds([...diagramBounds(doc), ...noteBoxes(doc.notes)]),
  selectionBox(doc, sel) {
    if (sel.type === 'node') { const n = doc.nodes.find(x => x.id === sel.ids[0]); return n ? nodeBox(doc, n) : null; }
    if (sel.type === 'container') { const f = computeFrames(doc)[sel.ids[0]]; return f ? { x: f.x, y: f.y, w: Math.min(f.w, 360), h: Math.min(f.h, 60) } : null; }
    return null;
  },
  selectionAt(target) {
    const node = target.closest<SVGElement>('[data-node]')?.dataset.node;
    if (node) return { type: 'node', ids: [node] };
    const edge = target.closest<SVGElement>('[data-edge]')?.dataset.edge;
    if (edge) return { type: 'edge', ids: [edge] };
    const c = target.closest<SVGElement>('[data-container]')?.dataset.container;
    return c ? { type: 'container', ids: [c] } : null;
  },

  keydown,
  remove: removeSelection,
  duplicate: duplicateSelection,
  selectAll,
  organise,
  madeFrom,
  copy,
  paste,
};
