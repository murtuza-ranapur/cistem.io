/** The tab strip and the + (new diagram) menu. */
import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';
import { useTabs, activate, closeTab, moveTab, newTab, type Tab } from '../store/tabs';
import { useCloud } from '../store/cloud';
import { useUi } from '../store/ui';
import { openDrawer } from '../store/account';
import { active } from '../store/commands';
import { diagram } from '../diagrams';
import type { DiagramKind } from '../domain/document';
import { Icon } from './Icon';
import { useDismiss, moveFocus } from './hooks';
import { openExample } from './actions';

export function TabBar() {
  const { list, active: activeKey } = useTabs();
  const listRef = useRef<HTMLDivElement>(null);
  return (
    <nav id="tabs" aria-label="Open diagrams">
      <div id="tabList" role="tablist" ref={listRef}>
        {list.map(t => <TabItem key={t.key} tab={t} on={t.key === activeKey} list={listRef} />)}
      </div>
      <NewTabButton />
    </nav>
  );
}

/** Signed out, a tab's document exists only in this browser, so closing it deletes it: ask once. */
const needsConfirm = (t: Tab) => !t.cloudId && !t.share && !useCloud.getState().user;
/** The tab whose × is asking "discard?". */
const useArmed = create(() => ({ key: '' }));
/** Close a tab from its ×, middle-click or ⌥W (asking first when closing would lose it). */
export function requestCloseTab(key: string) {
  const t = useTabs.getState().list.find(x => x.key === key); if (!t) return;
  if (needsConfirm(t) && useArmed.getState().key !== key) {
    useArmed.setState({ key });
    setTimeout(() => useArmed.setState(s => (s.key === key ? { key: '' } : s)), 2600);
    return;
  }
  void closeTab(key);
}

function TabItem({ tab, on, list }: { tab: Tab; on: boolean; list: React.RefObject<HTMLDivElement | null> }) {
  const el = useRef<HTMLDivElement>(null);
  const armed = useArmed(s => s.key === tab.key);
  const drag = useRef<{ x0: number; moved: boolean } | null>(null);
  const requestClose = () => requestCloseTab(tab.key);
  useEffect(() => { if (on) el.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [on]);

  // click to switch, middle-click to close, drag to reorder
  const onPointerDown = (ev: React.PointerEvent) => {
    if ((ev.target as Element).closest('[data-close]')) return;
    if (ev.button === 1) { ev.preventDefault(); requestClose(); return; }
    if (ev.button === 0) drag.current = { x0: ev.clientX, moved: false };
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = ev.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 5) return;
    if (!d.moved) { d.moved = true; el.current!.setPointerCapture(ev.pointerId); el.current!.classList.add('dragging'); }
    el.current!.style.transform = `translateX(${dx}px)`;
  };
  const onPointerUp = () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (!d.moved) { void activate(tab.key); return; }
    // drop where the dragged tab's centre landed among the others
    const r = el.current!.getBoundingClientRect(), cx = r.left + r.width / 2;
    const others = [...list.current!.querySelectorAll<HTMLElement>('.dtab')].filter(x => x !== el.current);
    let to = others.findIndex(o => { const b = o.getBoundingClientRect(); return cx < b.left + b.width / 2; });
    if (to < 0) to = others.length;
    el.current!.style.transform = ''; el.current!.classList.remove('dragging');
    moveTab(tab.key, to);
  };
  return (
    <div ref={el} className={`dtab k-${tab.kind}-tab${on ? ' on' : ''}`} role="tab" aria-selected={on} data-key={tab.key} title={tab.title}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onAuxClick={e => e.button === 1 && e.preventDefault()}>
      <span className={`tk k-${tab.kind}`}><Icon name={`ic-k-${tab.kind}`} /></span>
      <span className="tt">{tab.title || 'Untitled'}</span>
      <span className="tkind">{diagram(tab.kind).label}</span>
      {tab.share && <span className="tro">view only</span>}
      <button type="button" className={'tx' + (armed ? ' armed' : '')} data-close={tab.key} aria-label={`Close ${tab.title}`}
        title={armed ? 'Only kept in this browser. Click again to discard.' : 'Close (⌥W)'}
        onClick={e => { e.stopPropagation(); requestClose(); }}>
        {armed ? 'discard?' : <Icon name="ic-close" />}
      </button>
    </div>
  );
}

const NEW_ITEMS: { kind: DiagramKind; title: string; sub: string }[] = [
  { kind: 'system', title: 'System', sub: 'Components with capacity, environments, load' },
  { kind: 'sequence', title: 'Sequence', sub: 'Who calls whom, in order — drag between lifelines' },
  { kind: 'class', title: 'Class', sub: 'Types, fields, methods and how they relate' },
];

function NewTabButton() {
  const open = useUi(s => s.newMenuOpen);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={btn} className="newtab" id="newTabBtn" title="New diagram (⌥T)" aria-label="New diagram" aria-haspopup="menu" aria-expanded={open}
        onClick={() => useUi.setState({ newMenuOpen: !open })}>+</button>
      {open && <NewMenu anchor={btn} />}
    </>
  );
}

function NewMenu({ anchor }: { anchor: React.RefObject<HTMLButtonElement | null> }) {
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => useUi.setState({ newMenuOpen: false }), []);
  useDismiss(menu, true, () => { close(); anchor.current?.focus(); }, anchor);
  const from = active().madeFrom?.() ?? null;
  const r = anchor.current?.getBoundingClientRect();
  const run = (fn: () => void) => () => { close(); fn(); };
  return (
    <div id="newMenu" className="newmenu" role="menu" ref={menu}
      style={{ left: Math.max(12, Math.min(r?.left ?? 12, innerWidth - 412)), top: (r?.bottom ?? 40) + 6 }}
      onKeyDown={ev => {
        if (/^[1-3]$/.test(ev.key)) { ev.preventDefault(); run(() => void newTab(NEW_ITEMS[+ev.key - 1].kind))(); }
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); moveFocus(menu.current!, '.nm-item, .nm-line, .chip', ev.key === 'ArrowDown' ? 1 : -1); }
      }}>
      <div className="nm-head">New diagram</div>
      {NEW_ITEMS.map((it, i) => (
        <button type="button" key={it.kind} className="nm-item" role="menuitem" data-new={it.kind} autoFocus={i === 0} onClick={run(() => void newTab(it.kind))}>
          <span className={`nm-ic k-${it.kind}`}><Icon name={`ic-k-${it.kind}`} /></span>
          <span><strong>{it.title}</strong><span className="nm-sub">{it.sub}</span></span><kbd>{i + 1}</kbd>
        </button>
      ))}
      {from && (
        <div className="nm-from" id="nmFrom">
          <div className="nm-head" id="nmFromHead">Made from “{from.title}”</div>
          {from.pathStart && (
            <button type="button" className="nm-line" role="menuitem" data-nm="seq-path" onClick={run(from.fromPath)}>
              <span className="k-sequence-ink"><Icon name="ic-k-sequence" /></span>
              <span id="nmPathLabel">Sequence from a request path</span>
              <span className="nm-sub" id="nmPathSub">starting at {from.pathStart}</span>
            </button>
          )}
          <div id="nmFromExtra">
            {from.extra.map(x => (
              <button type="button" key={x.label} className="nm-line" role="menuitem" onClick={run(x.run)}>
                <span className="k-class-ink"><Icon name="ic-k-class" /></span><span>{x.label}</span><span />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="nm-foot">
        <button type="button" className="chip" data-nm="open" onClick={run(openDrawer)}>Open existing…</button>
        <button type="button" className="chip" data-nm="import" onClick={run(() => useUi.setState({ ioOpen: 'import' }))}>Import .json</button>
        <button type="button" className="chip" data-nm="example" onClick={run(openExample)}>Example</button>
      </div>
    </div>
  );
}
