/** Small browser helpers: storage that never throws, motion preferences, text measuring, focus checks. */

/** localStorage that tolerates private windows, full storage and blocked site data. */
export const storage = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  getJson<T>(key: string): T | null { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as T : null; } catch { return null; } },
  /** Returns false when the browser refused (quota, blocked); `onFull` is told about a full store. */
  set(key: string, value: string, onFull?: () => void): boolean {
    try { localStorage.setItem(key, value); return true; }
    catch (e) { if ((e as Error)?.name === 'QuotaExceededError') onFull?.(); return false; }
  },
  remove(key: string) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animate 0→1 over `ms` with an ease-out curve (instant when the user prefers less motion). */
export function animate(ms: number, step: (t: number) => void, done?: () => void) {
  if (reduceMotion() || ms <= 0) { step(1); done?.(); return; }
  const t0 = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - t0) / ms);
    step(1 - Math.pow(1 - t, 3));
    if (t < 1) requestAnimationFrame(tick); else done?.();
  };
  requestAnimationFrame(tick);
}

/** Width of `text` in a CSS font, without touching the DOM (cached canvas context). */
let ctx: CanvasRenderingContext2D | null = null;
export function textWidth(text: string, font: string): number {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * 7;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Is the user typing somewhere (a field or the code editor)? Shortcuts leave those alone. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || !!el.closest?.('.cm-editor');
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
/** ⌘ on a Mac, Ctrl elsewhere — the label for shortcuts. */
export const modLabel = isMac ? '⌘' : 'Ctrl+';
export const hasMod = (ev: KeyboardEvent | MouseEvent) => ev.metaKey || ev.ctrlKey;

/** Save text (or a blob) as a file through the browser's download. */
export function download(filename: string, text: string | Blob, type = 'application/json') {
  const url = URL.createObjectURL(typeof text === 'string' ? new Blob([text], { type }) : text);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** A title as a file name (keeps letters, digits, spaces, - and _). */
export const fileName = (title: string, ext: string) => (title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'cistem') + ext;
