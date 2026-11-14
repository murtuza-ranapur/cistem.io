import assert from 'node:assert/strict';
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) };
const { fmtTimer, startTimer, pauseTimer, resumeTimer, stopTimer, dismissTimer, useTimer, leftAt } = await import('../src/timer/store');

assert.equal(fmtTimer(45 * 60e3), '45:00');
assert.equal(fmtTimer(45 * 60e3 - 1), '45:00', 'a part-second still showing rounds up');
assert.equal(fmtTimer(65 * 60e3 + 9e3), '1:05:09');
assert.equal(fmtTimer(0), '00:00');
assert.equal(fmtTimer(-80e3), '−01:20', 'over time');

startTimer(10 * 60e3);
assert.equal(useTimer.getState().state, 'running');
pauseTimer();
const left = useTimer.getState().left;
assert.ok(left <= 10 * 60e3 && left > 10 * 60e3 - 1000);
assert.equal(leftAt(useTimer.getState(), Date.now() + 60e3), left, 'paused: time stands still');
resumeTimer(); assert.equal(useTimer.getState().state, 'running');
stopTimer(); assert.deepEqual([useTimer.getState().state, useTimer.getState().left], ['paused', 10 * 60e3], 'stop: back to the start');
assert.ok(JSON.parse(mem.get('cistem.timer')!).total === 10 * 60e3, 'remembered in this browser');
dismissTimer(); assert.equal(useTimer.getState().state, 'off');
startTimer(0); assert.equal(useTimer.getState().state, 'off', 'nothing to count');
console.log('timer ok');
