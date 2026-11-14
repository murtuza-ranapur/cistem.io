/** The header's timer button (set hours and minutes, start) and the floating pill while it's on. */
import { useEffect, useRef, useState } from 'react';
import { IconButton, Icon } from '../ui/Icon';
import { useDismiss } from '../ui/hooks';
import { dismissTimer, fmtTimer, leftAt, moveTimer, pauseTimer, resumeTimer, startTimer, stopTimer, useTimer } from './store';

export function TimerButton() {
  const on = useTimer(s => s.state !== 'off');
  const total = useTimer(s => s.total);
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(() => String(Math.floor((total || 45 * 60e3) / 3600e3)));
  const [m, setM] = useState(() => String(Math.round(((total || 45 * 60e3) % 3600e3) / 60e3)));
  const box = useRef<HTMLFormElement>(null), btn = useRef<HTMLDivElement>(null);
  useDismiss(box, open, () => setOpen(false), btn);
  const ms = (Math.max(0, Number(h) || 0) * 60 + Math.max(0, Number(m) || 0)) * 60e3;
  return (
    <div className="timer-wrap" ref={btn}>
      <IconButton id="timerBtn" icon="ic-timer" label="Timer" title="Timer" className={on || open ? 'on' : ''} onClick={() => setOpen(v => !v)} />
      {open && (
        <form id="timerMenu" className="menu timer-menu" ref={box} onSubmit={e => { e.preventDefault(); if (ms > 0) { startTimer(ms); setOpen(false); } }}>
          <div className="menu-head">Timer</div>
          <div className="timer-fields">
            <label><input id="timerH" type="number" min={0} max={23} inputMode="numeric" value={h} onChange={e => setH(e.target.value)} onFocus={e => e.target.select()} />h</label>
            <label><input id="timerM" type="number" min={0} max={59} inputMode="numeric" value={m} autoFocus onChange={e => setM(e.target.value)} onFocus={e => e.target.select()} />min</label>
          </div>
          <button type="submit" id="timerStart" className="primary" disabled={ms <= 0}>Start{ms > 0 ? ' ' + fmtTimer(ms) : ''}</button>
        </form>
      )}
    </div>
  );
}

export function TimerPill() {
  const t = useTimer();
  const [, tick] = useState(0);
  useEffect(() => {
    if (t.state !== 'running') return;
    const id = setInterval(() => tick(n => n + 1), 250);
    return () => clearInterval(id);
  }, [t.state]);
  // the time in the tab's title, so you see it from another tab
  const left = leftAt(t), text = fmtTimer(left);
  useEffect(() => {
    if (t.state === 'off') return;
    const base = document.title.replace(/^[−\d:]+ · /, '');
    document.title = `${text} · ${base}`;
    return () => { document.title = document.title.replace(/^[−\d:]+ · /, ''); };
  });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  if (t.state === 'off') return null;
  const over = left < 0, warn = !over && left <= 5 * 60e3;
  const pos = t.pos ?? { x: 16, y: 16 };
  const down = (e: React.PointerEvent) => {
    e.stopPropagation();   // not a press on the canvas
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    moveTimer({ x: Math.max(0, d.px + e.clientX - d.x), y: Math.max(0, d.py - (e.clientY - d.y)) });
  };
  return (
    <div id="timer" role="timer" aria-live="off" className={'timer ' + t.state + (over ? ' over' : warn ? ' warn' : '')}
      style={{ left: pos.x, bottom: pos.y }} onPointerDown={down} onPointerMove={move} onPointerUp={() => (drag.current = null)}
      title="Drag to move">
      <Icon name="ic-timer" />
      <span className="t" id="timerTime">{text}</span>
      {t.state === 'paused' && <span className="lab">paused</span>}
      {over && t.state === 'running' && <span className="lab">over</span>}
      {t.state === 'running'
        ? <button type="button" id="timerPause" aria-label="Pause" title="Pause" onClick={pauseTimer}><svg viewBox="0 0 24 24"><rect x="6.5" y="5.5" width="4" height="13" rx="1" /><rect x="13.5" y="5.5" width="4" height="13" rx="1" /></svg></button>
        : <button type="button" id="timerResume" aria-label="Resume" title="Resume" onClick={resumeTimer}><svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" /></svg></button>}
      <button type="button" id="timerStop" aria-label="Stop" title="Stop: back to the start" onClick={stopTimer}><svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" /></svg></button>
      <span className="sep" />
      <button type="button" id="timerClose" className="x" aria-label="Dismiss timer" title="Dismiss" onClick={dismissTimer}><svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" /></svg></button>
    </div>
  );
}
