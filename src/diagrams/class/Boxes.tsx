/** Drawing a class diagram: boxes with their members, and relation lines with UML markers. */
import { memo, useMemo } from 'react';
import { boxSize, isMethod, typeRefs, CLS, type ClassBox, type Member, type Relation } from '../../domain/cls';
import type { Box, Point } from '../../store/viewport';
import { NoteBadge } from '../../notes/NoteBadge';
import { KIND_COLOR, along, clipRect, endMarker, startMarker } from './model';

// ---------- boxes ----------

function MemberRow({ m, enumConst, x, y, owner, i, kind, known }: {
  m: Member; enumConst: boolean; x: number; y: number; owner: string; i: number; kind: 'f' | 'm'; known: Set<string>;
}) {
  const key = `${owner}:${kind}:${i}`;
  if (enumConst) return <text className="cl-mem" x={x} y={y} data-mem={key}>{m.name}</text>;
  const ref = typeRefs(m.type).some(r => known.has(r.name) && r.name !== owner);
  return (
    <text className={'cl-mem' + (m.static ? ' static' : '') + (m.abstract ? ' abstract' : '')} x={x} y={y} data-mem={key}>
      {m.vis && <><tspan className="cl-vis">{m.vis}</tspan>{' '}</>}
      {isMethod(m) ? <>{m.name}(<tspan className="cl-params">{m.params}</tspan>)</> : m.name}
      {m.type && <tspan className={'cl-type' + (ref ? ' ref' : '')}>: {m.type}</tspan>}
    </text>
  );
}

export const ClassBoxView = memo(function ClassBoxView({ c, x, y, on, names }: { c: ClassBox; x: number; y: number; on: boolean; names: string }) {
  const known = useMemo(() => new Set(names.split('\n')), [names]);
  const s = boxSize(c), w = s.w, h = s.h;
  const stereo = c.stereo ? `«${c.stereo}»` : c.kind === 'class' ? '' : `«${c.kind}»`;
  const top = y + 10 + (stereo ? CLS.stereoH : 0);
  const fy = y + s.headH, my = fy + s.fieldsH;
  const showMethods = !(c.kind === 'enum' || (c.kind === 'record' && !c.methods.length));
  return (
    <g className={`cl-box${on ? ' on' : ''} k-${c.kind}`} data-class={c.name} style={{ '--kc': KIND_COLOR[c.kind] } as React.CSSProperties}>
      <rect className="cl-body" x={x} y={y} width={w} height={h} rx={8} />
      <path className="cl-bar" d={`M${x + 1} ${y + 5}a6 6 0 0 1 6 -5h${w - 14}a6 6 0 0 1 6 5z`} />
      {stereo && <text className="cl-stereo" x={x + w / 2} y={y + 19} textAnchor="middle">{stereo}</text>}
      <text className={'cl-name' + (c.kind === 'abstract' ? ' abstract' : '')} x={x + w / 2} y={top + 15} textAnchor="middle" data-rename={c.name}>{c.name}</text>
      <line className="cl-div" x1={x} x2={x + w} y1={fy} y2={fy} />
      {c.fields.map((f, i) => <MemberRow key={'f' + i} m={f} enumConst={c.kind === 'enum'} x={x + 10} y={fy + 15 + i * CLS.row} owner={c.name} i={i} kind="f" known={known} />)}
      {showMethods && <>
        <line className="cl-div" x1={x} x2={x + w} y1={my} y2={my} />
        {c.methods.map((m, i) => <MemberRow key={'m' + i} m={m} enumConst={false} x={x + 10} y={my + 15 + i * CLS.row} owner={c.name} i={i} kind="m" known={known} />)}
      </>}
      <circle className="cl-port" cx={x + w} cy={y + Math.min(h / 2, 40)} r={6} data-port={c.name}><title>Drag onto another class to relate them</title></circle>
      <NoteBadge md={c.notes} x={x + w} y={y} />
    </g>
  );
});

// ---------- relations ----------

const marker = (name: string, on: boolean) => (name ? `url(#cl-${name}${on ? '-on' : ''})` : undefined);

/** Where a relation runs: between two boxes (p1 → p2), or a loop on one box (self). */
export interface RelationLine { r: Relation; p1?: Point; p2?: Point; self?: Point }

/** Where each relation runs; pairs with several relations fan out a little. */
export function relationGeometry(relations: Relation[], rects: Record<string, Box>): RelationLine[] {
  const pairs: Record<string, number> = {};
  return relations.flatMap((r): RelationLine[] => {
    const a = rects[r.from], b = rects[r.to]; if (!a || !b) return [];
    if (r.from === r.to) return [{ r, self: { x: a.x + a.w, y: a.y + 14 } }];
    const key = [r.from, r.to].sort().join('|'), k = (pairs[key] = (pairs[key] ?? 0) + 1);
    const off = (k - 1) * 14 * (k % 2 ? 1 : -1);
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1, nx = -(cb.y - ca.y) / len * off, ny = (cb.x - ca.x) / len * off;
    const p1 = clipRect(a, { x: cb.x + nx, y: cb.y + ny }), p2 = clipRect(b, { x: ca.x + nx, y: ca.y + ny });
    return [{ r, p1: { x: p1.x + nx, y: p1.y + ny }, p2: { x: p2.x + nx, y: p2.y + ny } }];
  });
}

export const RelationView = memo(function RelationView({ r, on, p1, p2, self }: RelationLine & { on: boolean }) {
  const cls = `cl-rel ${r.type}${on ? ' on' : ''}`;
  if (self) {
    const { x, y } = self;
    return (
      <g className={cls} data-rel={r.id}>
        <path className="cl-rhit" d={`M${x} ${y}h30v30h-30`} />
        <path className="cl-rline" d={`M${x} ${y}h30v30h-28`} markerEnd={marker(endMarker(r.type), on)} />
        {r.label && <text className="cl-rlabel" x={x + 36} y={y + 19}>{r.label}</text>}
      </g>
    );
  }
  const a = p1!, b = p2!;
  const fromMult = r.fromMult ? along(a, b, 26) : null, toMult = r.toMult ? along(b, a, 26) : null;
  return (
    <g className={cls} data-rel={r.id}>
      <line className="cl-rhit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      <line className="cl-rline" x1={a.x} y1={a.y} x2={b.x} y2={b.y} markerStart={marker(startMarker(r.type), on)} markerEnd={marker(endMarker(r.type), on)} />
      {r.label && <text className="cl-rlabel" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} textAnchor="middle">{r.label}</text>}
      {fromMult && <text className="cl-mult" x={fromMult.x + 8} y={fromMult.y - 6}>{r.fromMult}</text>}
      {toMult && <text className="cl-mult" x={toMult.x + 8} y={toMult.y - 6}>{r.toMult}</text>}
    </g>
  );
});

/** The line following the pointer while a relation is drawn from a class's dot. */
export function Ghost({ from, to }: { from: Box; to: Point | Box }) {
  const target = 'w' in to ? clipRect(to, { x: from.x + from.w / 2, y: from.y + from.h / 2 }) : to;
  const s = clipRect(from, target);
  return <line className="cl-ghost" x1={s.x} y1={s.y} x2={target.x} y2={target.y} markerEnd="url(#cl-open-on)" />;
}

/** UML markers: triangles (extends/implements), open arrows (uses/depends), diamonds (owns/has); -on when selected. */
export function ClassMarkers() {
  const tri = (id: string, stroke: string, sw: number) => (
    <marker id={id} viewBox="0 0 12 12" refX="11.5" refY="6" markerWidth="13" markerHeight="13" orient="auto-start-reverse"><path d="M1 1L11.5 6L1 11z" fill="var(--panel)" stroke={stroke} strokeWidth={sw} /></marker>
  );
  const open = (id: string, stroke: string, sw: number) => (
    <marker id={id} viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M1 1L9.5 5L1 9" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" /></marker>
  );
  const diamond = (id: string, fill: string, stroke?: string, sw?: number) => (
    <marker id={id} viewBox="0 0 16 10" refX="0.5" refY="5" markerWidth="16" markerHeight="10" orient="auto-start-reverse"><path d="M0.5 5L8 1L15.5 5L8 9z" fill={fill} stroke={stroke} strokeWidth={sw} /></marker>
  );
  return <>
    {tri('cl-tri', 'var(--seq-line)', 1.2)}{tri('cl-tri-on', 'var(--sel)', 1.4)}
    {open('cl-open', 'var(--seq-line)', 1.4)}{open('cl-open-on', 'var(--sel)', 1.6)}
    {diamond('cl-dfill', 'var(--seq-line)')}{diamond('cl-dfill-on', 'var(--sel)')}
    {diamond('cl-dhollow', 'var(--panel)', 'var(--seq-line)', 1.1)}{diamond('cl-dhollow-on', 'var(--panel)', 'var(--sel)', 1.3)}
  </>;
}
