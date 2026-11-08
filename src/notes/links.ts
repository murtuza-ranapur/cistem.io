/** `@` links in notes: what can be linked in the open diagram, and what clicking a link does. */
import type { Doc } from '../domain/model';
import type { SeqDoc } from '../domain/seq';
import type { ClassDoc } from '../domain/cls';
import { typeDef } from '../domain/model';
import { editor, selectOne, type SelectionType } from '../store/editor';
import { revealSelection } from '../store/commands';
import { hint } from '../store/ui';
import type { LinkTarget } from './NoteEditor';

/** Everything in the open diagram a note can point at. */
export function linkTargets(): LinkTarget[] {
  const { open } = editor();
  switch (open.kind) {
    case 'system': {
      const d = open.doc as Doc;
      return [
        ...d.nodes.map(n => ({ kind: 'node', id: n.id, name: n.name || n.id, sub: typeDef(n.kind).label })),
        ...d.containers.map(c => ({ kind: 'container', id: c.id, name: c.name || c.id, sub: 'Environment' })),
      ];
    }
    case 'sequence': return (open.doc as SeqDoc).participants.map(p => ({ kind: 'part', id: p.id, name: p.name || p.id, sub: 'Lifeline' }));
    case 'class': return (open.doc as ClassDoc).classes.map(c => ({ kind: 'class', id: c.name, name: c.name, sub: c.kind }));
  }
}

const KINDS: Record<string, SelectionType> = { node: 'node', container: 'container', part: 'part', class: 'class', edge: 'edge', rel: 'rel' };

/** Clicking a `@` link selects what it points at (and brings it into view), when it's in this diagram. */
export function openItem(kind: string, id: string) {
  const type = KINDS[kind];
  const exists = type && linkTargets().some(t => t.kind === kind && t.id === id);
  if (!exists) { hint('That item isn\'t in this diagram any more', 2000); return; }
  selectOne(type, id);
  requestAnimationFrame(revealSelection);
}
