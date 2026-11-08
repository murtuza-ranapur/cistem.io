/** Sequence diagrams: who calls whom, in order. Lifelines can link to a system diagram's components for timings. */
import { blankSeq, timing, type SeqDoc } from '../../domain/seq';
import { seqToFile } from '../../domain/document';
import { animate } from '../../lib/browser';
import { fmtMs } from '../../lib/format';
import { editor, setView } from '../../store/editor';
import { getSurface } from '../../store/viewport';
import type { DiagramModule, Verdict } from '../types';
import { SeqCanvas } from './Canvas';
import { SeqRail } from './Rail';
import { SeqPanel } from './Panel';
import { seqBounds } from './geometry';
import { linkedSystem, nodeOf } from './linked';
import { duplicateSelection, removeSelection, selectAll } from './actions';
import { copySequence, pasteSequence } from './clipboard';
import { seqKeydown } from './keys';

/** The header: end-to-end time from the capacity model, coloured by the worst linked component. */
function verdict(d: SeqDoc): Verdict {
  const sys = linkedSystem(d), tm = sys && timing(d, sys.doc, sys.res);
  if (!sys || !tm?.linked) return { status: 'none', className: 'seqtime muted', text: d.uses ? 'Link lifelines to components for timings' : 'Sequence' };
  const rank = { ok: 0, warn: 1, crit: 2 } as const;
  let worst: 'ok' | 'warn' | 'crit' = 'ok', worstName = '';
  for (const p of d.participants) {
    const n = nodeOf(p, sys), r = n && sys.res.nodes[n.id];
    if (r && rank[r.status] > rank[worst]) { worst = r.status; worstName = n!.name; }
  }
  return {
    status: worst, className: 'seqtime', text: `End to end ~${fmtMs(tm.total)}`,
    detail: worst === 'ok' ? `from ${sys.title}` : `${worstName} ${worst === 'crit' ? 'overloaded' : 'running hot'}`,
  };
}

/** Sequences read top-down: pin the heads near the top and centre sideways, never zooming in past 100%. */
function fit(animated: boolean) {
  const svg = getSurface(); if (!svg) return;
  const r = svg.getBoundingClientRect(); if (!r.width) return;
  const b = seqBounds(editor().open.doc as SeqDoc);
  const k = Math.min(1, Math.max(0.4, Math.min((r.width - 60) / b.w, (r.height - 40) / b.h)));
  const target = { k, x: Math.max(20, (r.width - b.w * k) / 2), y: 14 }, from = editor().view;
  animate(animated ? 220 : 0, t => setView({ k: from.k + (target.k - from.k) * t, x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t }));
}

export const sequence: DiagramModule<'sequence'> = {
  kind: 'sequence', label: 'sequence', untitled: 'Untitled sequence',
  blank: blankSeq,
  toFile: (doc, meta) => seqToFile(doc, meta),
  Canvas: SeqCanvas,
  Rail: SeqRail,
  Panel: SeqPanel,
  panelFor: sel => !!sel,
  verdict,
  bounds: seqBounds,
  fit,
  selectionAt: target => {
    const head = target.closest('[data-head]')?.getAttribute('data-head');
    if (head) return { type: 'part', ids: [head] };
    const row = target.closest('[data-grip]')?.getAttribute('data-grip') ?? target.closest('[data-row]')?.getAttribute('data-row');
    return row ? { type: 'row', ids: [row] } : null;
  },
  keydown: seqKeydown,
  remove: removeSelection,
  duplicate: duplicateSelection,
  selectAll,
  copy: copySequence,
  paste: text => pasteSequence(text),
};
