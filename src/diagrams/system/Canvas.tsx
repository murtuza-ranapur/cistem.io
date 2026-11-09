/**
 * The system canvas: environments, connections and components, with the gestures that edit them —
 * drag to move (into or out of environments), drag a port to connect, drag a frame to move what's inside,
 * shift/alt-drag to select several, drag the background to pan, double-click to rename, drop from the rail.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ancestry, typeDef, TYPES, NODE_H, ICON, qty, paletteCss, CONTAINER_COLORS, type ContainerColor, type Doc, type Frame, type Kind } from '../../domain/model';
import { hasNotes, notePreview } from '../../domain/notes';
import { fmt, fmtCalls } from '../../lib/format';
import { useEditor, editor, select, selectOne, toggleSelected, makePrimary, isSelected } from '../../store/editor';
import * as history from '../../store/history';
import { toWorld, toScreen, pointerWorld, type Point } from '../../store/viewport';
import { imageIn } from '../../lib/logo';
import { isTyping } from '../../lib/browser';
import { useLoadView } from '../../store/loadView';
import { appFromLogo, logoOnto } from './logo';
import { hint, holdPanel, releasePanel } from '../../store/ui';
import { Surface } from '../../ui/Surface';
import { InlineEdit, useDoubleTap } from '../shared';
import { computeFrames, containerAt, cachedEdgeGeometry, nodeH, nodeW, opposite, overlapsNode, pathBetween, port, routeSides, snap, type EdgeGeometry, type Side } from './geometry';
import { fkPaths } from './detail';
import { addContainer, addNode, connect, toggleDetail } from './actions';
import { edit, findNode, resultsOf, selectedNodeIds, sysDoc, useSysDoc } from './state';
import { FrameView } from './FrameView';
import { NodeView } from './NodeView';
import { EdgeLabel, EdgeLine, labelBox, wrap, type LabelLines } from './EdgeView';

type Gesture =
  | { t: 'node'; ids: string[]; start: Record<string, Point>; origin: Point; moved: boolean }
  | { t: 'frame'; id: string; nodeIds: string[]; start: Record<string, Point>; frameStart: Record<string, Frame>; origin: Point; moved: boolean; target: string | null }
  | { t: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { t: 'connect'; from: string; side: Side; target: string | null }
  | { t: 'marquee'; origin: Point; additive: boolean; base: string[] };

/** What the gesture in progress shows (state, so the drawing follows it). */
interface Overlay {
  /** dragged node ids, and where they started (frames fit those positions until the drop) */
  dragging?: { ids: Set<string>; pinned: Record<string, Point> };
  targetFrame?: string | null;
  connect?: { d: string; target: string | null };
  marquee?: { x: number; y: number; w: number; h: number };
}

const DEFS = <>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--edge)" /></marker>
  <marker id="arrowCrit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--crit)" /></marker>
  {(Object.keys(CONTAINER_COLORS) as ContainerColor[]).map(c => (
    <marker key={c} id={'arrow-' + c} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={paletteCss(c)!} /></marker>
  ))}
  <marker id="arrowSel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--sel)" /></marker>
  <marker id="crow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="10" markerHeight="10" orient="auto"><path d="M1 1L11 6L1 11M1 6H11" fill="none" stroke="var(--fk)" strokeWidth="1.3" /></marker>
  <filter id="lift" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.18" /></filter>
</>;

/** Rename requests from outside the canvas (Enter on a selected component). */
let renameRequest: ((id: string) => void) | null = null;
export const requestRename = (id: string) => renameRequest?.(id);

export function Canvas() {
  const doc = useSysDoc();
  const selection = useEditor(s => s.selection);
  const results = resultsOf(doc);
  const load = useLoadView(st => st.on);
  const [overlay, setOverlay] = useState<Overlay>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const doubleTap = useDoubleTap();
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; renameRequest = setRenaming; return () => { renameRequest = null; }; }, []);

  const frames = useMemo(() => computeFrames(doc, overlay.dragging?.pinned), [doc, overlay.dragging]);
  const framesNow = () => computeFrames(sysDoc(), overlay.dragging?.pinned);
  const selKey = () => { const s = editor().selection; return s ? s.type + ':' + s.ids[0] : ''; };

  // ---------- pointer gestures ----------
  const onPointerDown = (ev: React.PointerEvent<SVGSVGElement>) => {
    const target = ev.target as Element;
    const nodeEl = target.closest<SVGGElement>('[data-node]');
    const onControl = !!target.closest('[data-handle],[data-toggle]');
    if (doubleTap(nodeEl && !onControl ? nodeEl.dataset.node! : null, ev)) { setRenaming(nodeEl!.dataset.node!); return; }
    setRenaming(null);
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const additive = ev.shiftKey || ev.metaKey || ev.ctrlKey, w = toWorld(ev.clientX, ev.clientY), d = sysDoc();

    const toggle = target.closest<SVGGElement>('[data-toggle]');
    if (toggle) { toggleDetail(toggle.dataset.toggle!); return; }
    const handle = target.closest<SVGCircleElement>('[data-handle]');
    if (handle && nodeEl) {
      gesture.current = { t: 'connect', from: nodeEl.dataset.node!, side: handle.dataset.handle as Side, target: null };
      hint('Drop on a component to connect');
      return;
    }
    if (nodeEl) {
      const id = nodeEl.dataset.node!;
      if (additive) toggleSelected('node', id);
      else if (!isSelected(editor().selection, 'node', id)) selectOne('node', id);
      else makePrimary('node', id);
      const ids = selectedNodeIds();
      gesture.current = { t: 'node', ids, start: Object.fromEntries(ids.map(i => { const n = findNode(d, i)!; return [i, { x: n.x, y: n.y }]; })), origin: w, moved: false };
      holdPanel();
      return;
    }
    const edgeEl = target.closest<SVGGElement>('[data-edge]');
    if (edgeEl) { selectOne('edge', edgeEl.dataset.edge!); return; }
    const frameEl = target.closest<SVGGElement>('[data-container]');
    if (frameEl && !additive && !ev.altKey) {
      const id = frameEl.dataset.container!, fr = framesNow();
      selectOne('container', id); holdPanel();
      const inside = (cid: string | null | undefined) => ancestry(d, cid).includes(id);
      const nodeIds = d.nodes.filter(n => inside(n.container)).map(n => n.id);
      gesture.current = {
        t: 'frame', id, nodeIds, origin: w, moved: false, target: null,
        start: Object.fromEntries(nodeIds.map(i => { const n = findNode(d, i)!; return [i, { x: n.x, y: n.y }]; })),
        frameStart: Object.fromEntries(d.containers.filter(c => inside(c.id)).map(c => [c.id, { ...(d.frames[c.id] ?? fr[c.id]) }])),
      };
      return;
    }
    if (additive || ev.altKey) {
      const s = editor().selection;
      gesture.current = { t: 'marquee', origin: w, additive, base: additive && s?.type === 'node' ? [s.ids[0]] : [] };
      return;
    }
    const v = editor().view;
    gesture.current = { t: 'pan', sx: ev.clientX, sy: ev.clientY, vx: v.x, vy: v.y, moved: false };
  };

  const onPointerMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current; if (!g) return;
    const w = toWorld(ev.clientX, ev.clientY), k = editor().view.k;
    switch (g.t) {
      case 'node': {
        const dx = w.x - g.origin.x, dy = w.y - g.origin.y;
        if (!g.moved) {
          if (Math.hypot(dx, dy) * k <= 3) return;
          g.moved = true; history.begin();
        }
        edit(d => { for (const n of d.nodes) { const s = g.start[n.id]; if (s) { n.x = snap(s.x + dx); n.y = snap(s.y + dy); } } });
        // the frame under the pointer is where the nodes will land
        const d = sysDoc(), pinned = g.start, over = containerAt(d, computeFrames(d, pinned), w.x, w.y);
        setOverlay({ dragging: { ids: new Set(g.ids), pinned }, targetFrame: over && !g.ids.some(id => (findNode(d, id)?.container ?? null) === over) ? over : null });
        break;
      }
      case 'frame': {
        const dx = w.x - g.origin.x, dy = w.y - g.origin.y;
        if (!g.moved) {
          if (Math.hypot(dx, dy) * k <= 3) return;
          g.moved = true; history.begin();
        }
        edit(d => {
          for (const n of d.nodes) { const s = g.start[n.id]; if (s) { n.x = snap(s.x + dx); n.y = snap(s.y + dy); } }
          // empty environments keep a stored frame; move those too
          for (const cid in g.frameStart) { const f = g.frameStart[cid]; d.frames[cid] = { ...f, x: snap(f.x + dx), y: snap(f.y + dy) }; }
        });
        const d = sysDoc(), over = containerAt(d, computeFrames(d), w.x, w.y, g.id);
        const parent = d.containers.find(c => c.id === g.id)?.parent ?? null;
        g.target = over !== parent ? over : null;
        setOverlay({ targetFrame: g.target });
        break;
      }
      case 'pan':
        if (Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) > 3) g.moved = true;
        useEditor.setState(s => ({ view: { ...s.view, x: g.vx + ev.clientX - g.sx, y: g.vy + ev.clientY - g.sy } }));
        break;
      case 'connect': {
        const d = sysDoc(), a = findNode(d, g.from); if (!a) { gesture.current = null; return; }
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<SVGGElement>('[data-node]');
        g.target = over && over.dataset.node !== a.id ? over.dataset.node! : null;
        const b = findNode(d, g.target);
        let q: Point = w, s2 = opposite(g.side);
        if (b) { s2 = routeSides(d, a, b)[1]; q = port(d, b, s2); }
        setOverlay({ connect: { d: pathBetween(port(d, a, g.side), q, g.side, s2), target: g.target } });
        break;
      }
      case 'marquee': {
        const x = Math.min(g.origin.x, w.x), y = Math.min(g.origin.y, w.y), mw = Math.abs(w.x - g.origin.x), mh = Math.abs(w.y - g.origin.y);
        const d = sysDoc();
        const hits = d.nodes.filter(n => n.x < x + mw && n.x + nodeW(d, n) > x && n.y < y + mh && n.y + nodeH(d, n) > y).map(n => n.id);
        select({ type: 'node', ids: [...new Set([...g.base, ...hits])] });
        setOverlay({ marquee: { x, y, w: mw, h: mh } });
        break;
      }
    }
  };

  const onPointerUp = (ev: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current; gesture.current = null;
    if (!g) return;
    if (g.t === 'node' || g.t === 'frame') releasePanel(!g.moved, selKey());
    switch (g.t) {
      case 'pan': if (!g.moved) select(null); break;
      case 'node':
        if (g.moved) {
          // the new home is the frame under the pointer (frames still fitted to where the nodes started)
          const w = toWorld(ev.clientX, ev.clientY), d = sysDoc();
          const into = containerAt(d, computeFrames(d, g.start), w.x, w.y);
          edit(dd => { for (const n of dd.nodes) if (g.start[n.id] && (n.container ?? null) !== into) n.container = into; });
          history.end();
        }
        break;
      case 'frame':
        if (g.moved) {
          edit(d => {
            const c = d.containers.find(x => x.id === g.id); if (!c) return;
            if (g.target !== null) c.parent = g.target;
            else {
              const f = computeFrames(d)[g.id];
              const over = containerAt(d, computeFrames(d), f.x + f.w / 2, f.y + 8, g.id);
              if (over !== (c.parent ?? null)) c.parent = over;
            }
          });
          history.end();
        }
        break;
      case 'connect':
        hint(null);
        if (g.target) connect(g.from, g.target);
        break;
      case 'marquee': break;
    }
    setOverlay({});
  };

  const onPinchStart = () => {
    const g = gesture.current;
    if (g && (g.t === 'node' || g.t === 'frame') && g.moved) history.end();
    gesture.current = null; setOverlay({});
  };

  // ---------- drop a component or environment from the rail, or an image (a logo) from anywhere ----------
  useEffect(() => {
    const stage = svg.current?.parentElement; if (!stage) return;
    let lit: Element | null = null;
    const light = (el: Element | null) => { if (el === lit) return; lit?.classList.remove('logo-drop'); lit = el; lit?.classList.add('logo-drop'); };
    const nodeAt = (ev: DragEvent) => document.elementFromPoint(ev.clientX, ev.clientY)?.closest<SVGGElement>('[data-node]') ?? null;
    const files = (ev: DragEvent) => !!ev.dataTransfer?.types.includes('Files');
    const over = (ev: DragEvent) => {
      ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
      stage.classList.add('dropping');
      light(files(ev) ? nodeAt(ev) : null);
    };
    const leave = () => { stage.classList.remove('dropping'); light(null); };
    const drop = (ev: DragEvent) => {
      ev.preventDefault(); leave();
      const w = toWorld(ev.clientX, ev.clientY), dt = ev.dataTransfer;
      const image = imageIn(dt);
      if (image) {
        const id = nodeAt(ev)?.dataset.node;
        if (id) void logoOnto([id], image); else void appFromLogo(image, w);
        return;
      }
      if (files(ev)) { hint('Drop an image to use it as a logo', 2200); return; }
      if (dt?.getData('text/container')) { addContainer('cloud', w.x - 130, w.y - 70); return; }
      const kind = dt?.getData('text/kind') as Kind | undefined;
      if (kind && TYPES[kind]) addNode(kind, w.x - typeDef(kind).w / 2, w.y - NODE_H / 2);
    };
    // paste an image: onto the selected components, or as a new Application where the pointer is
    const paste = (ev: ClipboardEvent) => {
      if (ev.defaultPrevented || isTyping(ev.target) || isTyping(document.activeElement)) return;
      const image = imageIn(ev.clipboardData); if (!image) return;
      ev.preventDefault();
      const ids = selectedNodeIds();
      if (ids.length) void logoOnto(ids, image); else void appFromLogo(image, pointerWorld());
    };
    stage.addEventListener('dragover', over); stage.addEventListener('dragleave', leave); stage.addEventListener('drop', drop);
    document.addEventListener('paste', paste);
    return () => {
      stage.removeEventListener('dragover', over); stage.removeEventListener('dragleave', leave); stage.removeEventListener('drop', drop);
      document.removeEventListener('paste', paste);
    };
  }, []);

  // ---------- drawing ----------
  const ordered = useMemo(() => [...doc.containers].sort((a, b) => ancestry(doc, a.id).length - ancestry(doc, b.id).length), [doc]);
  const primary = selection?.type === 'node' ? selection.ids[0] : null;
  // the primary selected node is drawn last, so it sits on top
  const nodes = primary ? [...doc.nodes.filter(n => n.id !== primary), ...doc.nodes.filter(n => n.id === primary)] : doc.nodes;
  const animate = mounted.current;
  const edges = useMemo(() => edgeItems(doc), [doc]);
  const selectedEdge = selection?.type === 'edge' ? selection.ids[0] : null;
  const fks = useMemo(() => fkPaths(doc), [doc]);
  return (
    <>
      <Surface id="svg" worldId="world" gridId="grid" ref={svg} defs={DEFS}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPinchStart={onPinchStart}
        onDoubleClick={ev => { const id = (ev.target as Element).closest<SVGGElement>('[data-node]')?.dataset.node; if (id) setRenaming(id); }}>
        <g id="frames">
          {ordered.map(c => frames[c.id] && (
            <FrameView key={c.id} c={c} f={frames[c.id]} depth={ancestry(doc, c.id).length - 1}
              selected={isSelected(selection, 'container', c.id)} target={overlay.targetFrame === c.id} />
          ))}
        </g>
        <EdgeLines doc={doc} items={edges} selected={selectedEdge} animate={animate} load={load} />
        <g id="nodes">
          {nodes.map(n => (
            <NodeView key={n.id + ':' + n.kind} n={n} expanded={doc.detail?.[n.id] === 'expanded'} r={results.nodes[n.id]} load={load}
              selected={isSelected(selection, 'node', n.id)} dragging={!!overlay.dragging?.ids.has(n.id)}
              target={overlay.connect?.target === n.id} animate={animate} />
          ))}
        </g>
        <g id="fks">{fks.map((d, i) => <path key={i} className="fk" d={d} markerEnd="url(#crow)" />)}</g>
        <EdgeLabels doc={doc} items={edges} selected={selectedEdge} load={load} />
        <g id="overlay">
          {overlay.connect && <path d={overlay.connect.d} />}
          {overlay.marquee && <rect className="marquee" x={overlay.marquee.x} y={overlay.marquee.y} width={overlay.marquee.w} height={overlay.marquee.h} />}
        </g>
      </Surface>
      {renaming && <Rename id={renaming} stage={() => svg.current?.parentElement?.getBoundingClientRect()} close={() => setRenaming(null)} />}
      {!doc.nodes.length && !doc.containers.length && !doc.notes?.length && <div id="emptyState"><strong>Blank canvas</strong><span>Drag a component in from the left, or load the example.</span></div>}
    </>
  );
}

interface EdgeItem { e: Doc['edges'][number]; geo: EdgeGeometry }
function edgeItems(doc: Doc): EdgeItem[] {
  return doc.edges.flatMap(e => {
    const a = findNode(doc, e.from), b = findNode(doc, e.to);
    return a && b ? [{ e, geo: cachedEdgeGeometry(doc, a, b) }] : [];
  });
}

/** Connection curves (drawn under the nodes). */
function EdgeLines({ doc, items, selected, animate, load }: { doc: Doc; items: EdgeItem[]; selected: string | null; animate: boolean; load: boolean }) {
  const results = resultsOf(doc);
  return <g id="edges">{items.map(({ e, geo }) => (
    <EdgeLine key={e.id} id={e.id} geo={geo} selected={selected === e.id} crit={load && results.nodes[e.to]?.status === 'crit'} cross={!!results.crossings?.[e.id]} animate={animate}
      style={{ line: e.line, color: e.color, width: e.width, arrows: e.arrows }} />
  ))}</g>;
}

/**
 * Connection labels (over the nodes): the person's label, the endpoint called, the rps carried (load view) and,
 * when asked, the notes. Text someone wrote always shows; computed text is hidden where it would be cramped.
 */
function EdgeLabels({ doc, items, selected, load }: { doc: Doc; items: EdgeItem[]; selected: string | null; load: boolean }) {
  const results = resultsOf(doc);
  return <g id="labels">{items.map(({ e, geo }) => {
    const cross = results.crossings?.[e.id] || 0, isSel = selected === e.id;
    const label = e.label?.trim() || undefined, ep = endpointLabel(doc, e) || undefined;
    const lines: LabelLines = {
      label: label ?? ep,
      endpoint: label ? ep : undefined,
      rps: load ? `${fmtCalls(qty(e.calls))}× · ${fmt(results.edges[e.id] || 0)} rps` + (cross ? ` · +${cross}ms` : '') : undefined,
      notes: e.showNotes && hasNotes(e.notes) ? wrap(notePreview(e.notes, 400)) : undefined,
    };
    if (!lines.label && !lines.rps && !lines.notes) return null;
    const box = labelBox(lines);
    const written = !!label || !!lines.notes;
    // computed labels are decoration (the panel has the number): hide one that's cramped or would land on a node
    const hidden = !isSel && !written && (geo.len < box.w + 36 || overlapsNode(doc, { x: geo.mid.x - box.w / 2, y: geo.mid.y - box.h / 2, w: box.w, h: box.h }));
    return <EdgeLabel key={e.id} id={e.id} lines={lines} x={geo.mid.x} y={geo.mid.y} selected={isSel} hidden={hidden} colour={paletteCss(e.color)} />;
  })}</g>;
}

function endpointLabel(doc: Doc, e: Doc['edges'][number]): string {
  if (e.endpoint == null) return '';
  const ep = findNode(doc, e.to)?.endpoints?.[e.endpoint];
  return ep ? `${ep.method} ${ep.path}` : '';
}

/** Rename a component in place (double-click, or Enter). An empty name keeps the old one. */
function Rename({ id, stage: stageRect, close }: { id: string; stage: () => DOMRect | undefined; close: () => void }) {
  const doc = useSysDoc(), view = useEditor(s => s.view);
  const n = findNode(doc, id);
  const stage = stageRect();
  if (!n || !stage) return null;
  const s = toScreen(n.x + 12 + ICON + 9, n.y + 26);
  return (
    <InlineEdit id="renameBox" ariaLabel="Rename" value={n.name}
      style={{ left: s.x - stage.left, top: s.y - stage.top - 12, width: Math.max(120, (nodeW(doc, n) - 60) * view.k) }}
      onCommit={v => { if (v !== n.name) edit(d => { const x = findNode(d, id); if (x) x.name = v; }); close(); }}
      onCancel={close} />
  );
}
