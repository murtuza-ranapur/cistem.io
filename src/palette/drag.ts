/**
 * Dragging a palette tile onto the canvas. Pick it up (drag a little with a mouse; press and hold a moment on a
 * pen or touch screen) and a see-through copy of the card follows the pointer. Over the canvas it firms up and
 * shows exactly where it will land, snapped to the grid and lined up with cards nearby, and what it lands in.
 * Let go to put it there; let go over the palette, or press Esc, to cancel.
 */
import { createElement as h, useEffect, type ReactNode } from 'react';
import { create } from 'zustand';
import { toWorld } from '../store/viewport';
import { useEditor } from '../store/editor';
import { countUse } from './store';
import type { DropPreview, PaletteItem } from './types';

interface DragState { item: PaletteItem | null; x: number; y: number; over: boolean; preview: DropPreview | null; at: { x: number; y: number } | null }
export const useDrag = create<DragState>(() => ({ item: null, x: 0, y: 0, over: false, preview: null, at: null }));

const GRID = 8, HOLD_MS = 220;
let justDropped = false;
/** A drag that ended on a tile mustn't also count as a click on it. */
export function consumeDragClick() { const j = justDropped; justDropped = false; return j; }

const stage = () => document.querySelector<HTMLElement>('#stage');
/** Over the canvas, and not over the palette (or a panel, a menu) floating on it. */
function overCanvas(x: number, y: number) {
  const el = document.elementFromPoint(x, y);
  return !!el && !!stage()?.contains(el) && !el.closest('#palette, #quickAdd, #timer, .ctx, .zoom, #zoomCtl');
}

function track(x: number, y: number) {
  const { item } = useDrag.getState(); if (!item?.place) return;
  const over = overCanvas(x, y);
  if (!over) { useDrag.setState({ x, y, over, preview: null, at: null }); return; }
  const c = toWorld(x, y), p = item.place;
  const snapped = { x: Math.round((c.x - p.w / 2) / GRID) * GRID, y: Math.round((c.y - p.h / 2) / GRID) * GRID };
  const preview = p.preview?.(snapped) ?? null;
  useDrag.setState({ x, y, over, preview, at: preview?.at ?? snapped });
}

function end(drop: boolean) {
  const { item, at, over } = useDrag.getState();
  useDrag.setState({ item: null, preview: null, at: null, over: false });
  document.body.classList.remove('pal-dragging');
  if (!drop || !item?.place || !over || !at) return;
  if (item.place.drop) item.place.drop(at); else item.add({ x: at.x + item.place.w / 2, y: at.y + item.place.h / 2 });
  countUse(item.key);
}

/** pointerdown on a tile: wait to see whether it's a click or a drag. */
export function pressTile(e: React.PointerEvent, item: PaletteItem) {
  if (e.button !== 0 || !item.place) return;
  const sx = e.clientX, sy = e.clientY, mouse = e.pointerType === 'mouse';
  let started = false, held = mouse;
  const timer = mouse ? 0 : window.setTimeout(() => { held = true; if (navigator.vibrate) navigator.vibrate(8); }, HOLD_MS);
  const begin = (x: number, y: number) => {
    started = true;
    document.body.classList.add('pal-dragging');
    useDrag.setState({ item, x, y });
    track(x, y);
  };
  const move = (ev: PointerEvent) => {
    if (started) { ev.preventDefault(); track(ev.clientX, ev.clientY); return; }
    const far = Math.hypot(ev.clientX - sx, ev.clientY - sy);
    // touch that moves before the hold scrolls the palette instead
    if (!held) { if (far > 8) cleanup(); return; }
    if (far > 4) begin(ev.clientX, ev.clientY);
  };
  const up = (ev: PointerEvent) => {
    if (started) { justDropped = true; track(ev.clientX, ev.clientY); end(true); setTimeout(() => (justDropped = false), 0); }
    cleanup();
  };
  const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && started) { ev.stopPropagation(); justDropped = true; end(false); cleanup(); } };
  const cleanup = () => {
    clearTimeout(timer);
    window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true); window.removeEventListener('keydown', key, true);
  };
  window.addEventListener('pointermove', move, { capture: true, passive: false });
  window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
  window.addEventListener('keydown', key, true);
}

/** The dragged copy and what dropping it would do, drawn over the canvas. */
export function DragLayer(): ReactNode {
  const d = useDrag();
  const view = useEditor(s => s.view);
  useEffect(() => () => { document.body.classList.remove('pal-dragging'); }, []);
  if (!d.item?.place) return null;
  const st = stage()?.getBoundingClientRect(); if (!st) return null;
  const k = view.k, sx = (wx: number) => wx * k + view.x, sy = (wy: number) => wy * k + view.y;
  const p = d.item.place, pv = d.preview, kids: ReactNode[] = [];
  if (d.over && pv?.highlight) {
    const b = pv.highlight.box;
    kids.push(h('div', { key: 'hl', className: 'drop-hl', style: { left: sx(b.x), top: sy(b.y), width: b.w * k, height: b.h * k } }, h('span', null, '↓ ' + pv.highlight.label)));
  }
  if (d.over) for (const [i, g] of (pv?.guides ?? []).entries()) {
    kids.push(h('div', { key: 'g' + i, className: 'drop-guide ' + (g.x !== undefined ? 'v' : 'h'), style: g.x !== undefined ? { left: sx(g.x) } : { top: sy(g.y!) } }));
  }
  if (d.over && pv?.slot) kids.push(h('div', { key: 'slot', className: 'drop-slot', style: { left: sx(pv.slot.x) - 1, top: sy(pv.slot.y1), height: (pv.slot.y2 - pv.slot.y1) * k } }));
  const fit = d.over && d.at && !pv?.noGhost;
  const w = p.w * (d.over ? k : Math.min(1, k)), hh = p.h * (d.over ? k : Math.min(1, k));
  const pos = fit ? { left: sx(d.at!.x), top: sy(d.at!.y) } : { left: d.x - st.left - w / 2, top: d.y - st.top - hh / 2 };
  if (!pv?.noGhost || !d.over) {
    kids.push(h('div', { key: 'ghost', id: 'dragGhost', className: 'drag-ghost' + (fit ? ' fit' : ' lift') + (d.item.sticky ? ' sticky' : ''), style: { ...pos, width: w, height: hh } },
      h('span', { className: 'dg-ic' }, d.item.icon), h('span', { className: 'dg-l' }, d.item.label)));
  }
  return h('div', { className: 'drag-layer', 'aria-hidden': true }, ...kids);
}
