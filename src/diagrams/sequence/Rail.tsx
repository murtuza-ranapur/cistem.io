/** The sequence tools on the left: add a lifeline, pick the kind of message to draw, add a note, wrap in a block. */
import { BLOCK_KINDS } from '../../domain/seq';
import { Icon } from '../../ui/Icon';
import { useSeqUi } from './state';
import { seqTool } from './actions';

const MESSAGES = [
  { tool: 'sync', icon: 'ic-sq-call', label: 'Call', title: 'Call — then drag between lifelines (C)' },
  { tool: 'async', icon: 'ic-sq-async', label: 'Async', title: 'Async message (A)' },
  { tool: 'reply', icon: 'ic-sq-reply', label: 'Reply', title: 'Reply (R)' },
  { tool: 'note', icon: 'ic-sq-note', label: 'Note over', title: 'Note over lifelines (N)' },
];
const BLOCK_TITLES: Record<string, string> = { alt: 'Alternatives', opt: 'Optional', loop: 'Loop', par: 'Parallel' };

export function SeqRail() {
  const tool = useSeqUi(s => s.tool);
  const button = (name: string, title: string, glyph: React.ReactNode, label: string) => (
    <button type="button" key={name} className={'comp sq-tool' + (tool === name ? ' active' : '')} data-seqtool={name} title={title} onClick={() => seqTool(name)}>
      {glyph}<span>{label}</span>
    </button>
  );
  return (
    <div id="railSeq" className="rail-seq">
      {button('participant', 'Participant (P)', <Icon name="ic-sq-part" />, 'Participant')}
      <div className="rail-group-label">Messages</div>
      {MESSAGES.map(m => button(m.tool, m.title, <Icon name={m.icon} />, m.label))}
      <div className="rail-group-label">Blocks</div>
      {BLOCK_KINDS.map(k => button(k, `${BLOCK_TITLES[k]} — wraps the selected messages${k === 'loop' ? ' (L)' : ''}`, <span className="sq-kw">{k}</span>, k[0].toUpperCase() + k.slice(1)))}
    </div>
  );
}
