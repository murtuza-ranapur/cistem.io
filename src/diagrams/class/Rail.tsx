/** The class palette: one tile per kind (also the 1–5 keys). */
import type { ClassKind } from '../../domain/cls';
import { addClass } from './actions';
import { KIND_COLOR, QUICK, snap } from './model';
import type { PaletteSection } from '../../palette/types';

const TOOL: Record<ClassKind, { letter: string; label: string; about: string }> = {
  class: { letter: 'C', label: 'Class', about: 'A class with fields and methods' },
  interface: { letter: 'I', label: 'Interface', about: 'A contract classes implement' },
  enum: { letter: 'E', label: 'Enum', about: 'A fixed set of values' },
  record: { letter: 'R', label: 'Record', about: 'An immutable data class' },
  abstract: { letter: 'A', label: 'Abstract', about: 'An abstract class' },
};

export function usePalette(): PaletteSection[] {
  return [{ title: 'Types', items: QUICK.map(kind => {
    const t = TOOL[kind];
    return {
      key: kind, label: t.label, about: t.about, aliases: kind === 'record' ? ['data class', 'dto'] : kind === 'interface' ? ['trait', 'protocol'] : [],
      icon: <span className="cl-kw" style={{ '--kc': KIND_COLOR[kind], ...(kind === 'abstract' ? { fontStyle: 'italic' } : {}) } as React.CSSProperties}>{t.letter}</span>,
      attrs: { 'data-clstool': kind },
      place: { w: 180, h: 72, drop: (at: { x: number; y: number }) => addClass(kind, { x: snap(at.x), y: snap(at.y) }) },
      add: (at?: { x: number; y: number }) => addClass(kind, at ? { x: snap(at.x - 80), y: snap(at.y - 30) } : undefined),
    };
  }) }];
}
