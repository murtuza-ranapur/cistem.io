/**
 * A rich note: formatted as you type, saved as markdown. Loaded on demand (see ./index.tsx).
 *
 * Read view (`editable` false) still lets checkboxes be ticked and links be followed. Edits are reported as
 * markdown through `onChange`; when `value` changes from outside (undo, another window) the note follows,
 * unless it's being typed in.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { noteExtensions, COMPONENT_LINK } from './extensions';
import { suggestionMenu, SuggestionPopup, type MenuItem } from './suggest';
import { BLOCKS } from './blocks';
import { Toolbar } from './Toolbar';

/** Something in the diagram a note can link to with `@`. */
export interface LinkTarget { kind: string; id: string; name: string; sub?: string }

export interface NoteEditorProps {
  value: string;
  onChange(markdown: string): void;
  editable: boolean;
  /** Floating toolbar over a selection (canvas), fixed at the top (panel), or none. */
  toolbar: 'floating' | 'fixed' | 'none';
  placeholder?: string;
  autoFocus?: boolean;
  onFocus?(): void;
  onBlur?(): void;
  /** Items `@` can link to. */
  linkTargets?(): LinkTarget[];
  /** A `@` link was clicked: kind and id of the item. */
  onOpenItem?(kind: string, id: string): void;
  className?: string;
}

export default function NoteEditor(p: NoteEditorProps) {
  const latest = useRef(p);
  latest.current = p;
  const emitted = useRef(p.value);

  const extensions = useMemo(() => [
    ...noteExtensions({ placeholder: p.placeholder ?? 'Write something… (/ for blocks)', toggleTask: () => true }),
    suggestionMenu('slashMenu', '/', () => BLOCKS),
    suggestionMenu('linkMenu', '@', () => (latest.current.linkTargets?.() ?? []).map(linkItem)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const host = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);

  // the editor belongs to this component: made when it mounts, destroyed when it unmounts
  useEffect(() => {
    const ed = new Editor({
      element: host.current!,
      extensions,
      content: latest.current.value,
      contentType: 'markdown',
      editable: latest.current.editable,
      autofocus: latest.current.editable && latest.current.autoFocus ? 'end' : false,
      editorProps: {
        attributes: { class: 'note-prose', spellcheck: 'true' },
        handleDOMEvents: { click: (_view, event) => openItemLink(event) },
      },
      onUpdate: ({ editor: e }) => {
        const md = e.getMarkdown().replace(/\s+$/, '');
        if (md === emitted.current) return;
        emitted.current = md;
        latest.current.onChange(md);
      },
      onFocus: () => latest.current.onFocus?.(),
      onBlur: () => latest.current.onBlur?.(),
    });
    editorRef.current = ed;
    setEditor(ed);
    const el = host.current!;
    el.addEventListener('change', tickFromDom);
    return () => { el.removeEventListener('change', tickFromDom); ed.destroy(); editorRef.current = null; setEditor(null); };
    // made once; props are read through `latest`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Tick a checkbox in the read view: find its item from the checkbox and set it (reported through onChange like any edit). */
  function tickFromDom(ev: Event) {
    const box = ev.target as HTMLInputElement;
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed || ed.isEditable || box.type !== 'checkbox') return;
    const li = box.closest('li');
    if (!li || !host.current?.contains(li)) return;
    // the item starts just before its first content position (or at it, depending on the view)
    const inner = ed.view.posAtDOM(li, 0);
    for (const at of [inner - 1, inner, inner - 2]) {
      const node = at >= 0 ? ed.state.doc.nodeAt(at) : null;
      if (node?.type.name !== 'taskItem') continue;
      ed.view.dispatch(ed.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, checked: box.checked }));
      return;
    }
  }

  /** `@` links select the item; they never navigate. */
  function openItemLink(event: Event): boolean {
    const a = (event.target as HTMLElement).closest?.('a');
    const href = a?.getAttribute('href') ?? '';
    if (!href.startsWith(COMPONENT_LINK)) return false;
    event.preventDefault();
    const [kind, ...id] = href.slice(COMPONENT_LINK.length).split(':');
    latest.current.onOpenItem?.(kind, id.join(':'));
    return true;
  }

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(p.editable, false);
    if (p.editable && p.autoFocus) editor.commands.focus('end');
  }, [editor, p.editable, p.autoFocus]);

  // follow changes made elsewhere (undo, another window, the MCP), unless the note is being typed in
  useEffect(() => {
    if (!editor || editor.isDestroyed || p.value === emitted.current || editor.isFocused) return;
    emitted.current = p.value;
    editor.commands.setContent(p.value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, p.value]);

  return (
    <div className={'note-editor' + (p.editable ? ' editing' : '') + (p.className ? ' ' + p.className : '')}>
      {editor && p.editable && p.toolbar === 'fixed' && <Toolbar editor={editor} variant="fixed" />}
      {editor && p.editable && p.toolbar === 'floating' && (
        <BubbleMenu editor={editor} options={{ placement: 'top-start', offset: 8 }} shouldShow={({ editor: e, state }) => e.isEditable && !state.selection.empty && !e.isActive('codeBlock')}>
          <Toolbar editor={editor} variant="floating" />
        </BubbleMenu>
      )}
      <div ref={host} className="note-host" />
      {p.editable && <SuggestionPopup />}
    </div>
  );
}

function linkItem(t: LinkTarget): MenuItem {
  return {
    id: t.kind + ':' + t.id,
    title: t.name,
    hint: t.sub,
    keywords: t.sub,
    icon: <b>@</b>,
    run: (editor: Editor, range) => {
      editor.chain().focus().deleteRange(range)
        .insertContent([{ type: 'text', text: '@' + t.name, marks: [{ type: 'link', attrs: { href: `${COMPONENT_LINK}${t.kind}:${t.id}` } }] }, { type: 'text', text: ' ' }])
        .run();
    },
  };
}
