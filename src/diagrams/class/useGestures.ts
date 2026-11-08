/**
 * Pointer gestures on the class canvas: drag boxes (the whole selection), drag a box's dot onto another class
 * to relate them, pan the empty canvas, double-click to edit a name or member (or add a class on empty canvas).
 */
import { useRef } from 'react';
import { editor, select, makePrimary, toggleSelected, selectOne, setView } from '../../store/editor';
import * as history from '../../store/history';
import { change } from '../../store/editor';
import { getSurface, toWorld } from '../../store/viewport';
import { hint } from '../../store/ui';
import { docOf } from '../shared';
import { addClass, selectedClasses, startEditMember, startRename } from './actions';
import { snap } from './model';
import { useClsUi } from './ui';

type Drag =
  | { t: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { t: 'move'; ids: string[]; sx: number; sy: number; from: Record<string, { x: number; y: number }>; moved: boolean }
  | { t: 'rel'; from: string };

const under = (ev: { clientX: number; clientY: number }, sel: string) =>
  (document.elementFromPoint(ev.clientX, ev.clientY) as Element | null)?.closest<SVGElement>(sel) ?? null;

export function useGestures() {
  const drag = useRef<Drag | null>(null);

  const onPointerDown = (ev: React.PointerEvent<SVGSVGElement>) => {
    if (ev.button !== 0) return;
    useClsUi.setState({ picker: null });
    const t = ev.target as Element, p = toWorld(ev.clientX, ev.clientY);
    const capture = () => ev.currentTarget.setPointerCapture(ev.pointerId);

    const port = t.closest<SVGElement>('[data-port]');
    if (port) {
      capture();
      drag.current = { t: 'rel', from: port.dataset.port! };
      useClsUi.setState({ drawing: { from: port.dataset.port!, x: p.x, y: p.y, over: null } });
      return;
    }
    const box = t.closest<SVGElement>('[data-class]');
    if (box) {
      const name = box.dataset.class!;
      if (ev.shiftKey) { toggleSelected('class', name); return; }
      makePrimary('class', name);
      const ids = selectedClasses(), pos = docOf('class').pos;
      capture();
      drag.current = { t: 'move', ids, sx: p.x, sy: p.y, from: Object.fromEntries(ids.map(n => [n, pos[n] ?? { x: 0, y: 0 }])), moved: false };
      return;
    }
    const rel = t.closest<SVGElement>('[data-rel]');
    if (rel) { selectOne('rel', rel.dataset.rel!); return; }
    capture();
    const v = editor().view;
    drag.current = { t: 'pan', sx: ev.clientX, sy: ev.clientY, vx: v.x, vy: v.y, moved: false };
  };

  const onPointerMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current; if (!d) return;
    const p = toWorld(ev.clientX, ev.clientY);
    if (d.t === 'pan') {
      const dx = ev.clientX - d.sx, dy = ev.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      setView({ ...editor().view, x: d.vx + dx, y: d.vy + dy });
      return;
    }
    if (d.t === 'move') {
      const dx = p.x - d.sx, dy = p.y - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 4 / editor().view.k) return;
      if (!d.moved) { d.moved = true; history.begin(); }
      change('class', draft => { for (const n of d.ids) draft.pos[n] = { x: snap(d.from[n].x + dx), y: snap(d.from[n].y + dy) }; });
      return;
    }
    const over = under(ev, '[data-class]')?.dataset.class ?? null;
    useClsUi.setState({ drawing: { from: d.from, x: p.x, y: p.y, over } });
    hint(over ? `${d.from} → ${over}: release to choose how they relate` : 'Drop on another class');
  };

  const onPointerUp = (ev: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.t === 'pan') { if (!d.moved) select(null); return; }
    if (d.t === 'move') { if (d.moved) history.end(); return; }
    const over = useClsUi.getState().drawing?.over ?? null;
    hint(null);
    useClsUi.setState({ drawing: null });
    if (!over) return;
    const r = getSurface()!.getBoundingClientRect();
    useClsUi.setState({ picker: { from: d.from, to: over, left: Math.min(ev.clientX - r.left + 8, r.width - 300), top: Math.min(ev.clientY - r.top + 8, r.height - 120) } });
  };

  const onDoubleClick = (ev: React.MouseEvent<SVGSVGElement>) => {
    const mem = under(ev, '[data-mem]');
    if (mem) { const [n, k, i] = mem.dataset.mem!.split(':'); startEditMember(n, k as 'f' | 'm', +i); return; }
    const box = under(ev, '[data-class]');
    if (box) { startRename(box.dataset.class!); return; }
    if (under(ev, '[data-rel]')) return;
    const p = toWorld(ev.clientX, ev.clientY);
    addClass('class', { x: snap(p.x - 80), y: snap(p.y - 30) });
  };

  return { onPointerDown, onPointerMove, onPointerUp, onDoubleClick };
}
