/**
 * Star trails behind the moon, as a long exposure sees them: each star draws an arc around the moon with a tail
 * that fades behind it, then fades out and starts again somewhere else, each with its own start time, length,
 * speed and brightness. One canvas; returns a function that stops it.
 */
import { reduceMotion } from '../lib/browser';

interface Star { r: number; a0: number; w: number; T: number; F: number; lw: number; al: number; c: string; t0: number }
const COLOURS = ['255,255,255', '255,255,255', '255,255,255', '200,218,255', '188,211,255', '255,231,163'];
const TAU = Math.PI * 2;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export function startTrails(cv: HTMLCanvasElement, moon: HTMLElement): () => void {
  const g = cv.getContext('2d');
  if (!g) return () => {};
  let W = 0, H = 0, cx = 0, cy = 0, inner = 0, outer = 0, thin = 1, stars: Star[] = [], raf = 0, stopped = false;
  const still = reduceMotion();

  const make = (now: number, first: boolean): Star => {
    const r = rnd(inner, outer), T = rnd(5, 17);
    return {
      r, a0: rnd(0, TAU), w: rnd(.035, .1), T, F: rnd(1.5, 3.5), lw: rnd(.7, 2.3) * thin,
      al: rnd(.45, 1) * Math.max(.14, Math.min(1, 1 - (r - inner * 2) / (outer - inner * 1.4))),
      c: COLOURS[Math.floor(Math.random() * COLOURS.length)],
      t0: now + (first ? -rnd(0, T) * 1000 : rnd(0, 5) * 1000),
    };
  };
  const measure = () => {
    const box = cv.getBoundingClientRect(), m = moon.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = box.width; H = box.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.lineCap = 'round';
    cx = m.left - box.left + m.width / 2; cy = m.top - box.top + m.height / 2;
    inner = m.width / 2 * 1.15; thin = Math.max(.6, Math.min(1, m.width / 340)); outer = Math.max(inner * 2.5, Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) * .78);
    const n = Math.round(Math.max(70, Math.min(200, W * H / 9500)));
    const now = performance.now();
    stars = Array.from({ length: n }, () => make(now, true));
    if (still) draw(now);
  };
  const conic = typeof g.createConicGradient === 'function';
  const draw = (now: number) => {
    g.clearRect(0, 0, W, H);
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i], t = (now - s.t0) / 1000;
      if (t < 0) continue;
      if (t > s.T + s.F) { stars[i] = make(now, false); continue; }
      const len = s.w * Math.min(t, s.T), a1 = s.a0 + len;
      const al = s.al * (t < s.T ? Math.min(1, t / .5) : 1 - (t - s.T) / s.F);
      if (len > .002) {
        if (conic) {
          const cg = g.createConicGradient(s.a0, cx, cy), f = Math.min(.999, len / TAU);
          cg.addColorStop(0, `rgba(${s.c},0)`); cg.addColorStop(f * .55, `rgba(${s.c},${al * .45})`);
          cg.addColorStop(f, `rgba(${s.c},${al})`); cg.addColorStop(Math.min(1, f + .0005), `rgba(${s.c},0)`);
          g.strokeStyle = cg;
        } else g.strokeStyle = `rgba(${s.c},${al * .6})`;
        g.lineWidth = s.lw; g.beginPath(); g.arc(cx, cy, s.r, s.a0, a1); g.stroke();
      }
      const hx = cx + Math.cos(a1) * s.r, hy = cy + Math.sin(a1) * s.r;
      g.fillStyle = `rgba(${s.c},${al * .22})`; g.beginPath(); g.arc(hx, hy, s.lw * 2.6, 0, TAU); g.fill();
      g.fillStyle = `rgba(${s.c},${al})`; g.beginPath(); g.arc(hx, hy, s.lw * .95, 0, TAU); g.fill();
    }
  };
  const frame = (now: number) => {
    if (stopped) return;
    if (!document.hidden) draw(now);
    raf = requestAnimationFrame(frame);
  };
  const ro = new ResizeObserver(measure);
  ro.observe(cv);
  measure();
  if (!still) raf = requestAnimationFrame(frame);
  return () => { stopped = true; cancelAnimationFrame(raf); ro.disconnect(); };
}
