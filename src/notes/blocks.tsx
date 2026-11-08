/** The blocks the `/` menu and the toolbar's block picker can insert or turn the current line into. */
import type { Editor, Range } from '@tiptap/core';
import type { MenuItem } from './suggest';
import type { CalloutKind } from './extensions';

type Run = (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>;
const block = (id: string, title: string, hint: string, icon: React.ReactNode, keywords: string, run: Run): MenuItem => ({
  id, title, hint, icon, keywords,
  run: (editor: Editor, range: Range) => { run(editor.chain().focus().deleteRange(range)).run(); },
});

const ic = (text: string) => <b>{text}</b>;
const callout = (kind: CalloutKind): Run => c => c.setCallout(kind);

export const BLOCKS: MenuItem[] = [
  block('text', 'Text', 'Plain paragraph', ic('¶'), 'paragraph body', c => c.setParagraph()),
  block('h1', 'Heading 1', '# Title', ic('H1'), 'title big', c => c.setHeading({ level: 1 })),
  block('h2', 'Heading 2', '## Section', ic('H2'), 'subtitle', c => c.setHeading({ level: 2 })),
  block('h3', 'Heading 3', '### Small heading', ic('H3'), 'subheading', c => c.setHeading({ level: 3 })),
  block('bullets', 'Bulleted list', '- item', ic('•'), 'unordered ul', c => c.toggleBulletList()),
  block('numbers', 'Numbered list', '1. item', ic('1.'), 'ordered ol', c => c.toggleOrderedList()),
  block('tasks', 'Checklist', '[ ] task', ic('☐'), 'todo task checkbox', c => c.toggleTaskList()),
  block('quote', 'Quote', '> quote', ic('❝'), 'blockquote', c => c.toggleBlockquote()),
  block('info', 'Callout: info', 'A highlighted box', ic('i'), 'note callout info', callout('info')),
  block('tip', 'Callout: tip', 'A tip box', ic('✓'), 'callout tip', callout('tip')),
  block('warning', 'Callout: warning', 'A warning box', ic('!'), 'callout warning danger', callout('warning')),
  block('code', 'Code block', '``` with syntax colours', ic('{}'), 'snippet json sql', c => c.toggleCodeBlock()),
  block('table', 'Table', '3 × 3', ic('▦'), 'grid columns', c => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true })),
  block('divider', 'Divider', '---', ic('—'), 'rule line hr', c => c.setHorizontalRule()),
];

/** The block picker's choices (what the current line is), in the toolbar. */
export const TEXT_STYLES = [
  { id: 'text', label: 'Text' },
  { id: 'h1', label: 'Heading 1' },
  { id: 'h2', label: 'Heading 2' },
  { id: 'h3', label: 'Heading 3' },
  { id: 'quote', label: 'Quote' },
  { id: 'info', label: 'Callout' },
  { id: 'code', label: 'Code block' },
] as const;

export function currentStyle(editor: Editor): string {
  if (editor.isActive('heading', { level: 1 })) return 'h1';
  if (editor.isActive('heading', { level: 2 })) return 'h2';
  if (editor.isActive('heading', { level: 3 })) return 'h3';
  if (editor.isActive('codeBlock')) return 'code';
  if (editor.isActive('callout')) return 'info';
  if (editor.isActive('blockquote')) return 'quote';
  return 'text';
}
export function applyStyle(editor: Editor, id: string) {
  const c = editor.chain().focus();
  if (editor.isActive('callout') && id !== 'info') c.lift('callout');
  switch (id) {
    case 'h1': case 'h2': case 'h3': c.setHeading({ level: +id[1] as 1 | 2 | 3 }); break;
    case 'quote': c.toggleBlockquote(); break;
    case 'info': if (!editor.isActive('callout')) c.setCallout('info'); break;
    case 'code': c.toggleCodeBlock(); break;
    default: c.setParagraph();
  }
  c.run();
}
