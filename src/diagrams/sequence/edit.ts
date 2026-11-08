/** Editing text in place on the drawing: a message label, a note, a block's guard, or a lifeline's name. */
import { SEQ, textW, slugId, type SeqDoc } from '../../domain/seq';
import { change, editor } from '../../store/editor';
import { docOf } from '../shared';
import { geometry } from './geometry';
import { useSeqUi, type Editing } from './state';
import { renameId } from './actions';

const seq = () => docOf('sequence');
/** World → position within the stage (the canvas fills it). */
function place(x: number, y: number, w: number): Pick<Editing, 'x' | 'y' | 'w'> {
  const v = editor().view;
  return { x: x * v.k + v.x, y: y * v.k + v.y, w: Math.max(140, w * v.k) };
}

/** Open the text box on row `id`. */
export function startEdit(id: string) {
  const d = seq(), i = d.rows.findIndex(r => r.id === id), r = d.rows[i]; if (!r) return;
  const g = geometry(d), at = g.rows[i];
  let e: Editing | null = null;
  if (r.t === 'msg') {
    const xa = g.colX[r.from], xb = g.colX[r.to];
    const w = r.from === r.to ? 220 : Math.max(160, Math.abs(xb - xa) - 20);
    const x = r.from === r.to ? xa + 48 : (xa + xb) / 2 - w / 2;
    e = { id, part: false, ...place(x, at.ay - 26, w), value: r.label, list: true };
  } else if (r.t === 'note') {
    const xs = r.over.map(p => g.colX[p]);
    e = { id, part: false, ...place(Math.min(...xs) - 30, at.y + 8, Math.max(200, Math.max(...xs) - Math.min(...xs) + 60)), value: r.text, list: false };
  } else if (r.t === 'open' || r.t === 'else') {
    const b = r.t === 'open' ? g.blocks.find(x => x.id === id) : g.blocks.find(x => x.elses.some(el => el.id === id));
    e = { id, part: false, ...place((b?.x1 ?? 0) + (r.t === 'open' ? textW(r.kind) + 30 : 8), at.ay - 2, 220), value: r.guard, list: false };
  }
  useSeqUi.setState({ editing: e });
}
/** Open the text box on lifeline `pid`'s name. */
export function startEditPart(pid: string) {
  const d = seq(), p = d.participants.find(x => x.id === pid); if (!p) return;
  const g = geometry(d);
  useSeqUi.setState({ editing: { id: pid, part: true, ...place(g.colX[pid] - SEQ.headW / 2 + 6, SEQ.top + 20, SEQ.headW - 12), value: p.name, list: false } });
}
export const cancelEdit = () => useSeqUi.setState({ editing: null });

/** Apply the text box's value. */
export function commitEdit(value: string) {
  const e = useSeqUi.getState().editing; if (!e) return;
  useSeqUi.setState({ editing: null });
  const v = value.trim();
  if (e.part) {
    const p = seq().participants.find(x => x.id === e.id);
    if (!p || !v || v === p.name) return;
    // a lifeline still carrying its placeholder id takes one from its new name
    if (/^participant-\d+$/.test(p.id)) { renameId(p.id, slugId(v, seq().participants.filter(x => x !== p).map(x => x.id)), v); return; }
    change('sequence', d => { const q = d.participants.find(x => x.id === e.id); if (q) q.name = v; });
    return;
  }
  change('sequence', d => setText(d, e.id, v));
}
function setText(d: SeqDoc, id: string, v: string) {
  const r = d.rows.find(x => x.id === id); if (!r) return;
  if (r.t === 'msg') r.label = v; else if (r.t === 'note') r.text = v; else if (r.t !== 'close') r.guard = v;
}
