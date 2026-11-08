/**
 * The notes editor's building blocks (TipTap). Everything here reads and writes markdown, so a note is
 * plain text in the file. Formats markdown has no syntax for are kept as small HTML tags:
 * coloured highlights `<mark data-color>` and text colour `<span style="color">`.
 */
import { Node, mergeAttributes, type Extensions, type JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import { TableKit } from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import { createLowlight } from 'lowlight';
import json from 'highlight.js/lib/languages/json';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import xml from 'highlight.js/lib/languages/xml';
import { HIGHLIGHTS, TEXT_COLORS } from './palette';

/** Languages for code blocks: the ones system designs are written about. */
const lowlight = createLowlight({ json, javascript, typescript, java, kotlin, sql, yaml, bash, python, xml });
lowlight.registerAlias({ javascript: ['js'], typescript: ['ts'], bash: ['sh', 'shell'], xml: ['html'], yaml: ['yml'] });

/** Only colours from the palette survive (a note can't smuggle styles in through a colour value). */
const allowed = (palette: readonly { value: string }[], v: unknown) => (typeof v === 'string' && palette.some(p => p.value === v) ? v : null);

/** Highlight in several colours: plain `==text==` for the default, `<mark data-color>` for the others. */
const ColourHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: el => allowed(HIGHLIGHTS, el.getAttribute('data-color')),
        renderHTML: attrs => (attrs.color ? { 'data-color': attrs.color, style: `background-color: ${attrs.color}` } : {}),
      },
    };
  },
  renderMarkdown: (node, h) => {
    const inner = h.renderChildren(node);
    const color = node.attrs?.color;
    return color && color !== HIGHLIGHTS[0].value ? `<mark data-color="${color}">${inner}</mark>` : `==${inner}==`;
  },
}).configure({ multicolor: true });

/** Text colour, kept as `<span style="color: …">` in markdown. */
const ColourText = TextStyle.extend({
  renderMarkdown: (node, h) => {
    const inner = h.renderChildren(node);
    const color = allowed(TEXT_COLORS, node.attrs?.color);
    return color ? `<span style="color: ${color}">${inner}</span>` : inner;
  },
});
const SafeColor = Color.extend({
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        color: {
          default: null,
          parseHTML: el => allowed(TEXT_COLORS, el.style.color ? normaliseColor(el.style.color) : null),
          renderHTML: attrs => (attrs.color ? { style: `color: ${attrs.color}` } : {}),
        },
      },
    }];
  },
});
/** The browser reports colours as rgb(); the palette is hex. */
function normaliseColor(c: string): string {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(c);
  return m ? '#' + m.slice(1).map(x => (+x).toString(16).padStart(2, '0')).join('') : c.toLowerCase();
}

export const CALLOUT_KINDS = ['info', 'tip', 'warning'] as const;
export type CalloutKind = typeof CALLOUT_KINDS[number];

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: { setCallout: (kind?: CalloutKind) => ReturnType };
  }
}

/** A callout box, written as a GitHub alert: `> [!WARNING]` followed by quoted lines. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: 'info',
        parseHTML: el => (CALLOUT_KINDS as readonly string[]).includes(el.getAttribute('data-callout') ?? '') ? el.getAttribute('data-callout') : 'info',
        renderHTML: attrs => ({ 'data-callout': attrs.kind }),
      },
    };
  },
  parseHTML: () => [{ tag: 'div[data-callout]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'note-callout' }), 0],
  addCommands() {
    return {
      setCallout: (kind = 'info') => ({ commands }) => commands.wrapIn(this.name, { kind }),
    };
  },
  markdownTokenizer: {
    name: 'callout',
    level: 'block',
    start: (src: string) => src.search(/^> ?\[!(?:note|info|tip|warning)\]/im),
    tokenize(src, _tokens, lexer) {
      const m = /^> ?\[!(note|info|tip|warning)\][^\n]*(?:\n|$)((?:>[^\n]*(?:\n|$))*)/i.exec(src);
      if (!m) return undefined;
      const inner = m[2].split('\n').map(l => l.replace(/^> ?/, '')).join('\n');
      const kind = m[1].toLowerCase() === 'note' ? 'info' : m[1].toLowerCase();
      return { type: 'callout', raw: m[0], kind, tokens: lexer.blockTokens(inner) };
    },
  },
  parseMarkdown: (token, h) => h.createNode('callout', { kind: token.kind ?? 'info' }, (h.parseBlockChildren ?? h.parseChildren)(token.tokens || [])),
  renderMarkdown: (node, h) => {
    const parts: string[] = [];
    (node.content ?? []).forEach((child: JSONContent, i: number) => {
      const text = h.renderChild?.(child, i) ?? h.renderChildren([child]);
      parts.push(text.split('\n').map(l => (l.trim() ? `> ${l}` : '>')).join('\n'));
    });
    return `> [!${String(node.attrs?.kind ?? 'info').toUpperCase()}]\n` + parts.join('\n>\n');
  },
});

/** Links: web links open in a new tab; `#cistem:<kind>:<id>` links point at an item in the diagram. */
export const COMPONENT_LINK = '#cistem:';

/** `toggleTask` ticks a checkbox while the note isn't being edited (the editor's own handler only flips the box). */
export function noteExtensions(opts: { placeholder: string; toggleTask?: (node: PMNode, checked: boolean) => boolean }): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,   // replaced by the highlighted one
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
        isAllowedUri: (url, ctx) => url.startsWith(COMPONENT_LINK) || ctx.defaultValidate(url),
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true, onReadOnlyChecked: opts.toggleTask ?? (() => false) }),
    ColourHighlight,
    ColourText,
    SafeColor,
    TableKit.configure({ table: { resizable: false } }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    Callout,
    Placeholder.configure({ placeholder: opts.placeholder }),
    Markdown,
  ];
}
