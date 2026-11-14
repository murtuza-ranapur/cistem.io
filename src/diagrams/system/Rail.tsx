/** The system palette, built from shared/component-types.json: click to add, drag onto the canvas, or search. */
import { NODE_H, TYPES, typeDef } from '../../domain/model';
import { Icon } from '../../ui/Icon';
import { addContainer, addNode } from './actions';
import { kindColour } from './geometry';
import type { PaletteSection } from '../../palette/types';

const GROUPS: Record<string, string> = { traffic: 'Traffic', compute: 'Compute', data: 'Data', messaging: 'Messaging' };

/** Kinds by group, in the file's order (also the 1–9 quick-add order). */
const byGroup = () => {
  const out = new Map<string, string[]>();
  for (const k of Object.keys(TYPES)) { const g = typeDef(k).group; out.set(g, [...(out.get(g) ?? []), k]); }
  return out;
};
export const RAIL_ORDER = (): string[] => [...byGroup().values()].flat();

export function usePalette(): PaletteSection[] {
  const sections: PaletteSection[] = [...byGroup()].map(([g, kinds]) => ({
    title: GROUPS[g] ?? g,
    items: kinds.map(k => {
      const t = typeDef(k);
      return {
        key: k, label: t.label, about: t.about, aliases: t.aliases,
        icon: <span className="pal-ic" style={{ '--kc': kindColour(k) } as React.CSSProperties}><Icon name={t.icon} /></span>,
        attrs: { 'data-add': k },
        drag: ['text/kind', k] as [string, string],
        add: at => { if (at) addNode(k, at.x - t.w / 2, at.y - NODE_H / 2); else addNode(k); },
      };
    }),
  }));
  sections.push({ title: 'Canvas', items: [{
    key: 'environment', label: 'Environment', about: 'A box around components: an account, a VPC, a cluster', aliases: ['container', 'vpc', 'account', 'cluster', 'region', 'group'],
    icon: <span className="pal-ic" style={{ '--kc': 'var(--muted)' } as React.CSSProperties}><Icon name="ic-container" /></span>,
    attrs: { 'data-add-container': '1' }, drag: ['text/container', '1'],
    add: at => { if (at) addContainer('cloud', at.x - 130, at.y - 70); else addContainer(); },
  }] });
  return sections;
}
