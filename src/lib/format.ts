/** Number, time and text formatting shared by every view. */

/** Compact number: 950, 1.2k, 12k, 3.4M, 5.0G, 2.0T; beyond that, scientific. */
export function fmt(v: number): string {
  if (v === Infinity) return '∞';
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v), sign = v < 0 ? '−' : '';
  const unit = (d: number, s: string) => sign + (a / d).toFixed(a / d >= 10 ? 0 : 1) + s;
  if (a >= 1e15) return sign + a.toExponential(1);
  if (a >= 1e12) return unit(1e12, 'T');
  if (a >= 1e9) return unit(1e9, 'G');
  if (a >= 1e6) return unit(1e6, 'M');
  if (a >= 1000) return unit(1000, 'k');
  return sign + Math.round(a).toString();
}

/** 4.2ms, 31ms, 420ms, 2.5s, 3.1min, then hours; anything not finite shows as a dash. */
export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms >= 3.6e6) { const h = ms / 3.6e6; return (h >= 1e4 ? h.toExponential(1) : fmt(h)) + 'h'; }
  if (ms >= 60000) return (ms / 60000).toFixed(1) + 'min';
  if (ms >= 10000) return (ms / 1000).toFixed(0) + 's';
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
  if (ms >= 100) return Math.round(ms) + 'ms';
  if (ms >= 10) return ms.toFixed(0) + 'ms';
  return ms.toFixed(1) + 'ms';
}

/** Calls per request: whole-ish numbers stay exact, big ones go compact. */
export const fmtCalls = (c: number) => (c >= 1000 ? fmt(c) : String(Math.round(c * 100) / 100));

export const trunc = (s: string, max: number) => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s);

export const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
