/**
 * Type-ahead menus inside a note: `/` inserts a block, `@` links an item of the diagram.
 * Built on TipTap's Suggestion plugin; the list itself is a small React popup positioned at the caret.
 */
import { Extension, type Editor, type Range } from '@tiptap/core';
import { Suggestion, type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

export interface MenuItem {
  id: string;
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  keywords?: string;
  run(editor: Editor, range: Range): void;
}

/** The open menu (at most one at a time across all notes). */
interface OpenMenu { char: string; items: MenuItem[]; index: number; rect: DOMRect | null; pick(item: MenuItem): void }
const useMenu = create<{ menu: OpenMenu | null }>(() => ({ menu: null }));

function filter(items: MenuItem[], query: string): MenuItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return items.slice(0, 12);
  return items.filter(i => (i.title + ' ' + (i.keywords ?? '')).toLowerCase().includes(q)).slice(0, 12);
}

/** A Suggestion-backed menu for `char`; `items()` is read each time it opens. */
export function suggestionMenu(name: string, char: string, items: () => MenuItem[]) {
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [Suggestion<MenuItem>({
        editor: this.editor,
        pluginKey: new PluginKey(name),
        char,
        allowSpaces: char === '@',
        startOfLine: false,
        items: ({ query }) => filter(items(), query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let current: SuggestionProps<MenuItem> | null = null;
          const show = (p: SuggestionProps<MenuItem>) => {
            current = p;
            const prev = useMenu.getState().menu;
            useMenu.setState({ menu: { char, items: p.items, index: prev?.char === char ? Math.min(prev.index, Math.max(0, p.items.length - 1)) : 0, rect: p.clientRect?.() ?? null, pick: item => p.command(item) } });
          };
          return {
            onStart: show,
            onUpdate: show,
            onExit: () => { current = null; useMenu.setState({ menu: null }); },
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              const m = useMenu.getState().menu;
              if (!m || !current) return false;
              if (event.key === 'Escape') { useMenu.setState({ menu: null }); return true; }
              if (!m.items.length) return false;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                const d = event.key === 'ArrowDown' ? 1 : -1;
                useMenu.setState({ menu: { ...m, index: (m.index + d + m.items.length) % m.items.length } });
                return true;
              }
              if (event.key === 'Enter' || event.key === 'Tab') { m.pick(m.items[m.index]); return true; }
              return false;
            },
          };
        },
      })];
    },
  });
}

/** The popup for whichever menu is open (rendered once, by every editor that might open one). */
export function SuggestionPopup() {
  const menu = useMenu(s => s.menu);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => { el?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [el, menu?.index]);
  if (!menu || !menu.rect) return null;
  const top = Math.min(menu.rect.bottom + 6, innerHeight - 320), left = Math.min(menu.rect.left, innerWidth - 300);
  return createPortal(
    <div className="note-suggest" role="listbox" aria-label={menu.char === '/' ? 'Insert block' : 'Link an item'} ref={setEl} style={{ top, left }}
      onMouseDown={e => e.preventDefault()}>
      {menu.items.length === 0 && <div className="note-suggest-empty">{menu.char === '@' ? 'Nothing in this diagram matches' : 'No matching block'}</div>}
      {menu.items.map((it, i) => (
        <button type="button" role="option" key={it.id} aria-selected={i === menu.index} className={i === menu.index ? 'on' : ''}
          onMouseEnter={() => useMenu.setState({ menu: { ...menu, index: i } })} onClick={() => menu.pick(it)}>
          {it.icon && <span className="note-suggest-ic">{it.icon}</span>}
          <span><span className="note-suggest-title">{it.title}</span>{it.hint && <small>{it.hint}</small>}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
