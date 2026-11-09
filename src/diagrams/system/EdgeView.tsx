/**
 * A connection: the curve (with a wide invisible hit area), drawn in its own style, and its label — the text
 * the person wrote, the endpoint it calls, the rps it carries (load view) and, if asked, its notes.
 */
import { memo, useState } from 'react';
import { paletteCss, type Edge } from '../../domain/model';
import type { EdgeGeometry } from './geometry';

export type EdgeStyle = Pick<Edge, 'line' | 'color' | 'width' | 'arrows'>;

const WIDTH = { thin: 1, medium: 1.5, thick: 3 } as const;

/** Stroke width, dash pattern and colour for a style (`cross`: it crosses an environment, dashed unless set). */
export function strokeOf(s: EdgeStyle, cross: boolean) {
  const w = WIDTH[s.width ?? 'medium'];
  const line = s.line ?? (cross ? 'dashed' : 'solid');
  const dash = line === 'dashed' ? `${Math.max(7, w * 4.5)} ${Math.max(4, w * 2.6)}` : line === 'dotted' ? `0.1 ${Math.max(4.5, w * 2.7)}` : 'none';
  return { w, dash, dotted: line === 'dotted', colour: paletteCss(s.color) };
}

interface LineProps { id: string; geo: EdgeGeometry; selected: boolean; crit: boolean; cross: boolean; animate: boolean; style: EdgeStyle }

export const EdgeLine = memo(function EdgeLine({ id, geo, selected, crit, cross, animate, style }: LineProps) {
  const [entering, setEntering] = useState(animate);
  const st = strokeOf(style, cross);
  const cls = ['edge', selected && 'sel', crit && 'crit', st.colour && 'tinted', st.dotted && 'dotted', entering && 'enter'].filter(Boolean).join(' ');
  const marker = `url(#${crit ? 'arrowCrit' : style.color && st.colour ? 'arrow-' + style.color : selected ? 'arrowSel' : 'arrow'})`;
  const vars = { '--ew': st.w + 'px', '--ed': st.dash, ...(st.colour ? { '--ec': st.colour } : {}) } as React.CSSProperties;
  return (
    <g className={cls} data-edge={id} style={vars}>
      <path className="hit" d={geo.d} />
      <path className="line" d={geo.d}
        markerEnd={style.arrows === 'none' ? undefined : marker}
        markerStart={style.arrows === 'both' ? marker : undefined}
        style={entering ? { strokeDasharray: geo.len, '--len': geo.len } as React.CSSProperties : undefined}
        onAnimationEnd={() => setEntering(false)} />
    </g>
  );
}, (a, b) => a.geo.d === b.geo.d && a.selected === b.selected && a.crit === b.crit && a.cross === b.cross
  && a.style.line === b.style.line && a.style.color === b.style.color && a.style.width === b.style.width && a.style.arrows === b.style.arrows);

/** What a connection's label shows, top to bottom; any may be missing. `label` may hold several lines. */
export interface LabelLines { label?: string; endpoint?: string; rps?: string; notes?: string[] }

/** The label's own lines: the newlines typed, with long lines wrapped, at most 6 in all. */
export const labelRows = (label: string | undefined): string[] =>
  !label ? [] : label.split('\n').flatMap(l => (l.trim() ? wrap(l, 40, 6) : [])).slice(0, 6);

const SANS = 6.3, MONO = 6.05, ROW = 14, NOTE_ROW = 13.5;

/** The label's size (for placing and hiding it): the chip, and the notes box under it. */
export function labelBox(l: LabelLines) {
  const rows = [...labelRows(l.label).map(t => t.length * SANS), l.endpoint && l.endpoint.length * MONO, l.rps && l.rps.length * MONO].filter((x): x is number => !!x);
  const chipW = rows.length ? Math.max(...rows) + 14 : 0, chipH = rows.length ? rows.length * ROW + 5 : 0;
  const notesW = l.notes?.length ? Math.min(236, Math.max(...l.notes.map(s => s.length * 5.9)) + 18) : 0;
  const notesH = l.notes?.length ? l.notes.length * NOTE_ROW + 9 : 0;
  return { w: Math.max(chipW, notesW), h: chipH + (notesH ? notesH + (chipH ? 4 : 0) : 0), chipW, chipH, notesW, notesH };
}

/** Wrap plain text into at most `max` lines of about `cols` characters, the last ending in … when cut. */
export function wrap(text: string, cols = 38, max = 4): string[] {
  const out: string[] = []; let line = '';
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!line) line = w.length > cols ? w.slice(0, cols - 1) + '…' : w;
    else if ((line + ' ' + w).length <= cols) line += ' ' + w;
    else { out.push(line); line = w.length > cols ? w.slice(0, cols - 1) + '…' : w; }
    if (out.length === max) { out[max - 1] = out[max - 1].replace(/.?$/, '…'); return out; }
  }
  if (line) out.push(line);
  return out.slice(0, max);
}

interface LabelProps { id: string; lines: LabelLines; x: number; y: number; selected: boolean; hidden: boolean; colour: string | null }

/** Labels sit on their own layer above the nodes; one that would be cramped or land on a node is hidden. */
export const EdgeLabel = memo(function EdgeLabel({ id, lines, x, y, selected, hidden, colour }: LabelProps) {
  const b = labelBox(lines);
  const rows: [string, string, string?][] = [];
  labelRows(lines.label).forEach((t, i) => rows.push(['t-label', t, 'l' + i]));
  if (lines.endpoint) rows.push(['t-ep', lines.endpoint]);
  if (lines.rps) rows.push(['t-rps', lines.rps]);
  const top = y - (b.chipH ? b.chipH / 2 : 0);
  const notesTop = b.chipH ? top + b.chipH + 4 : y - b.notesH / 2;
  return (
    <g className={'edge-label' + (selected ? ' sel' : '') + (hidden ? ' hidden' : '')} data-edge={id}
      style={colour ? { '--ec': colour } as React.CSSProperties : undefined}>
      {b.chipH > 0 && <>
        <rect className={'lbl' + (colour ? ' tinted' : '')} x={x - b.chipW / 2} y={top} width={b.chipW} height={b.chipH} />
        {rows.map(([cls, text, k], i) => <text key={k ?? cls} className={cls} textAnchor="middle" x={x} y={top + 13 + i * ROW}>{text}</text>)}
      </>}
      {b.notesH > 0 && <g className="enote">
        <rect x={x - b.notesW / 2} y={notesTop} width={b.notesW} height={b.notesH} rx={5} />
        {lines.notes!.map((t, i) => <text key={i} x={x - b.notesW / 2 + 9} y={notesTop + 14 + i * NOTE_ROW}>{t}</text>)}
      </g>}
    </g>
  );
}, (a, b) => a.x === b.x && a.y === b.y && a.selected === b.selected && a.hidden === b.hidden && a.colour === b.colour
  && JSON.stringify(a.lines) === JSON.stringify(b.lines));
