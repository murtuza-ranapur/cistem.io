/**
 * The floating palette (top left of the canvas): search, then the diagram's sections in two lanes, ending with
 * the canvas things (a sticky on every kind). Collapses to a pill: search plus the four you add most.
 * Quick add is the same search at the pointer: double-click empty canvas, or / with the palette shut.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../store/editor';
import { diagram } from '../diagrams';
import { addNote } from '../notes/actions';
import { setLeftInset, toWorld } from '../store/viewport';
import { closeQuickAdd, countUse, mostUsed, openQuickAdd, setPaletteOpen, usePalette } from './store';
import { matchedAlias, searchItems, type PaletteItem, type PaletteSection } from './types';
import { consumeDragClick, DragLayer, pressTile, useDrag } from './drag';

const STICKY: PaletteItem = {
  key: 'sticky', label: 'Sticky', about: 'A free note with rich text, anywhere on the canvas (N)', aliases: ['note', 'comment', 'text', 'post-it'],
  icon: <svg className="pal-sticky" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v11l-5 5H4z" /><path d="M15 20v-5h5" /><path d="M8 9h8M8 13h5" /></svg>,
  attrs: { id: 'addNote', 'data-add-note': '' }, sticky: true,
  place: { w: 200, h: 96, drop: at => { addNote(at); } },
  add: at => { addNote(at ? { x: at.x - 100, y: at.y - 48 } : null); },
};

/** The open diagram's sections, with the sticky added to its Canvas section (made if it has none). */
function useSections(): PaletteSection[] {
  const kind = useEditor(s => s.open.kind);
  const own = diagram(kind).usePalette();
  return useMemo(() => {
    const canvas = own.find(s => s.title === 'Canvas');
    return canvas ? own.map(s => (s === canvas ? { ...s, items: [...s.items, STICKY] } : s)) : [...own, { title: 'Canvas', items: [STICKY] }];
  }, [own]);
}

export const use = (it: PaletteItem, at?: { x: number; y: number }) => { it.add(at); countUse(it.key); };
const search = (): HTMLInputElement | null => document.querySelector('#palSearch');

/** `/`: search in the palette, or quick add at the pointer when it's shut. */
export function slash(pointer: { x: number; y: number } | null) {
  if (usePalette.getState().open && search()) { search()!.focus(); search()!.select(); return; }
  const st = document.querySelector('#stage')!.getBoundingClientRect();
  openQuickAdd(pointer?.x ?? st.left + st.width / 2, pointer?.y ?? st.top + st.height / 2);
}

function Tile({ it }: { it: PaletteItem }) {
  const dragging = useDrag(s => s.item?.key === it.key);
  return (
    <button type="button" className={'pal-tile' + (it.active ? ' active' : '') + (it.sticky ? ' sticky' : '') + (it.place ? ' placeable' : '') + (dragging ? ' lifted' : '')}
      title={it.about ? `${it.label}: ${it.about}` : it.label}
      {...it.attrs} onPointerDown={it.place ? e => pressTile(e, it) : undefined}
      onClick={() => { if (!consumeDragClick()) use(it); }}>
      {it.icon}<span>{it.label}</span>
    </button>
  );
}

/** Search results: ↑↓ to move, Enter to add. Shared by the palette and quick add. */
function Results({ items, q, sel, setSel, onPick }: { items: PaletteItem[]; q: string; sel: number; setSel(i: number): void; onPick(it: PaletteItem): void }) {
  if (!items.length) return <p className="pal-empty">Nothing matches “{q}”</p>;
  return (
    <div className="pal-results" role="listbox">
      {items.map((it, i) => {
        const why = matchedAlias(it, q);
        return (
          <button type="button" key={it.key} role="option" aria-selected={i === sel} className={'pal-row' + (i === sel ? ' on' : '') + (it.sticky ? ' sticky' : '')}
            data-pal-result={it.key} onMouseEnter={() => setSel(i)} onClick={() => onPick(it)}>
            {it.icon}
            <span className="pal-txt"><span>{it.label}</span><small>{why ? <>matches “{why}”</> : it.about}</small></span>
            {i === sel && <kbd>↵</kbd>}
          </button>
        );
      })}
    </div>
  );
}

/** The search box's keys: ↑↓ move, Enter adds, Escape clears (then leaves). */
function keys(ev: React.KeyboardEvent<HTMLInputElement>, n: number, sel: number, setSel: (i: number) => void, pick: () => void, esc: () => void) {
  ev.stopPropagation();
  if (ev.key === 'ArrowDown') { ev.preventDefault(); setSel(Math.min(n - 1, sel + 1)); }
  else if (ev.key === 'ArrowUp') { ev.preventDefault(); setSel(Math.max(0, sel - 1)); }
  else if (ev.key === 'Enter') { ev.preventDefault(); pick(); }
  else if (ev.key === 'Escape') { ev.preventDefault(); esc(); }
}

export function Palette() {
  const open = usePalette(s => s.open);
  const use_ = usePalette(s => s.use);
  const sections = useSections();
  const [q, setQ] = useState(''), [sel, setSel] = useState(0);
  const results = useMemo(() => searchItems(sections, q), [sections, q]);
  const ref = useRef<HTMLDivElement>(null);
  // fit-to-view and new things keep clear of it
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) { setLeftInset(0); return; }
    const set = () => setLeftInset(el.offsetLeft + el.offsetWidth + 8);
    set();
    const ro = new ResizeObserver(set); ro.observe(el);
    return () => { ro.disconnect(); setLeftInset(0); };
  }, [open]);
  useEffect(() => setSel(0), [q]);
  const all = sections.flatMap(s => s.items);

  if (!open) {
    return (
      <div id="palette" className="pal-pill" role="toolbar" aria-label="Add">
        <button type="button" className="pal-pbtn" id="palSearchBtn" title="Search (/)" aria-label="Search" onClick={() => slash(null)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
        </button>
        <span className="pal-psep" />
        {mostUsed(all, use_).map(it => (
          <button type="button" key={it.key} className={'pal-pbtn' + (it.active ? ' active' : '')} title={it.label} aria-label={it.label} data-pal-quick={it.key}
            onPointerDown={it.place ? e => pressTile(e, it) : undefined}
            onClick={() => { if (!consumeDragClick()) use(it); }}>{it.icon}</button>
        ))}
        <span className="pal-psep" />
        <button type="button" className="pal-pbtn" id="palOpen" title="Open the palette" aria-label="Open the palette" onClick={() => setPaletteOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
    );
  }
  return (
    <div id="palette" className="pal" ref={ref} aria-label="Add to the diagram">
      <div className="pal-head">
        <span className="pal-title">{diagram(useEditor.getState().open.kind).kind === 'sequence' ? 'Tools' : 'Components'}</span>
        <button type="button" className="pal-min" id="palClose" title="Collapse" aria-label="Collapse the palette" onClick={() => setPaletteOpen(false)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" /></svg>
        </button>
      </div>
      <label className="pal-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
        <input id="palSearch" type="search" placeholder="Search…" autoComplete="off" spellCheck={false} value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={ev => keys(ev, results.length, sel, setSel, () => { const it = results[sel]; if (it) { use(it); setQ(''); ev.currentTarget.blur(); } },
            () => { if (q) setQ(''); else ev.currentTarget.blur(); })} />
        {q ? <button type="button" className="pal-clear" aria-label="Clear" onClick={() => setQ('')}>×</button> : <kbd>/</kbd>}
      </label>
      <div className="pal-body">
        {q ? <Results items={results} q={q} sel={sel} setSel={setSel} onPick={it => { use(it); setQ(''); }} />
          : sections.map(s => (
            <section key={s.title} className="pal-sec">
              <h4>{s.title}</h4>
              <div className="pal-grid">{s.items.map(it => <Tile key={it.key} it={it} />)}</div>
            </section>
          ))}
      </div>
    </div>
  );
}

/** Quick add: the palette's search where you double-clicked; what you pick lands there. */
export function QuickAdd() {
  const at = usePalette(s => s.quick);
  const use_ = usePalette(s => s.use);
  const sections = useSections();
  const [q, setQ] = useState(''), [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { setQ(''); setSel(0); }, [at]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    if (!at) return;
    const down = (ev: PointerEvent) => { if (!box.current?.contains(ev.target as Node)) closeQuickAdd(); };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [at]);
  if (!at) return null;
  const all = sections.flatMap(s => s.items);
  const items = q ? searchItems(sections, q) : mostUsed(all, use_, 5);
  const st = document.querySelector('#stage')!.getBoundingClientRect();
  const left = Math.min(at.x - st.left + 10, st.width - 330), top = Math.min(at.y - st.top + 10, st.height - 300);
  const pick = (it: PaletteItem) => { closeQuickAdd(); use(it, toWorld(at.x, at.y)); };
  return (
    <>
      <span className="qa-dot" style={{ left: at.x - st.left - 5, top: at.y - st.top - 5 }} />
      <div id="quickAdd" className="pal qa" ref={box} style={{ left: Math.max(8, left), top: Math.max(8, top) }}>
        <label className="pal-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
          <input id="qaSearch" type="search" autoFocus placeholder="Add…" autoComplete="off" spellCheck={false} value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={ev => keys(ev, items.length, sel, setSel, () => { const it = items[sel]; if (it) pick(it); }, closeQuickAdd)} />
          <kbd>esc</kbd>
        </label>
        {!q && <div className="pal-sub">Most used</div>}
        <Results items={items} q={q} sel={sel} setSel={setSel} onPick={pick} />
      </div>
    </>
  );
}

/** Remounted per kind of diagram: each kind's palette hook reads its own state. */
export function PaletteHost() {
  const kind = useEditor(s => s.open.kind);
  return <><Palette key={'p' + kind} /><QuickAdd key={'q' + kind} /><DragLayer /></>;
}
