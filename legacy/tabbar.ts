/** The tab strip and the + (new diagram) menu. */
import { tabs, activate, closeTab, moveTab, newTab, onTabsChange, type Tab } from './tabs';
import { esc } from './state';
import { signedIn } from './cloud';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const list = $('tabList'), plus = $<HTMLButtonElement>('newTabBtn'), menu = $('newMenu');

const KIND_LABEL: Record<string, string> = { system: 'system', sequence: 'sequence', class: 'class' };

function render() {
  list.innerHTML = tabs.list.map(t => `
    <div class="dtab k-${esc(t.kind)}-tab ${t.key === tabs.active ? 'on' : ''}" role="tab" aria-selected="${t.key === tabs.active}" data-key="${esc(t.key)}" title="${esc(t.title)}">
      <span class="tk k-${esc(t.kind)}"><svg><use href="#ic-k-${esc(t.kind)}"/></svg></span>
      <span class="tt">${esc(t.title || 'Untitled')}</span>
      <span class="tkind">${KIND_LABEL[t.kind] ?? esc(t.kind)}</span>
      ${t.share ? '<span class="tro">view only</span>' : ''}
      <button class="tx" data-close="${esc(t.key)}" aria-label="Close ${esc(t.title)}" title="Close (⌥W)"><svg><use href="#ic-close"/></svg></button>
    </div>`).join('');
  list.querySelector('.dtab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
onTabsChange(render);

/** Signed out, a tab's document exists only in this browser, so closing it deletes it: ask once. */
function needsConfirm(t: Tab) { return !t.cloudId && !t.share && !signedIn(); }
function requestClose(key: string, btn?: HTMLElement | null) {
  const t = tabs.list.find(x => x.key === key); if (!t) return;
  if (btn && needsConfirm(t) && !btn.dataset.armed) {
    btn.dataset.armed = '1'; btn.classList.add('armed'); btn.textContent = 'discard?'; btn.title = 'Only kept in this browser. Click again to discard.';
    setTimeout(() => { if (btn.isConnected) render(); }, 2600);
    return;
  }
  closeTab(key);
}

// click to switch, × to close, middle-click to close, drag to reorder
let drag: { key: string; el: HTMLElement; x0: number; moved: boolean; pid: number } | null = null;
list.addEventListener('pointerdown', ev => {
  const x = (ev.target as Element).closest('[data-close]') as HTMLElement | null;
  if (x) return;
  const tab = (ev.target as Element).closest('.dtab') as HTMLElement | null; if (!tab) return;
  if (ev.button === 1) { ev.preventDefault(); requestClose(tab.dataset.key!, tab.querySelector<HTMLElement>('[data-close]')); return; }
  if (ev.button !== 0) return;
  drag = { key: tab.dataset.key!, el: tab, x0: ev.clientX, moved: false, pid: ev.pointerId };
});
window.addEventListener('pointermove', ev => {
  if (!drag || ev.pointerId !== drag.pid) return;
  const dx = ev.clientX - drag.x0;
  if (!drag.moved && Math.abs(dx) < 5) return;
  if (!drag.moved) { drag.moved = true; drag.el.classList.add('dragging'); drag.el.setPointerCapture?.(ev.pointerId); }
  drag.el.style.transform = `translateX(${dx}px)`;
});
window.addEventListener('pointerup', ev => {
  if (!drag || ev.pointerId !== drag.pid) return;
  const d = drag; drag = null;
  if (!d.moved) { activate(d.key); return; }
  // drop where the dragged tab's centre landed among the others
  const r = d.el.getBoundingClientRect(), cx = r.left + r.width / 2;
  const others = [...list.querySelectorAll<HTMLElement>('.dtab')].filter(el => el !== d.el);
  let to = others.findIndex(el => { const o = el.getBoundingClientRect(); return cx < o.left + o.width / 2; });
  if (to < 0) to = others.length;
  d.el.style.transform = '';
  moveTab(d.key, to);
});
list.addEventListener('click', ev => {
  const x = (ev.target as Element).closest('[data-close]') as HTMLElement | null;
  if (x) { ev.stopPropagation(); requestClose(x.dataset.close!, x); }
});
list.addEventListener('auxclick', ev => { if (ev.button === 1) ev.preventDefault(); });

// ---------- + menu ----------
let onOpenExisting = () => {}, onImport = () => {}, onExample = () => {}, onFromPath = () => {};
type FromExtra = { label: string; run: () => void };
let fromInfo: () => { title: string; start: string | null; extra: FromExtra[] } | null = () => null;
let extras: FromExtra[] = [];
export function menuActions(a: { openExisting: () => void; importJson: () => void; example: () => void; fromPath: () => void; fromInfo: typeof fromInfo }) {
  onOpenExisting = a.openExisting; onImport = a.importJson; onExample = a.example; onFromPath = a.fromPath; fromInfo = a.fromInfo;
}
export function openMenu() {
  const info = fromInfo();
  ($('nmFrom') as HTMLElement).hidden = !info;
  if (info) {
    $('nmFromHead').textContent = `Made from “${info.title}”`;
    const path = menu.querySelector<HTMLElement>('[data-nm="seq-path"]')!;
    path.hidden = !info.start; if (info.start) $('nmPathSub').textContent = `starting at ${info.start}`;
    extras = info.extra;
    $('nmFromExtra').innerHTML = extras.map((x, i) => `<button class="nm-line" role="menuitem" data-nmx="${i}"><span class="k-class-ink"><svg><use href="#ic-k-class"/></svg></span><span>${esc(x.label)}</span><span></span></button>`).join('');
  }
  const r = plus.getBoundingClientRect();
  menu.style.left = Math.max(12, Math.min(r.left, window.innerWidth - 412)) + 'px';
  menu.style.top = r.bottom + 6 + 'px';
  menu.hidden = false; plus.setAttribute('aria-expanded', 'true');
  menu.querySelector<HTMLElement>('.nm-item:not(:disabled)')?.focus();
}
export function closeMenu() { menu.hidden = true; plus.setAttribute('aria-expanded', 'false'); }
plus.onclick = () => (menu.hidden ? openMenu() : closeMenu());
menu.addEventListener('click', ev => {
  const it = (ev.target as Element).closest('[data-new]') as HTMLButtonElement | null;
  if (it && !it.disabled) { closeMenu(); newTab(it.dataset.new as 'system'); return; }
  const x = (ev.target as Element).closest('[data-nmx]') as HTMLElement | null;
  if (x) { closeMenu(); extras[+x.dataset.nmx!]?.run(); return; }
  const a = (ev.target as Element).closest('[data-nm]') as HTMLElement | null;
  if (!a) return;
  closeMenu();
  ({ open: onOpenExisting, import: onImport, example: onExample, 'seq-path': onFromPath } as Record<string, () => void>)[a.dataset.nm!]?.();
});
menu.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') { ev.stopPropagation(); closeMenu(); plus.focus(); return; }
  if (/^[1-3]$/.test(ev.key)) { ev.preventDefault(); (menu.querySelectorAll<HTMLButtonElement>('[data-new]')[+ev.key - 1])?.click(); return; }
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    const items = [...menu.querySelectorAll<HTMLElement>('.nm-item:not(:disabled), .nm-line, .chip')].filter(x => x.offsetParent);
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
});
document.addEventListener('pointerdown', ev => { if (!menu.hidden && !(ev.target as Element).closest('#newMenu,#newTabBtn')) closeMenu(); });

/** ⌥1–9 switch tabs, ⌥T new, ⌥W close. Uses physical keys: on a Mac ⌥ changes the character. */
export function tabKeys(ev: KeyboardEvent): boolean {
  if (!ev.altKey || ev.metaKey || ev.ctrlKey) return false;
  const m = /^Digit([1-9])$/.exec(ev.code);
  if (m) { const t = +m[1] === 9 ? tabs.list[tabs.list.length - 1] : tabs.list[+m[1] - 1]; if (t) activate(t.key); return true; }
  if (ev.code === 'KeyT') { openMenu(); return true; }
  if (ev.code === 'KeyW') { const el = list.querySelector<HTMLElement>('.dtab.on [data-close]'); requestClose(tabs.active, el); return true; }
  return false;
}
render();
