/** The sequence drawing: blocks, lifelines, activation bars, messages and notes, block labels, then heads on top. */
import { memo, useMemo } from 'react';
import { SEQ, textW, timing, type BlockGeo, type Participant, type Row, type SeqDoc, type SeqGeo } from '../../domain/seq';
import { TYPES, typeDef } from '../../domain/model';
import { fmtMs, trunc } from '../../lib/format';
import { useEditor, isSelected } from '../../store/editor';
import { Surface } from '../../ui/Surface';
import { InlineEdit, useDoc } from '../shared';
import { edgeX, geometry, insertY, wrapText } from './geometry';
import { useSeqUi, type Drag } from './state';
import { useSeqGestures } from './gestures';
import { useLinkedSystem, nodeOf, labelSuggestions, REPLY_LABELS, type LinkedSystem } from './linked';
import { addParticipant } from './actions';
import { NoteBadge } from '../../notes/NoteBadge';
import { cancelEdit, commitEdit } from './edit';

export function SeqCanvas() {
  const d = useDoc('sequence');
  const sel = useEditor(s => s.selection);
  const drag = useSeqUi(s => s.drag);
  const g = geometry(d);
  const sys = useLinkedSystem(d);
  const times = useMemo(() => timing(d, sys?.doc ?? null, sys?.res ?? null).at, [d, sys]);
  const gestures = useSeqGestures();
  const on = (id: string) => isSelected(sel, 'row', id);
  const bottom = g.height - 12;
  return (
    <>
      <Surface id="seqSvg" worldId="seqWorld" label="Sequence diagram" defs={<Markers />} {...gestures}>
        {g.blocks.map(b => <BlockBox key={b.id} b={b} on={on(b.id)} />)}
        {d.participants.map(p => <Lifeline key={p.id} id={p.id} x={g.colX[p.id] ?? 0} bottom={bottom} on={isSelected(sel, 'part', p.id)} />)}
        {g.acts.map((a, i) => <rect key={i} className="sq-act" data-life={a.pid} x={(g.colX[a.pid] ?? 0) - 5 + a.level * 6} y={a.y1} width={10} height={Math.max(8, a.y2 - a.y1)} rx={2} />)}
        {d.rows.map((r, i) => <RowView key={r.id} r={r} g={g} i={i} on={on(r.id)} time={times[r.id]} />)}
        {g.blocks.map(b => <BlockLabel key={b.id} b={b} on={on(b.id)} elseOn={b.elses.map(e => on(e.id))} />)}
        {d.participants.map(p => <Head key={p.id} p={p} x={g.colX[p.id] ?? 0} on={isSelected(sel, 'part', p.id)} sys={sys} offset={drag?.t === 'head' && drag.pid === p.id && drag.moved ? drag.x - drag.x0 : 0} />)}
        {drag?.moved && <Feedback drag={drag} g={g} />}
      </Surface>
      {!d.participants.length && (
        <div id="seqEmpty">
          <strong>Empty sequence</strong>
          <span>Add participants from the left (P), then drag from one lifeline to another to draw a message.<br />Or open the Code tab in the panel and paste Mermaid or PlantUML.</span>
          <button type="button" className="small primary" id="seqStart" onClick={() => addParticipant()}>Add a participant</button>
        </div>
      )}
      <Editor d={d} />
    </>
  );
}

function Markers() {
  const solid = (id: string, fill: string) => (
    <marker id={id} viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0.5L10 5L0 9.5z" fill={fill} /></marker>
  );
  const open = (id: string, stroke: string, w: number) => (
    <marker id={id} viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M1 1L9.5 5L1 9" fill="none" stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" /></marker>
  );
  return <>{solid('sq-solid', 'var(--seq-line)')}{solid('sq-solid-on', 'var(--sel)')}{open('sq-open', 'var(--seq-line)', 1.4)}{open('sq-open-on', 'var(--sel)', 1.6)}</>;
}

const BlockBox = memo(function BlockBox({ b, on }: { b: BlockGeo; on: boolean }) {
  return (
    <g className={`sq-block ${on ? 'on' : ''}`} data-row={b.id}>
      <rect className="sq-bbox" x={b.x1} y={b.y1} width={b.x2 - b.x1} height={Math.max(10, b.y2 - b.y1)} rx={6} />
      {b.elses.map(e => <line key={e.id} className="sq-else" x1={b.x1} x2={b.x2} y1={e.y} y2={e.y} data-row={e.id} />)}
    </g>
  );
});

/** A block's kind tab and guards, on a later layer so lifelines and activation bars never cover them. */
const BlockLabel = memo(function BlockLabel({ b, on, elseOn }: { b: BlockGeo; on: boolean; elseOn: boolean[] }) {
  const tw = textW(b.kind) * 1.15 + 18;
  return (
    <g className={`sq-block ${on ? 'on' : ''}`} data-row={b.id}>
      <path className="sq-btab" data-grip={b.id} d={`M${b.x1} ${b.y1 + 6}a6 6 0 0 1 6 -6h${tw}v14l-8 8h-${tw - 2}z`} />
      <text className="sq-bkind" x={b.x1 + 9} y={b.y1 + 15} data-grip={b.id}>{b.kind}</text>
      {b.guard && <text className="sq-guard sq-halo" x={b.x1 + tw + 14} y={b.y1 + 15} data-edit={b.id}>[{b.guard}]</text>}
      {b.elses.map((e, i) => (
        <text key={e.id} className={`sq-guard sq-halo ${elseOn[i] ? 'on' : ''}`} x={b.x1 + 10} y={e.y + 15} data-row={e.id} data-edit={e.id}>[{e.guard || (b.kind === 'par' ? 'and' : 'else')}]</text>
      ))}
    </g>
  );
}, (a, b) => a.b === b.b && a.on === b.on && a.elseOn.join() === b.elseOn.join());

const Lifeline = memo(function Lifeline({ id, x, bottom, on }: { id: string; x: number; bottom: number; on: boolean }) {
  const top = SEQ.top + SEQ.headH;
  return (
    <g className={`sq-life ${on ? 'on' : ''}`} data-life={id}>
      <rect className="sq-lhit" x={x - 14} y={top} width={28} height={Math.max(40, bottom - top)} />
      <line className="sq-lline" x1={x} x2={x} y1={top} y2={bottom} />
    </g>
  );
});

const marker = (style: string, on: boolean) => `url(#sq-${style === 'sync' ? 'solid' : 'open'}${on ? '-on' : ''})`;
const Placeholder = ({ text }: { text: string }) => <tspan className="sq-ph">{text}</tspan>;

/** A message or note (blocks are drawn by BlockBox / BlockLabel). */
const RowView = memo(function RowView({ r, g, i, on, time }: { r: Row; g: SeqGeo; i: number; on: boolean; time: number | undefined }) {
  const at = g.rows[i];
  if (r.t === 'msg') {
    const cls = `sq-msg sq-${r.style} ${on ? 'on' : ''}`;
    const label = r.label || <Placeholder text="label" />;
    let body;
    if (r.from === r.to) {
      const x = edgeX(g, r.from, at.ay, Infinity), y = at.ay, w = 40;
      body = (
        <g className={cls} data-row={r.id}>
          <path className="sq-hit" d={`M${x} ${y}h${w}v22h-${w - 4}`} />
          <path className="sq-line" d={`M${x} ${y}h${w}v22h-${w - 2}`} markerEnd={marker(r.style, on)} />
          <text className="sq-label" x={x + w + 8} y={y + 15} data-edit={r.id}>{label}</text>
        </g>
      );
    } else {
      const xa0 = g.colX[r.from], xb0 = g.colX[r.to];
      const xa = edgeX(g, r.from, at.ay, xb0), xb = edgeX(g, r.to, at.ay + 1, xa0), dir = xb > xa ? 1 : -1;
      body = (
        <g className={cls} data-row={r.id}>
          <line className="sq-hit" x1={xa} x2={xb} y1={at.ay} y2={at.ay} />
          <line className="sq-line" x1={xa} x2={xb - dir * 1.5} y1={at.ay} y2={at.ay} markerEnd={marker(r.style, on)} />
          <text className="sq-label" x={(xa + xb) / 2} y={at.ay - 8} textAnchor="middle" data-edit={r.id}>{label}</text>
        </g>
      );
    }
    return <>{body}{time !== undefined && <text className="sq-time" x={g.width - 4} y={at.ay + 4} textAnchor="end">{fmtMs(time)}</text>}</>;
  }
  if (r.t === 'note') {
    const xs = r.over.map(p => g.colX[p]).filter(x => x !== undefined);
    const lines = wrapText(r.text || ' ', 230);
    const x1 = Math.min(...xs) - 30, x2 = Math.max(...xs) + 30, w = Math.max(x2 - x1, Math.max(...lines.map(textW)) + 20), cx = (x1 + x2) / 2;
    return (
      <g className={`sq-note ${on ? 'on' : ''}`} data-row={r.id}>
        <path d={`M${cx - w / 2} ${at.y + 6}h${w - 10}l10 10v${at.h - 18}h-${w}z`} />
        {lines.map((l, k) => <text key={k} x={cx - w / 2 + 10} y={at.y + 22 + k * SEQ.noteLine} data-edit={r.id}>{l.trim() ? l : <Placeholder text="note" />}</text>)}
      </g>
    );
  }
  return null;
});

const colorOf = (p: Participant) => (p.type === 'actor' ? 'var(--c-entry)' : p.type && TYPES[p.type] ? `var(--c-${p.type}, ${typeDef(p.type).color})` : 'var(--muted)');
export const typeLabel = (p: Participant) => (p.type === 'actor' ? 'Actor' : p.type && TYPES[p.type] ? typeDef(p.type).label : 'Participant');

/** A lifeline's head: drawn last so long lifelines never cover it. */
const Head = memo(function Head({ p, x, on, sys, offset }: { p: Participant; x: number; on: boolean; sys: LinkedSystem | null; offset: number }) {
  const missing = !!p.ref && !!sys && !nodeOf(p, sys);
  return (
    <g className={`sq-head ${on ? 'on' : ''} ${offset ? 'dragging' : ''}`} data-head={p.id} style={{ '--kc': colorOf(p) } as React.CSSProperties} transform={offset ? `translate(${offset} 0)` : undefined}>
      <rect x={x - SEQ.headW / 2} y={SEQ.top} width={SEQ.headW} height={SEQ.headH} rx={7} />
      <path className="sq-hbar" d={`M${x - SEQ.headW / 2 + 1} ${SEQ.top + 4}a6 6 0 0 1 6 -4h${SEQ.headW - 14}a6 6 0 0 1 6 4z`} />
      <text className="sq-htype" x={x} y={SEQ.top + 17} textAnchor="middle">{typeLabel(p)}{missing ? ' · link missing' : ''}</text>
      <text className="sq-hname" x={x} y={SEQ.top + 35} textAnchor="middle" data-edit-part={p.id}>{trunc(p.name, 22)}</text>
      <NoteBadge md={p.notes} x={x + SEQ.headW / 2} y={SEQ.top} />
    </g>
  );
});

/** Where a gesture will land: the insertion line, and a ghost of the message being drawn. */
function Feedback({ drag, g }: { drag: Drag; g: SeqGeo }) {
  const xs = g.cols.map(c => c.x), x1 = Math.min(...xs) - 60, x2 = Math.max(...xs) + 60;
  if (drag.t === 'msg') {
    const iy = insertY(g, drag.at, SEQ.firstRow), xa = g.colX[drag.from], xb = drag.to ? g.colX[drag.to] : drag.x;
    return (
      <>
        <line className="sq-ins" x1={x1} x2={x2} y1={iy} y2={iy} />
        {drag.to === drag.from
          ? <path className="sq-ghost" d={`M${xa} ${iy + 14}h40v22h-38`} markerEnd="url(#sq-solid-on)" />
          : <line className="sq-ghost" x1={xa} x2={xb} y1={iy + 18} y2={iy + 18} markerEnd="url(#sq-solid-on)" />}
      </>
    );
  }
  if (drag.t === 'move') { const iy = insertY(g, drag.at, SEQ.firstRow); return <line className="sq-ins" x1={x1} x2={x2} y1={iy} y2={iy} />; }
  if (drag.t === 'head') {
    const ix = drag.at >= xs.length ? xs[xs.length - 1] + 95 : xs[drag.at] - 95;
    return <line className="sq-ins" x1={ix} x2={ix} y1={SEQ.top - 6} y2={SEQ.top + SEQ.headH + 6} />;
  }
  return null;
}

/** The text box for editing in place, with label suggestions for messages. */
function Editor({ d }: { d: SeqDoc }) {
  const editing = useSeqUi(s => s.editing);
  const row = editing && !editing.part ? d.rows.find(r => r.id === editing.id) : undefined;
  const options = row?.t === 'msg' ? (row.style === 'reply' ? [...REPLY_LABELS, 'response'] : labelSuggestions(d, row.to)) : [];
  return (
    <>
      <datalist id="seqLabels">{options.map(o => <option key={o} value={o} />)}</datalist>
      {editing && (
        <InlineEdit key={editing.id + (editing.part ? ':part' : '')} id="seqEdit" value={editing.value} allowEmpty={!editing.part}
          list={editing.list ? 'seqLabels' : undefined}
          style={{ left: editing.x, top: editing.y, width: editing.w }}
          onCommit={commitEdit} onCancel={cancelEdit} />
      )}
    </>
  );
}
