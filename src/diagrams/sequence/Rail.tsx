/** The sequence palette: add a lifeline, pick the kind of message to draw, add a note, wrap in a block. */
import { BLOCK_KINDS } from '../../domain/seq';
import { Icon } from '../../ui/Icon';
import { useSeqUi } from './state';
import { seqTool } from './actions';
import type { PaletteItem, PaletteSection } from '../../palette/types';

const MESSAGES = [
  { tool: 'sync', icon: 'ic-sq-call', label: 'Call', about: 'A request that waits for an answer: drag between lifelines (C)', aliases: ['sync', 'request', 'message'] },
  { tool: 'async', icon: 'ic-sq-async', label: 'Async', about: 'Fire and forget, e.g. publishing an event (A)', aliases: ['event', 'publish', 'message'] },
  { tool: 'reply', icon: 'ic-sq-reply', label: 'Reply', about: 'The answer to a call (R)', aliases: ['response', 'return'] },
];
const BLOCKS: Record<string, { label: string; about: string }> = {
  alt: { label: 'If / else', about: 'Alternatives: wraps the selected messages' },
  opt: { label: 'Optional', about: 'Happens only sometimes: wraps the selected messages' },
  loop: { label: 'Repeat', about: 'A loop: wraps the selected messages (L)' },
  par: { label: 'Parallel', about: 'At the same time: wraps the selected messages' },
};

export function usePalette(): PaletteSection[] {
  const tool = useSeqUi(s => s.tool);
  const item = (key: string, label: string, icon: React.ReactNode, about: string, aliases: string[] = []): PaletteItem =>
    ({ key, label, icon, about, aliases, active: tool === key, attrs: { 'data-seqtool': key }, add: () => seqTool(key) });
  return [
    { title: 'Lifelines', items: [item('participant', 'Participant', <Icon name="ic-sq-part" />, 'A lifeline: a service, a user, a system (P)', ['lifeline', 'actor', 'service'])] },
    { title: 'Messages', items: MESSAGES.map(m => item(m.tool, m.label, <Icon name={m.icon} />, m.about, m.aliases)) },
    { title: 'Notes & blocks', items: [
      item('note', 'Note over', <Icon name="ic-sq-note" />, 'A note over lifelines, part of the flow (N)', ['comment', 'annotation']),
      ...BLOCK_KINDS.map(k => item(k, BLOCKS[k].label, <span className="sq-kw">{k}</span>, BLOCKS[k].about, [k, k === 'alt' ? 'else' : k === 'loop' ? 'for each' : ''].filter(Boolean))),
    ] },
  ];
}
