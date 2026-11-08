/**
 * Fast tooltips. Native `title` tooltips wait ~1s and can't be styled; this shows ours after a short delay,
 * and instantly while you're moving from one control to the next (like a menu bar).
 * Elements keep using `title` in markup; on first hover it moves to `data-tip` so the browser's own
 * tooltip never fires (and becomes the aria-label when the control has no text of its own).
 */
const SHOW_DELAY = 180, WARM_MS = 600;
let tip: HTMLDivElement | null = null, timer = 0, current: Element | null = null, lastHidden = 0;

function adopt(el: Element) {
  const t = el.getAttribute('title');
  if (t === null) return;
  el.setAttribute('data-tip', t); el.removeAttribute('title');
  if (!el.hasAttribute('aria-label') && !(el.textContent || '').trim()) el.setAttribute('aria-label', t);
}
function show(el: Element) {
  const text = el.getAttribute('data-tip'); if (!text) return;
  tip ??= Object.assign(document.body.appendChild(document.createElement('div')), { className: 'tip', role: 'tooltip' }) as HTMLDivElement;
  tip.textContent = text;
  const r = el.getBoundingClientRect();
  tip.style.left = '0px'; tip.style.top = '0px'; tip.classList.add('on');
  const w = tip.offsetWidth, h = tip.offsetHeight, m = 6;
  let x = r.left + r.width / 2 - w / 2, y = r.bottom + m;
  if (y + h > innerHeight - 4) y = r.top - h - m;          // flip above near the bottom
  if (r.left < 72 && r.width < 72) { x = r.right + m; y = r.top + r.height / 2 - h / 2; } // rail: to the right
  tip.style.left = Math.max(4, Math.min(innerWidth - w - 4, x)) + 'px';
  tip.style.top = Math.max(4, y) + 'px';
}
function hide() { clearTimeout(timer); if (tip?.classList.contains('on')) { tip.classList.remove('on'); lastHidden = performance.now(); } current = null; }

export function initTooltips() {
  document.addEventListener('pointerover', ev => {
    if (ev.pointerType === 'touch') return;
    const el = (ev.target as Element).closest?.('[title],[data-tip]');
    if (el === current) return;
    hide();
    if (!el || el.closest('svg#svg')) return;
    adopt(el); current = el;
    const warm = performance.now() - lastHidden < WARM_MS;
    timer = window.setTimeout(() => { if (current === el) show(el); }, warm ? 0 : SHOW_DELAY);
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
}
