/** The formatting toolbar: floating over a selection on the canvas, or fixed at the top in the details panel. */
import { useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { HIGHLIGHTS, TEXT_COLORS } from './palette';
import { TEXT_STYLES, currentStyle, applyStyle } from './blocks';
import { modLabel } from '../lib/browser';

type Pop = 'highlight' | 'color' | 'link' | null;

export function Toolbar({ editor, variant }: { editor: Editor; variant: 'floating' | 'fixed' }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: currentStyle(e),
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'), code: e.isActive('code'),
      highlight: e.isActive('highlight'), color: e.getAttributes('textStyle').color as string | undefined,
      bullets: e.isActive('bulletList'), numbers: e.isActive('orderedList'), tasks: e.isActive('taskList'),
      link: e.getAttributes('link').href as string | undefined, table: e.isActive('table'),
    }),
  });
  const [pop, setPop] = useState<Pop>(null);
  const chain = () => editor.chain().focus();
  const btn = (fmt: string, label: string, on: boolean, run: () => void, body: React.ReactNode, keys?: string) => (
    <button type="button" data-fmt={fmt} aria-label={label} title={keys ? `${label} (${keys})` : label} aria-pressed={on} className={on ? 'on' : ''}
      onMouseDown={e => e.preventDefault()} onClick={run}>{body}</button>
  );
  return (
    <div className={'note-toolbar ' + variant} role="toolbar" aria-label="Formatting" onMouseDown={e => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault(); }}>
      <select aria-label="Text style" data-fmt="style" value={s.style} onChange={e => applyStyle(editor, e.target.value)}>
        {TEXT_STYLES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      <span className="sep" />
      {btn('bold', 'Bold', s.bold, () => chain().toggleBold().run(), <b>B</b>, `${modLabel}B`)}
      {btn('italic', 'Italic', s.italic, () => chain().toggleItalic().run(), <i>I</i>, `${modLabel}I`)}
      {btn('underline', 'Underline', s.underline, () => chain().toggleUnderline().run(), <u>U</u>, `${modLabel}U`)}
      {btn('strike', 'Strikethrough', s.strike, () => chain().toggleStrike().run(), <s>S</s>, `${modLabel}⇧S`)}
      {btn('code', 'Inline code', s.code, () => chain().toggleCode().run(), <code>{'</>'}</code>, `${modLabel}E`)}
      <span className="sep" />
      <span className="pop-anchor">
        {btn('highlight', 'Highlight', s.highlight, () => setPop(pop === 'highlight' ? null : 'highlight'), <span className="swatch hl" />, `${modLabel}⇧H`)}
        {pop === 'highlight' && (
          <Palette label="Highlight colour" colours={HIGHLIGHTS} onPick={c => { chain().setHighlight({ color: c }).run(); setPop(null); }}
            onClear={() => { chain().unsetHighlight().run(); setPop(null); }} kind="hl" />
        )}
      </span>
      <span className="pop-anchor">
        {btn('color', 'Text colour', !!s.color, () => setPop(pop === 'color' ? null : 'color'), <span className="text-colour">A<span style={{ background: s.color ?? 'currentColor' }} /></span>)}
        {pop === 'color' && (
          <Palette label="Text colour" colours={TEXT_COLORS} onPick={c => { chain().setColor(c).run(); setPop(null); }}
            onClear={() => { chain().unsetColor().run(); setPop(null); }} kind="text" />
        )}
      </span>
      <span className="sep" />
      {btn('bullets', 'Bulleted list', s.bullets, () => chain().toggleBulletList().run(), <ListIcon />)}
      {btn('numbers', 'Numbered list', s.numbers, () => chain().toggleOrderedList().run(), <span className="num">1.</span>)}
      {btn('tasks', 'Checklist', s.tasks, () => chain().toggleTaskList().run(), <TaskIcon />)}
      <span className="pop-anchor">
        {btn('link', 'Link', !!s.link, () => setPop(pop === 'link' ? null : 'link'), <LinkIcon />)}
        {pop === 'link' && <LinkBox href={s.link ?? ''} onDone={href => {
          if (href === null) editor.commands.focus();
          else if (!href) chain().extendMarkRange('link').unsetLink().run();
          else chain().extendMarkRange('link').setLink({ href }).run();
          setPop(null);
        }} />}
      </span>
      {variant === 'fixed' && (
        <>
          {btn('table', s.table ? 'Delete table' : 'Insert table', s.table, () => (s.table ? chain().deleteTable().run() : chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()), <TableIcon />)}
          <span className="hint">Type / for blocks · @ to link an item</span>
        </>
      )}
    </div>
  );
}

function Palette({ label, colours, onPick, onClear, kind }: { label: string; colours: readonly { name: string; value: string }[]; onPick(c: string): void; onClear(): void; kind: 'hl' | 'text' }) {
  return (
    <div className="note-pop palette" role="group" aria-label={label}>
      {colours.map(c => (
        <button type="button" key={c.value} data-colour={c.name.toLowerCase()} aria-label={c.name} title={c.name} onMouseDown={e => e.preventDefault()} onClick={() => onPick(c.value)}
          className={kind} style={kind === 'hl' ? { background: c.value } : { color: c.value }}>{kind === 'text' ? 'A' : ''}</button>
      ))}
      <button type="button" data-colour="none" aria-label="None" title="None" className="none" onMouseDown={e => e.preventDefault()} onClick={onClear}>⌀</button>
    </div>
  );
}

/** Edit a link's address: Enter applies, empty removes, Escape cancels. */
function LinkBox({ href, onDone }: { href: string; onDone(href: string | null): void }) {
  const [v, setV] = useState(href);
  return (
    <div className="note-pop link">
      <input autoFocus aria-label="Link address" placeholder="https://… (empty removes the link)" value={v} onChange={e => setV(e.target.value)}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); onDone(v.trim()); } if (e.key === 'Escape') onDone(null); }} />
      <button type="button" onClick={() => onDone(v.trim())}>Apply</button>
    </div>
  );
}

const ListIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>;
const TaskIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="6" height="6" rx="1" /><path d="M4.5 7l1 1 2-2" /><path d="M13 7h8M13 17h8" /><rect x="3" y="14" width="6" height="6" rx="1" /></svg>;
const LinkIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>;
const TableIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></svg>;
