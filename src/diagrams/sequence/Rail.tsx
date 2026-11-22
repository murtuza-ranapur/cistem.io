/** The sequence palette: add a lifeline, pick the kind of message to draw, add a note, wrap in a block. */
import { BLOCK_KINDS } from '../../domain/seq';
import { Icon } from '../../ui/Icon';
import { useSeqUi } from './state';
import { addParticipant, seqTool } from './actions';
import { geometry } from './geometry';
import { SEQ } from '../../domain/seq';
import { docOf } from '../shared';
import type { DropPreview } from '../../palette/types';
import type { Point } from '../../store/viewport';
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

/** Where a lifeline dropped with its middle at `x` goes: the gap nearest it, and the x to mark it at. */
function slotAt(x: number): { index: number; x: number; y2: number } {
  const g = geometry(docOf('sequence')), cols = g.cols;
  if (!cols.length) return { index: 0, x, y2: SEQ.top + 200 };
  const edges = [cols[0].x - cols[0].w / 2 - 40, ...cols.slice(1).map((c, i) => (cols[i].x + c.x) / 2), cols[cols.length - 1].x + cols[cols.length - 1].w / 2 + 40];
  let index = 0;
  edges.forEach((e, i) => { if (Math.abs(e - x) < Math.abs(edges[index] - x)) index = i; });
  return { index, x: edges[index], y2: Math.max(g.height, SEQ.top + 200) };
}
const participantPlace = {
  w: SEQ.headW, h: SEQ.headH,
  preview: (at: Point): DropPreview => { const s = slotAt(at.x + SEQ.headW / 2); return { slot: { x: s.x, y1: SEQ.top - 8, y2: s.y2 }, at: { x: s.x - SEQ.headW / 2, y: SEQ.top } }; },
  drop: (at: Point) => { addParticipant(undefined, slotAt(at.x + SEQ.headW / 2).index); },
};

export function usePalette(): PaletteSection[] {
  const tool = useSeqUi(s => s.tool);
  const item = (key: string, label: string, icon: React.ReactNode, about: string, aliases: string[] = []): PaletteItem =>
    ({ key, label, icon, about, aliases, active: tool === key, attrs: { 'data-seqtool': key }, add: () => seqTool(key) });
  return [
    { title: 'Lifelines', items: [{ ...item('participant', 'Participant', <Icon name="ic-sq-part" />, 'A lifeline: a service, a user, a system (P); drag it between two', ['lifeline', 'actor', 'service']), place: participantPlace }] },
    { title: 'Messages', items: MESSAGES.map(m => item(m.tool, m.label, <Icon name={m.icon} />, m.about, m.aliases)) },
    { title: 'Notes & blocks', items: [
      item('note', 'Note over', <Icon name="ic-sq-note" />, 'A note over lifelines, part of the flow (N)', ['comment', 'annotation']),
      ...BLOCK_KINDS.map(k => item(k, BLOCKS[k].label, <span className="sq-kw">{k}</span>, BLOCKS[k].about, [k, k === 'alt' ? 'else' : k === 'loop' ? 'for each' : ''].filter(Boolean))),
    ] },
  ];
}
