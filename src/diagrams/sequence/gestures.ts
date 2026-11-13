/**
 * Direct manipulation on the drawing. Positions come from the model, so gestures are about order:
 * drag from one lifeline to another to insert a message where you let go, drag a message (or a block's tab)
 * up or down to move it, drag a lifeline's head sideways to reorder. Empty canvas pans.
 */
import { change, editor, select, selectOne, setView, toggleSelected } from '../../store/editor';
import * as history from '../../store/history';
import { SEQ, HEAD_MIN, HEAD_MAX } from '../../domain/seq';
import { toWorld } from '../../store/viewport';
import { hint } from '../../store/ui';
import { docOf, useDoubleTap } from '../shared';
import { geometry, indexAt, nearestLife } from './geometry';
import { seqUi, setDrag, type Drag } from './state';
import { insertMessage, moveParticipant, moveRows, nameOf, spanOf, addParticipant } from './actions';
import { startEdit, startEditPart } from './edit';

type PointerEv = React.PointerEvent<SVGSVGElement>;
const seq = () => docOf('sequence');
const data = (t: Element, attr: string) => (t.closest(`[data-${attr}]`) as SVGElement | null)?.getAttribute(`data-${attr}`) ?? null;

let lastGrip = { id: '', t: 0 };
/** A note's lifelines moved `by` places along (clamped at the ends, keeping its span). */
function shiftedOver(over: string[], by: number): string[] {
  const ids = seq().participants.map(p => p.id), at = over.map(o => ids.indexOf(o)).filter(i => i >= 0);
  if (!at.length) return over;
  const lo = Math.min(...at), hi = Math.max(...at), k = Math.max(-lo, Math.min(ids.length - 1 - hi, by));
  return at.map(i => ids[i + k]);
}

export function useSeqGestures() {
  const doubleTap = useDoubleTap();

  const onPointerDown = (ev: PointerEv) => {
    if (ev.button !== 0) return;
    const t = ev.target as Element, p = toWorld(ev.clientX, ev.clientY), v = editor().view;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const head = data(t, 'head'), life = data(t, 'life'), id = data(t, 'grip') ?? data(t, 'row');
    // the ◀ ▶ nudges on a hovered head
    const nudge = data(t, 'nudge');
    if (head && nudge) {
      const ps = seq().participants, i = ps.findIndex(x => x.id === head);
      moveParticipant(head, i + (nudge === 'l' ? -1 : 1)); selectOne('part', head); setDrag(null); return;
    }
    // a selected head's right edge: drag to resize, double-click to fit the name again
    const grip = data(t, 'head-resize');
    if (grip) {
      const now = Date.now();
      if (lastGrip.id === grip && now - lastGrip.t < 350) { lastGrip = { id: '', t: 0 }; change('sequence', d => { const x = d.participants.find(q => q.id === grip); if (x) delete x.width; }); setDrag(null); return; }
      lastGrip = { id: grip, t: now };
      const i = seq().participants.findIndex(x => x.id === grip);
      setDrag({ t: 'hresize', pid: grip, x0: p.x, w0: geometry(seq()).cols[i]?.w ?? SEQ.headW, moved: false }); return;
    }
    // a selected note's edges: drag to span lifelines
    const edge = data(t, 'note-edge');
    if (edge && id) { setDrag({ t: 'nedge', rowId: id, side: edge as 'l' | 'r', moved: false }); return; }
    if (head) { setDrag({ t: 'head', pid: head, x0: p.x, x: p.x, at: 0, moved: false }); return; }
    if (id) {
      const rows = seq().rows, i = rows.findIndex(r => r.id === id);
      if (i < 0) return;
      // shift-click builds a set of rows (to wrap in a block)
      if (ev.shiftKey) { toggleSelected('row', id); setDrag(null); return; }
      selectOne('row', id);
      const span = spanOf(rows, i);
      setDrag(span ? { t: 'move', rowId: id, span, y0: p.y, y: p.y, at: i, moved: false, ...(rows[i].t === 'note' ? { x0: p.x, shift: 0 } : {}) } : null);
      return;
    }
    if (life) { setDrag({ t: 'msg', from: life, x: p.x, y: p.y, to: null, at: indexAt(geometry(seq()), p.y), moved: false }); return; }
    setDrag({ t: 'pan', sx: ev.clientX, sy: ev.clientY, vx: v.x, vy: v.y, moved: false });
  };

  const onPointerMove = (ev: PointerEv) => {
    const d = seqUi().drag; if (!d) return;
    const p = toWorld(ev.clientX, ev.clientY), k = editor().view.k, g = geometry(seq());
    const next = ((): Drag | null => {
      switch (d.t) {
        case 'pan': {
          const dx = ev.clientX - d.sx, dy = ev.clientY - d.sy;
          if (!d.moved && Math.hypot(dx, dy) < 4) return null;
          setView({ k, x: d.vx + dx, y: d.vy + dy });
          return d.moved ? null : { ...d, moved: true };
        }
        case 'msg': {
          if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) < 6 / k) return null;
          const to = nearestLife(g, p.x);
          hint(to ? (to === d.from ? 'Release to add a message to itself' : `Release to add a message ${nameOf(seq(), d.from)} → ${nameOf(seq(), to)}`) : 'Release on a lifeline');
          return { ...d, moved: true, x: p.x, to, at: indexAt(g, d.y) };
        }
        case 'move': {
          const sideways = d.x0 !== undefined ? p.x - d.x0 : 0;
          if (!d.moved && Math.abs(p.y - d.y0) < 6 / k && Math.abs(sideways) < 6 / k) return null;
          const from = seq().rows.findIndex(r => r.id === d.rowId);
          // a note can also move sideways: by as many lifelines as the pointer has passed
          let shift = 0;
          if (d.x0 !== undefined) {
            const near = (x: number) => g.cols.reduce((b, c, ci) => (Math.abs(c.x - x) < Math.abs(g.cols[b].x - x) ? ci : b), 0);
            if (g.cols.length) shift = near(p.x) - near(d.x0);
            const r = seq().rows[from];
            if (r?.t === 'note' && shift) { const names = shiftedOver(r.over, shift).map(o => nameOf(seq(), o)); hint(`${r.pos ? (r.pos === 'left' ? 'Left of' : 'Right of') : 'Over'} ${names.join(', ')}`); }
            else hint(null);
          }
          return { ...d, moved: true, y: p.y, at: indexAt(g, p.y, { from, span: d.span }), shift };
        }
        case 'hresize': {
          if (!d.moved && Math.abs(p.x - d.x0) < 3 / k) return null;
          if (!d.moved) history.begin();
          const width = Math.min(HEAD_MAX, Math.max(HEAD_MIN, Math.round((d.w0 + (p.x - d.x0) * 2) / 8) * 8));
          change('sequence', dd => { const x = dd.participants.find(q => q.id === d.pid); if (x) x.width = width; });
          return d.moved ? null : { ...d, moved: true };
        }
        case 'nedge': {
          const r = seq().rows.find(x => x.id === d.rowId);
          if (r?.t !== 'note' || !g.cols.length) return null;
          // the lifeline nearest the pointer becomes this end of the note's span
          const near = g.cols.reduce((b, c, ci) => (Math.abs(c.x - p.x) < Math.abs(g.cols[b].x - p.x) ? ci : b), 0);
          const ids = g.cols.map(c => c.id), have = r.over.map(o => ids.indexOf(o)).filter(i => i >= 0);
          let lo = Math.min(...have), hi = Math.max(...have);
          if (d.side === 'l') lo = Math.min(near, hi); else hi = Math.max(near, lo);
          const over = ids.slice(lo, hi + 1);
          if (over.join() !== r.over.join() || r.pos) {
            if (!d.moved) history.begin();
            change('sequence', dd => { const x = dd.rows.find(q => q.id === d.rowId); if (x?.t === 'note') { x.over = over; delete x.pos; } });
          }
          return d.moved ? null : { ...d, moved: true };
        }
        case 'head': {
          if (!d.moved && Math.abs(p.x - d.x0) < 6 / k) return null;
          const at = g.cols.findIndex(c => p.x < c.x);
          return { ...d, moved: true, x: p.x, at: at < 0 ? g.cols.length : at };
        }
      }
    })();
    if (next) setDrag(next);
  };

  const onPointerUp = (ev: PointerEv) => {
    const d = seqUi().drag; setDrag(null); hint(null);
    if (!d) return;
    const ps = seq().participants;
    switch (d.t) {
      case 'pan': if (!d.moved) select(null); return;
      case 'msg':
        if (!d.moved) { selectOne('part', d.from); return; }
        if (d.to && ps.some(p => p.id === d.from) && ps.some(p => p.id === d.to)) insertMessage(d.from, d.to, d.at, seqUi().tool);
        return;
      case 'move': {
        if (!d.moved) { if (doubleTap('row:' + d.rowId, ev)) startEdit(d.rowId); return; }
        history.transaction(() => {
          if (d.shift) change('sequence', dd => { const x = dd.rows.find(q => q.id === d.rowId); if (x?.t === 'note') x.over = shiftedOver(x.over, d.shift!); });
          moveRows(d.rowId, d.span, d.at);   // does nothing when it stays put
          return true;
        });
        return;
      }
      case 'hresize': case 'nedge':
        if (d.moved) history.end();
        return;
      case 'head': {
        if (!d.moved) { if (doubleTap('part:' + d.pid, ev)) startEditPart(d.pid); else selectOne('part', d.pid); return; }
        const i = ps.findIndex(p => p.id === d.pid);
        moveParticipant(d.pid, d.at > i ? d.at - 1 : d.at);
        return;
      }
    }
  };

  /** A real double-click (when the pointer-up pairing missed it): edit what's under the pointer. */
  const onDoubleClick = (ev: React.MouseEvent<SVGSVGElement>) => {
    if (seqUi().editing) return;
    const t = (document.elementFromPoint(ev.clientX, ev.clientY) ?? ev.target) as Element;
    const part = data(t, 'head');
    if (part) { startEditPart(part); return; }
    const id = data(t, 'edit') ?? data(t, 'row') ?? data(t, 'grip');
    if (id) startEdit(id);
    else if (!seq().participants.length) addParticipant();
  };

  return { onPointerDown, onPointerMove, onPointerUp, onDoubleClick, onPinchStart: () => setDrag(null) };
}
