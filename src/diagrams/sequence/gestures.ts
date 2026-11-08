/**
 * Direct manipulation on the drawing. Positions come from the model, so gestures are about order:
 * drag from one lifeline to another to insert a message where you let go, drag a message (or a block's tab)
 * up or down to move it, drag a lifeline's head sideways to reorder. Empty canvas pans.
 */
import { editor, select, selectOne, setView, toggleSelected } from '../../store/editor';
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

export function useSeqGestures() {
  const doubleTap = useDoubleTap();

  const onPointerDown = (ev: PointerEv) => {
    if (ev.button !== 0) return;
    const t = ev.target as Element, p = toWorld(ev.clientX, ev.clientY), v = editor().view;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const head = data(t, 'head'), life = data(t, 'life'), id = data(t, 'grip') ?? data(t, 'row');
    if (head) { setDrag({ t: 'head', pid: head, x0: p.x, x: p.x, at: 0, moved: false }); return; }
    if (id) {
      const rows = seq().rows, i = rows.findIndex(r => r.id === id);
      if (i < 0) return;
      // shift-click builds a set of rows (to wrap in a block)
      if (ev.shiftKey) { toggleSelected('row', id); setDrag(null); return; }
      selectOne('row', id);
      const span = spanOf(rows, i);
      setDrag(span ? { t: 'move', rowId: id, span, y0: p.y, y: p.y, at: i, moved: false } : null);
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
          if (!d.moved && Math.abs(p.y - d.y0) < 6 / k) return null;
          const from = seq().rows.findIndex(r => r.id === d.rowId);
          return { ...d, moved: true, y: p.y, at: indexAt(g, p.y, { from, span: d.span }) };
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
      case 'move':
        if (!d.moved) { if (doubleTap('row:' + d.rowId, ev)) startEdit(d.rowId); return; }
        moveRows(d.rowId, d.span, d.at);
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
