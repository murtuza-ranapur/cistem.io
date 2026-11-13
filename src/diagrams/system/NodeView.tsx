/** A component on the canvas: its card (kind, name, summary, load bar), expanded detail and connection ports. */
import { memo, useState } from 'react';
import { ICON, NODE_H, qty, typeDef, kindLabel, paletteCss, isSource, detailOf, nodeWidthFor, nodeHeight, type Node } from '../../domain/model';
import type { NodeResult } from '../../domain/engine';
import { fmt, fmtMs, trunc } from '../../lib/format';
import { kindColour, localPort, summary, SIDES } from './geometry';
import { NoteBadge } from '../../notes/NoteBadge';
import { layoutDetail, type DetailItem, type Tag } from './detail';

/** For an expanded service: the endpoints the selected connection calls, and (load view) each endpoint's rps. */
export interface EndpointCalls { hot: number[]; rps: number[] | null }

interface Props {
  n: Node; expanded: boolean; r: NodeResult | undefined; load: boolean;
  selected: boolean; dragging: boolean; target: boolean; animate: boolean;
  calls?: EndpointCalls;
}

const TX = 12 + ICON + 9;

function NodeViewImpl({ n, expanded, r, load, selected, dragging, target, animate, calls }: Props) {
  const [entering, setEntering] = useState(animate);
  const t = typeDef(n.kind), source = isSource(n);
  const detail = expanded ? 'expanded' : undefined;
  const w = nodeWidthFor(n, detail), h = nodeHeight(n, detail);
  const util = r ? Math.min(1, Number.isFinite(r.util) ? r.util : 1) : 0;
  const cls = ['node', `k-${n.kind}`, `b-${t.behaviour}`, selected && 'sel', expanded && 'expanded', n.border === 'dashed' && 'dashed', paletteCss(n.color) && 'tinted', load && r?.status === 'crit' && 'crit', entering && 'enter', dragging && 'dragging', target && 'target'].filter(Boolean).join(' ');
  return (
    <g className={cls} data-node={n.id} transform={`translate(${n.x} ${n.y})`}
      style={{ '--kc': paletteCss(n.color) ?? kindColour(n.kind), '--nx': n.x + 'px', '--ny': n.y + 'px' } as React.CSSProperties}
      onAnimationEnd={e => { if (e.target === e.currentTarget) setEntering(false); }}>
      <title>{n.name}</title>
      <rect className="body" width={w} height={h} rx={9} />
      <rect className="accent" x={0} y={0} width={3} height={h} rx={1.5} />
      {n.logo ? <image className="nlogo" href={n.logo} x={10} y={10} width={ICON + 4} height={ICON + 4} preserveAspectRatio="xMidYMid meet" />
        : <use href={'#' + t.icon} className="glyph" x={12} y={12} width={ICON} height={ICON} />}
      {/* without the load model, the three text lines spread over the card */}
      <text className="kind" x={TX} y={load ? 20 : 22}>{kindLabel(n)}</text>
      <text className="name" x={TX} y={load ? 37 : 41}>{trunc(n.name || '', (w - TX - 12) / 7.2)}</text>
      <text className="sum" x={12} y={load ? 56 : 68}>{trunc(summary(n), (w - 24) / 6.3)}</text>
      {load && <>
        <text className="stat" x={12} y={71}>{source ? `${fmt(qty(n.rps))} rps peak` : r ? (Number.isFinite(r.cap) ? `${fmt(r.load)} / ${fmt(r.cap)} rps · ${fmtMs(r.lat)}` : `${fmt(r.load)} rps · ${fmtMs(r.lat)}`) : ''}</text>
        {!source && Number.isFinite(r?.cap ?? 0) && <>
          <rect className="bar" x={12} y={78} width={w - 24} height={6} rx={3} />
          <rect className={'fill ' + (r?.status ?? 'ok')} x={12} y={78} width={(w - 24) * util} height={6} rx={3} />
          <text className={'stat pct' + (r?.lag ? ' lag' : '')} x={w - 12} y={71} textAnchor="end">{r ? (r.lag ? 'lag ↑' : Number.isFinite(r.util) ? Math.round(r.util * 100) + '%' : '∞') : ''}<title>{r?.lag ? `Falling behind: the backlog grows ${fmt(r.lag)} msg/s` : ''}</title></text>
        </>}
      </>}
      <g className="detail">{expanded && <Detail n={n} w={w} calls={calls} />}</g>
      {detailOf(n) && (
        <g className="chev" data-toggle={n.id} transform={`translate(${w - 20} 20)${expanded ? ' rotate(180 0 0)' : ''}`}>
          <rect x={-10} y={-10} width={20} height={20} rx={5} />
          <path d="M-4 -2 L0 2 L4 -2" />
        </g>
      )}
      {SIDES.map(s => { const p = localPort(w, h, s); return <circle key={s} className="handle" data-handle={s} cx={p.x} cy={p.y} r={5} />; })}
      {selected && <rect className="resize" data-resize={n.id} x={w - 4} y={h / 2 - 16} width={8} height={32} rx={4}><title>Drag to resize · double-click to reset</title></rect>}
      <NoteBadge md={n.notes} x={w} y={0} />
    </g>
  );
}

function Tags({ tags, y }: { tags: Tag[]; y: number }) {
  return <>{tags.map(t => (
    <g key={t.label}>
      <rect className={'tag ' + t.cls} x={t.x} y={y - 9} width={t.label.length * 6 + 8} height={12} rx={3} />
      <text className="tagt" x={t.x + 4} y={y}>{t.label}</text>
    </g>
  ))}</>;
}

function Detail({ n, w, calls }: { n: Node; w: number; calls?: EndpointCalls }) {
  const item = (it: DetailItem, i: number) => {
    switch (it.t) {
      case 'table': return (
        <g key={i}>
          <rect className="tbl" x={12} y={it.y} width={w - 24} height={it.h} rx={5} />
          <rect className="tblhead" x={12} y={it.y} width={w - 24} height={22} rx={5} />
          <text className="tname" x={20} y={it.y + 15}>{it.name}</text>
          <text className="tcount" x={w - 20} y={it.y + 15} textAnchor="end">{it.count}</text>
        </g>
      );
      case 'row': return (
        <g key={i}>
          <Tags tags={it.tags} y={it.y} />
          <text className={'col' + (it.pk ? ' pkcol' : '')} x={it.nameX} y={it.y}>{it.name}</text>
          <text className="ctype" x={w - (it.anchor ? 20 : 14)} y={it.y} textAnchor="end">{it.type}</text>
        </g>
      );
      case 'endpoint': {
        const on = calls?.hot.includes(it.i), rps = calls?.rps?.[it.i];
        return (
          <g key={i} className={'eprow' + (on ? ' hot' : '')} data-endpoint={it.i}>
            <title>{`${it.method} ${it.path}`}</title>
            <rect className="ephit" x={4} y={it.y - 1} width={w - 8} height={it.h} rx={4} />
            {on && <circle className="epdot" cx={10} cy={it.y + 8} r={3} />}
            <text className={'method m-' + it.method.toLowerCase()} x={16} y={it.y + 12}>{it.method}</text>
            {it.lines.map((l, k) => <text key={k} className="path" x={62} y={it.y + 12 + k * 14}>{l}</text>)}
            <text className="ctype" x={w - 14} y={it.y + 12} textAnchor="end">{rps != null ? (rps > 0 ? fmt(rps) + ' rps' : '—') : it.meta}</text>
          </g>
        );
      }
      case 'topic': return (
        <g key={i}>
          <text className="tname" x={14} y={it.y + 13}>{it.name}</text>
          <text className="tcount" x={w - 14} y={it.y + 13} textAnchor="end">{it.partitions}</text>
        </g>
      );
    }
  };
  return <>
    <line className="sep" x1={12} y1={NODE_H + 2} x2={w - 12} y2={NODE_H + 2} />
    {layoutDetail(n, w).map(item)}
  </>;
}

const sameCalls = (a?: EndpointCalls, b?: EndpointCalls) => a === b || (!!a && !!b && a.hot.join() === b.hot.join() && (a.rps ?? []).join() === (b.rps ?? []).join());
const sameResult = (a?: NodeResult, b?: NodeResult) => a === b || (!!a && !!b && a.load === b.load && a.cap === b.cap && a.lat === b.lat && a.util === b.util && a.status === b.status && a.lag === b.lag);
/** Re-render only when this node, its result or its state changed (a drag redraws just the moved nodes). */
export const NodeView = memo(NodeViewImpl, (a, b) =>
  a.n === b.n && a.load === b.load && sameCalls(a.calls, b.calls) && a.expanded === b.expanded && a.selected === b.selected && a.dragging === b.dragging && a.target === b.target && sameResult(a.r, b.r));
