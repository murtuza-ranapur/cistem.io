/**
 * Keyboard shortcuts. The app's own come first (tabs, undo, zoom, panel, edit commands); the open
 * diagram's keydown gets the rest. Typing in a field or the code editor is left alone.
 */
import { hasMod, isTyping } from '../lib/browser';
import { select, undo, redo } from '../store/editor';
import { useUi, togglePanel } from '../store/ui';
import { activate, tabs } from '../store/tabs';
import { useCloud, saveNow, saveAsNew } from '../store/cloud';
import { active, duplicateSelection, fitView, removeSelection, selectAll } from '../store/commands';
import { zoomBy, pointerWorld } from '../store/viewport';
import { addNote, noteKeydown } from '../notes/actions';
import { requestCloseTab } from './TabBar';

/** While a pointer is held (a drag in progress), keys that change what's being dragged wait. */
let pointersHeld = 0;

/** ⌥1–9 switch tabs, ⌥T new, ⌥W close. Uses physical keys: on a Mac ⌥ changes the character. */
function tabKey(ev: KeyboardEvent): boolean {
  if (!ev.altKey || ev.metaKey || ev.ctrlKey) return false;
  const list = tabs().list, digit = /^Digit([1-9])$/.exec(ev.code);
  if (digit) { const t = +digit[1] === 9 ? list[list.length - 1] : list[+digit[1] - 1]; if (t) void activate(t.key); return true; }
  if (ev.code === 'KeyT') { useUi.setState({ newMenuOpen: true }); return true; }
  if (ev.code === 'KeyW') { requestCloseTab(tabs().active); return true; }
  return false;
}

function onKey(ev: KeyboardEvent) {
  if (ev.defaultPrevented) return;
  const mod = hasMod(ev), key = ev.key.toLowerCase();
  if (mod && key === 's') { ev.preventDefault(); void (useCloud.getState().id ? saveNow() : saveAsNew()); return; }
  if (tabKey(ev)) { ev.preventDefault(); return; }
  const target = ev.target as HTMLElement;
  if (isTyping(target)) {
    // the code editor owns its keys; Escape (when no suggestion list is open) just leaves it; in a field, Escape leaves the field
    const inCode = target.isContentEditable || !!target.closest?.('.cm-editor');
    if (ev.key === 'Escape' && !(inCode && document.querySelector('.cm-tooltip-autocomplete'))) target.blur();
    return;
  }
  if (pointersHeld && (ev.key === 'Delete' || ev.key === 'Backspace' || (mod && /^[zyd]$/.test(key)))) { ev.preventDefault(); return; }

  const handled = (fn: () => void) => { ev.preventDefault(); fn(); };
  if (mod && key === 'z') return handled(ev.shiftKey ? redo : undo);
  if (mod && key === 'y') return handled(redo);
  if (mod && key === '0') return handled(() => fitView());
  if (mod && (ev.key === '=' || ev.key === '+')) return handled(() => zoomBy(1.2));
  if (mod && ev.key === '-') return handled(() => zoomBy(1 / 1.2));
  if (noteKeydown(ev)) return handled(() => {});
  // the diagram's own keys can override the common ones below (e.g. Escape closing its picker first)
  if (active().keydown?.(ev)) return handled(() => {});
  if (!mod && !ev.altKey && key === 'n') return handled(() => addNote(pointerWorld()));
  if (mod && key === 'd') return handled(duplicateSelection);
  if (mod && key === 'a') return handled(selectAll);
  if (!mod && !ev.altKey && key === 'i') return handled(togglePanel);
  if (ev.key === 'Escape') return handled(() => select(null));
  if (ev.key === 'Delete' || ev.key === 'Backspace') return handled(removeSelection);
}

export function listenForKeys() {
  document.addEventListener('pointerdown', () => { pointersHeld++; }, true);
  const release = () => { pointersHeld = Math.max(0, pointersHeld - 1); };
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  window.addEventListener('blur', () => { pointersHeld = 0; });
  document.addEventListener('keydown', onKey);
}
