/**
 * Pan and zoom, shared by every canvas. The open canvas registers its <svg>; positions convert between
 * the screen and the diagram's own coordinates ("world") through the store's view.
 */
import { animate } from '../lib/browser';
import { editor, setView, ZOOM, type View } from './editor';

export interface Box { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }

let surface: SVGSVGElement | null = null;
/** The canvas currently on screen (each canvas calls this when it mounts). */
export const setSurface = (el: SVGSVGElement | null) => {
  surface = el;
  if (el) waiting.splice(0).forEach(fn => fn());
};
const waiting: (() => void)[] = [];
/** Run `fn` once a canvas is on screen and laid out (now, if one already is). */
export function whenDrawn(fn: () => void) {
  const run = () => requestAnimationFrame(() => requestAnimationFrame(fn));
  if (surface) run(); else waiting.push(run);
}
export const getSurface = () => surface;
const rect = () => surface?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);

export function toWorld(clientX: number, clientY: number): Point {
  const r = rect(), v = editor().view;
  return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
}
export function toScreen(x: number, y: number): Point {
  const r = rect(), v = editor().view;
  return { x: r.left + x * v.k + v.x, y: r.top + y * v.k + v.y };
}
/** The world point at the middle of the canvas (where new things go). */
export function centre(): Point { const r = rect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); }

const clampK = (k: number) => Math.min(ZOOM.max, Math.max(ZOOM.min, k));

/** Zoom by `factor` keeping the canvas point (cx, cy) still. */
export function zoomAt(cx: number, cy: number, factor: number) {
  const v = editor().view, k = clampK(v.k * factor);
  setView({ k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) });
}
/** A wheel or trackpad event: pinch / ⌘-wheel zooms at the pointer, anything else pans. */
export function wheelPanZoom(ev: WheelEvent) {
  const r = rect();
  if (ev.ctrlKey || ev.metaKey) zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.01));
  else panBy(-ev.deltaX, -ev.deltaY);
}
export function zoomBy(factor: number) { const r = rect(); zoomAt(r.width / 2, r.height / 2, factor); }
export function panBy(dx: number, dy: number) { const v = editor().view; setView({ ...v, x: v.x + dx, y: v.y + dy }); }

function moveViewTo(target: View, ms: number) {
  const from = editor().view;
  animate(ms, t => setView({ k: from.k + (target.k - from.k) * t, x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t }));
}

/** Frame `box` in the canvas, with padding. */
export function fitTo(box: Box | null, opts: { animated?: boolean; maxK?: number; pad?: number } = {}) {
  if (!box || !surface) return;
  const r = rect(), pad = opts.pad ?? 48;
  const k = Math.min(opts.maxK ?? 1.5, Math.max(ZOOM.min, Math.min((r.width - pad * 2) / Math.max(1, box.w), (r.height - pad * 2) / Math.max(1, box.h))));
  const target = { k, x: (r.width - box.w * k) / 2 - box.x * k, y: (r.height - box.h * k) / 2 - box.y * k };
  if (opts.animated === false) setView(target); else moveViewTo(target, 240);
}

/** Pan just enough that `box` is fully visible (e.g. under the details panel once it slides in). */
export function reveal(box: Box | null, pad = 24) {
  if (!box || !surface) return;
  const r = rect(), v = editor().view;
  const sx0 = box.x * v.k + v.x, sy0 = box.y * v.k + v.y, sx1 = sx0 + box.w * v.k, sy1 = sy0 + box.h * v.k;
  let dx = 0, dy = 0;
  if (sx1 > r.width - pad) dx = r.width - pad - sx1; else if (sx0 < pad) dx = pad - sx0;
  if (sy1 > r.height - pad) dy = r.height - pad - sy1; else if (sy0 < pad) dy = pad - sy0;
  if (dx || dy) moveViewTo({ ...v, x: v.x + dx, y: v.y + dy }, 200);
}

/** Union of boxes (null when there are none). */
export function bounds(boxes: Iterable<Box>): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Where the mouse is over the canvas, if it is (for paste-at-pointer). */
let hover: Point | null = null;
export const setHover = (p: Point | null) => { hover = p; };
export const pointerWorld = (): Point | null => (hover ? toWorld(hover.x, hover.y) : null);
