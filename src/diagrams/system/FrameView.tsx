/** An environment's frame: a tinted box with its name, kind and owner in the header strip. */
import { memo } from 'react';
import { CONTAINER_KINDS, FRAME_HEAD, frameColor, type Container, type Frame } from '../../domain/model';
import { textWidth } from '../../lib/browser';
import { trunc } from '../../lib/format';

const FONT = '"IBM Plex Sans", system-ui, sans-serif';
const titleW = (s: string) => textWidth(s, `600 12.5px ${FONT}`);
const kindW = (s: string) => textWidth(s, `10.5px ${FONT}`) + s.length * 0.42;
const metaW = (s: string) => textWidth(s, '10.5px "IBM Plex Mono", monospace');

interface Props { c: Container; f: Frame; depth: number; selected: boolean; target: boolean }

export const FrameView = memo(function FrameView({ c, f, depth, selected, target }: Props) {
  const col = frameColor(c);
  // fit the header: the title shortens first; the kind and the owner drop out when there's no room
  const avail = f.w - 44;
  let title = c.name, tw = titleW(title);
  if (tw > avail) { title = trunc(c.name, Math.max(3, Math.floor(c.name.length * avail / tw))); tw = titleW(title); }
  let kind = CONTAINER_KINDS[c.kind].label + (c.provider ? ` · ${c.provider}` : '');
  const kw = kindW(kind);
  if (tw + 8 + kw > avail) kind = '';
  let owner = c.owner ?? '';
  if (owner && metaW(owner) + 16 > f.w - (32 + tw + 8 + (kind ? kw + 12 : 0))) owner = '';
  const cls = `frame k-${c.kind} fill-${c.fill ?? 'tint'} border-${c.border ?? 'dashed'}${selected ? ' sel' : ''}${target ? ' target' : ''}`;
  return (
    <g className={cls} data-container={c.id} style={{ '--h': col.h, '--s': col.s + '%', '--depth': depth } as React.CSSProperties}>
      <rect className="fbody" rx={12} x={f.x} y={f.y} width={f.w} height={f.h} />
      <rect className="fhead" height={FRAME_HEAD} x={f.x} y={f.y} width={f.w} rx={12} />
      <use href="#ic-container" className="ficon" width={14} height={14} x={f.x + 12} y={f.y + 8} />
      <text className="ftitle" x={f.x + 32} y={f.y + 20}>{title}</text>
      <text className="fkind" x={f.x + 32 + tw + 8} y={f.y + 20}>{kind}</text>
      <text className="fmeta" textAnchor="end" x={f.x + f.w - 12} y={f.y + 20}>{owner}</text>
    </g>
  );
});
