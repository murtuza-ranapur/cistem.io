/**
 * The drawing surface every canvas is built on: an <svg> with the dot grid, wheel and trackpad pan/zoom,
 * two-finger pinch, the right-click menu, and a world group transformed by the view.
 * Canvases put their drawing inside and handle their own pointer gestures.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { useEditor, setView, ZOOM } from '../store/editor';
import { setSurface, setHover, zoomAt, panBy } from '../store/viewport';
import { openContextMenu } from './ContextMenu';

interface Props {
  id: string;
  label?: string;
  /** id of the world group (the drawing, transformed by the view). */
  worldId?: string;
  /** <defs> (markers) for this canvas. */
  defs?: ReactNode;
  children: ReactNode;
  className?: string;
  onPointerDown?: (ev: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove?: (ev: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp?: (ev: React.PointerEvent<SVGSVGElement>) => void;
  onDoubleClick?: (ev: React.MouseEvent<SVGSVGElement>) => void;
  /** Gesture state lives in the canvas; the surface just needs to know when a pinch takes over. */
  onPinchStart?: () => void;
}

export const Surface = forwardRef<SVGSVGElement, Props>(function Surface(p, ref) {
  const svg = useRef<SVGSVGElement>(null);
  useImperativeHandle(ref, () => svg.current!);
  useEffect(() => { setSurface(svg.current); return () => setSurface(null); }, []);

  // wheel / trackpad pans; pinch (ctrlKey) and ⌘-wheel zoom. Non-passive, so it's added by hand.
  useEffect(() => {
    const el = svg.current!;
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      if (ev.ctrlKey || ev.metaKey) zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.01));
      else panBy(-ev.deltaX, -ev.deltaY);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  // two fingers: pinch to zoom around their midpoint
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number; cx: number; cy: number; vx: number; vy: number } | null>(null);
  const down = (ev: React.PointerEvent<SVGSVGElement>) => {
    if (ev.button === 2) return;
    touches.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()], v = useEditor.getState().view;
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: v.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: v.x, vy: v.y };
      p.onPinchStart?.();
      return;
    }
    p.onPointerDown?.(ev);
  };
  const move = (ev: React.PointerEvent<SVGSVGElement>) => {
    if (ev.pointerType === 'mouse') setHover({ x: ev.clientX, y: ev.clientY });
    if (touches.current.has(ev.pointerId)) touches.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const pc = pinch.current;
    if (pc && touches.current.size === 2) {
      const [a, b] = [...touches.current.values()], r = svg.current!.getBoundingClientRect();
      const k = Math.min(ZOOM.max, Math.max(ZOOM.min, pc.k * Math.hypot(a.x - b.x, a.y - b.y) / pc.d));
      const cx = pc.cx - r.left, cy = pc.cy - r.top;
      setView({ k, x: cx - (cx - pc.vx) * (k / pc.k), y: cy - (cy - pc.vy) * (k / pc.k) });
      return;
    }
    p.onPointerMove?.(ev);
  };
  const up = (ev: React.PointerEvent<SVGSVGElement>) => {
    touches.current.delete(ev.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    p.onPointerUp?.(ev);
  };

  return (
    <svg id={p.id} ref={svg} className={p.className} xmlns="http://www.w3.org/2000/svg" tabIndex={-1} aria-label={p.label}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onPointerLeave={() => setHover(null)} onDoubleClick={p.onDoubleClick} onContextMenu={openContextMenu}>
      <defs>
        <Grid id={`grid-${p.id}`} />
        {p.defs}
      </defs>
      <rect x="-100000" y="-100000" width="200000" height="200000" fill={`url(#grid-${p.id})`} />
      <World id={p.worldId}>{p.children}</World>
    </svg>
  );
});

/**
 * The dot grid lives in screen space; it moves and scales with the view so the paper moves with the diagram.
 * Dots keep their size; zoomed far out every other dot is dropped so it never turns into noise.
 */
function Grid({ id }: { id: string }) {
  const { x, y, k } = useEditor(s => s.view);
  let step = 24 * k;
  while (step < 12) step *= 2;
  return (
    <pattern id={id} width={step} height={step} x={x} y={y} patternUnits="userSpaceOnUse">
      <circle cx={step / 2} cy={step / 2} r="0.9" fill="var(--grid)" />
    </pattern>
  );
}
function World({ id, children }: { id?: string; children: ReactNode }) {
  const { x, y, k } = useEditor(s => s.view);
  return <g id={id} transform={`translate(${x} ${y}) scale(${k})`}>{children}</g>;
}
