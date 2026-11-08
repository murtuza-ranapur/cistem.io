/** The class diagram: types, their members, and how they relate. */
import { blankCls, type ClassDoc } from '../../domain/cls';
import { clsToFile } from '../../domain/document';
import { primary } from '../../store/editor';
import * as history from '../../store/history';
import { fitTo } from '../../store/viewport';
import { docOf } from '../shared';
import { hasMod } from '../../lib/browser';
import type { DiagramModule } from '../types';
import { addClass, nudge, organise, remove, selectAll, startRename } from './actions';
import { copy, paste } from './clipboard';
import { classBounds, findClass, rectOf, QUICK } from './model';
import { clsUi, useClsUi } from './ui';
import { Canvas } from './Canvas';
import { Panel } from './Panel';
import { Rail } from './Rail';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function keydown(ev: KeyboardEvent): boolean {
  const mod = hasMod(ev), k = ev.key.toLowerCase();
  if (ev.key === 'Escape' && clsUi().picker) { useClsUi.setState({ picker: null }); return true; }
  const name = primary('class');
  if (ev.key === 'Enter' && name) { startRename(name); return true; }
  if (mod || ev.altKey) return false;
  if (k === 'o') { organise(); return true; }
  if (/^[1-5]$/.test(ev.key)) { addClass(QUICK[+ev.key - 1]); return true; }
  const step = ev.shiftKey ? 32 : 8;
  const dirs: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  return !!dirs[ev.key] && nudge(...dirs[ev.key]);
}

export const classes: DiagramModule<'class'> = {
  kind: 'class',
  label: 'class',
  untitled: 'Untitled classes',
  blank: blankCls,
  toFile: (doc, meta) => clsToFile(doc, meta),
  Canvas, Rail, Panel,
  // the panel always has something: a class, a relation, or the diagram's generators and Code tab
  panelFor: sel => !!sel,
  verdict: (d: ClassDoc) => ({ status: 'none', text: `${plural(d.classes.length, 'class', 'classes')} · ${plural(d.relations.length, 'relation', 'relations')}` }),
  bounds: classBounds,
  // class boxes are text-heavy: don't blow them up past 120%
  fit: animated => fitTo(classBounds(docOf('class')), { animated, maxK: 1.2, pad: 60 }),
  selectionBox: (d, sel) => { const c = sel.type === 'class' ? findClass(d, sel.ids[0]) : undefined; return c ? rectOf(d, c) : null; },
  selectionAt(target) {
    const c = target.closest<SVGElement>('[data-class]')?.dataset.class;
    if (c) return { type: 'class', ids: [c] };
    const r = target.closest<SVGElement>('[data-rel]')?.dataset.rel;
    return r ? { type: 'rel', ids: [r] } : null;
  },
  keydown, remove, selectAll, organise,
  // a duplicate is a paste of a copy: every selected class, with the relations between them
  duplicate: () => { const text = copy(); if (text) history.transaction(() => paste(text, 1)); },
  copy,
  paste: (text, _at, repeat) => paste(text, repeat),
};
