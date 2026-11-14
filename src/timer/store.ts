/**
 * A countdown timer of your own: not part of any diagram, it carries on across diagrams and a reload
 * (remembered in this browser) and never shows in an exported image or a shared link.
 */
import { create } from 'zustand';

export type TimerState = 'off' | 'running' | 'paused';
export interface Timer {
  state: TimerState;
  /** the length it was started with, in ms */
  total: number;
  /** running: when it reaches zero (epoch ms) */
  endAt: number;
  /** paused: what was left (negative once over time) */
  left: number;
  /** where the pill sits, from the canvas's bottom-left; null = the default spot */
  pos: { x: number; y: number } | null;
}

const KEY = 'cistem.timer';
const OFF: Timer = { state: 'off', total: 0, endAt: 0, left: 0, pos: null };
const read = (): Timer => {
  try { const t = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return t && typeof t.total === 'number' ? { ...OFF, ...t } : OFF; }
  catch { return OFF; }
};

export const useTimer = create<Timer>(() => read());
useTimer.subscribe(t => { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* this session only */ } });

/** Time left in ms (negative once over), at `now`. */
export const leftAt = (t: Timer, now = Date.now()) => t.state === 'running' ? t.endAt - now : t.left;

export function startTimer(ms: number) {
  if (!(ms > 0)) return;
  useTimer.setState({ state: 'running', total: ms, endAt: Date.now() + ms, left: ms });
}
export function pauseTimer() {
  const t = useTimer.getState();
  if (t.state === 'running') useTimer.setState({ state: 'paused', left: t.endAt - Date.now() });
}
export function resumeTimer() {
  const t = useTimer.getState();
  if (t.state === 'paused') useTimer.setState({ state: 'running', endAt: Date.now() + t.left });
}
/** Back to its full length, paused, ready to go again. */
export function stopTimer() {
  const t = useTimer.getState();
  if (t.state !== 'off') useTimer.setState({ state: 'paused', left: t.total });
}
export const dismissTimer = () => useTimer.setState({ state: 'off' });
export const moveTimer = (pos: { x: number; y: number } | null) => useTimer.setState({ pos });

/** 1:05:09, 45:00, −01:20 */
export function fmtTimer(ms: number): string {
  // counting down, a part-second still showing rounds up (45:00 at the start); over time, whole seconds over
  const over = ms <= -1000, s = over ? Math.floor(-ms / 1000) : Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return (over ? '−' : '') + (h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`);
}
