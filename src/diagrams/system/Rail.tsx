/** The system palette, built from shared/component-types.json: click to add, drag onto the canvas, or search. */
import { NODE_H, TYPES, typeDef } from '../../domain/model';
import { Icon } from '../../ui/Icon';
import { addContainer, addNode } from './actions';
import { computeFrames, containerAt, kindColour, nodeH, nodeW } from './geometry';
import { sysDoc } from './state';
import type { DropPreview } from '../../palette/types';
import type { Point } from '../../store/viewport';
import type { PaletteSection } from '../../palette/types';

const GROUPS: Record<string, string> = { traffic: 'Traffic', compute: 'Compute', data: 'Data', messaging: 'Messaging' };

/** Kinds by group, in the file's order (also the 1–9 quick-add order). */
const byGroup = () => {
  const out = new Map<string, string[]>();
  for (const k of Object.keys(TYPES)) { const g = typeDef(k).group; out.set(g, [...(out.get(g) ?? []), k]); }
  return out;
};
export const RAIL_ORDER = (): string[] => [...byGroup().values()].flat();

const SNAP = 6;
/**
 * Where a card dropped with its top-left at `at` lands: lined up with a card nearby when it's within a few units
 * (a guide shows it), and the environment under its middle lights up.
 */
function landing(at: Point, w: number, h: number, isFrame = false): DropPreview {
  const d = sysDoc();
  // the nearest line-up within SNAP units, vertically and horizontally: middles, then top/left edges
  let dy = 0, gy: number | null = null, by = SNAP + 1, dx = 0, gx: number | null = null, bx = SNAP + 1;
  for (const n of d.nodes) {
    const nw = nodeW(d, n), nh = nodeH(d, n);
    for (const [mine, theirs] of [[at.y + h / 2, n.y + nh / 2], [at.y, n.y]]) {
      if (Math.abs(theirs - mine) < by) { by = Math.abs(theirs - mine); dy = theirs - mine; gy = theirs; }
    }
    for (const [mine, theirs] of [[at.x + w / 2, n.x + nw / 2], [at.x, n.x]]) {
      if (Math.abs(theirs - mine) < bx) { bx = Math.abs(theirs - mine); dx = theirs - mine; gx = theirs; }
    }
  }
  const x = at.x + (gx !== null ? dx : 0), y = at.y + (gy !== null ? dy : 0);
  const guides: { x?: number; y?: number }[] = [];
  if (gy !== null) guides.push({ y: gy });
  if (gx !== null) guides.push({ x: gx });
  const out: DropPreview = { at: { x, y }, guides };
  if (!isFrame) {
    const frames = computeFrames(d), into = containerAt(d, frames, x + w / 2, y + h / 2);
    const f = into ? frames[into] : null, c = into ? d.containers.find(cc => cc.id === into) : null;
    if (f && c) out.highlight = { box: { x: f.x, y: f.y, w: f.w, h: f.h }, label: `Drop into ${c.name}` };
  }
  return out;
}

export function usePalette(): PaletteSection[] {
  const sections: PaletteSection[] = [...byGroup()].map(([g, kinds]) => ({
    title: GROUPS[g] ?? g,
    items: kinds.map(k => {
      const t = typeDef(k);
      return {
        key: k, label: t.label, about: t.about, aliases: t.aliases,
        icon: <span className="pal-ic" style={{ '--kc': kindColour(k) } as React.CSSProperties}><Icon name={t.icon} /></span>,
        attrs: { 'data-add': k },
        place: { w: t.w, h: NODE_H, preview: (at: Point) => landing(at, t.w, NODE_H), drop: (at: Point) => addNode(k, at.x, at.y) },
        add: (at?: Point) => { if (at) addNode(k, at.x - t.w / 2, at.y - NODE_H / 2); else addNode(k); },
      };
    }),
  }));
  sections.push({ title: 'Canvas', items: [{
    key: 'environment', label: 'Environment', about: 'A box around components: an account, a VPC, a cluster', aliases: ['container', 'vpc', 'account', 'cluster', 'region', 'group'],
    icon: <span className="pal-ic" style={{ '--kc': 'var(--muted)' } as React.CSSProperties}><Icon name="ic-container" /></span>,
    attrs: { 'data-add-container': '1' },
    place: { w: 260, h: 140, preview: (at: Point) => landing(at, 260, 140, true), drop: (at: Point) => addContainer('cloud', at.x, at.y) },
    add: at => { if (at) addContainer('cloud', at.x - 130, at.y - 70); else addContainer(); },
  }] });
  return sections;
}
