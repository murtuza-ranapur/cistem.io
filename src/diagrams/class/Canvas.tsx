/** The class canvas: boxes and relations, the empty state, the relation picker, in-place editing, paste-to-import. */
import { useEffect, useMemo, useRef } from 'react';
import { boxSize, memberText, parseClsAny, CLS, type RelType } from '../../domain/cls';
import { useEditor, isSelected } from '../../store/editor';
import { fitView } from '../../store/commands';
import { hint } from '../../store/ui';
import { isTyping } from '../../lib/browser';
import { Surface } from '../../ui/Surface';
import { useDismiss, moveFocus } from '../../ui/hooks';
import { InlineEdit, useDoc } from '../shared';
import { ClassBoxView, ClassMarkers, Ghost, RelationView, relationGeometry } from './Boxes';
import { addClass, addRelation, editMember, importDoc, placeMissing, tryRename } from './actions';
import { findClass, rectOf, suggestedRelation } from './model';
import { useClsUi, type Editing } from './ui';
import { useGestures } from './useGestures';

export function Canvas() {
  const d = useDoc('class');
  const selection = useEditor(s => s.selection);
  const drawing = useClsUi(s => s.drawing);
  const g = useGestures();

  // classes without a position (from a file) get one; when nothing had one, frame the result
  useEffect(() => { if (placeMissing()) requestAnimationFrame(() => fitView(false)); }, [d]);
  usePasteToImport();

  const rects = useMemo(() => Object.fromEntries(d.classes.map(c => [c.name, rectOf(d, c)])), [d]);
  const names = useMemo(() => d.classes.map(c => c.name).join('\n'), [d.classes]);
  const lines = useMemo(() => relationGeometry(d.relations, rects), [d.relations, rects]);

  return (
    <>
      <Surface id="clsSvg" worldId="clsWorld" label="Class diagram" defs={<ClassMarkers />}
        onPointerDown={g.onPointerDown} onPointerMove={g.onPointerMove} onPointerUp={g.onPointerUp} onDoubleClick={g.onDoubleClick}>
        {lines.map(l => <RelationView key={l.r.id} {...l} on={isSelected(selection, 'rel', l.r.id)} />)}
        {d.classes.map(c => { const p = d.pos[c.name] ?? { x: 0, y: 0 }; return <ClassBoxView key={c.name} c={c} x={p.x} y={p.y} on={isSelected(selection, 'class', c.name)} names={names} />; })}
        {drawing && rects[drawing.from] && <Ghost from={rects[drawing.from]} to={drawing.over && rects[drawing.over] ? rects[drawing.over] : drawing} />}
      </Surface>
      {!d.classes.length && (
        <div id="clsEmpty">
          <strong>Empty class diagram</strong>
          <span>Add classes from the left, or paste Java, Kotlin or a Mermaid classDiagram anywhere here.<br />Drag the dot on a box's edge onto another class to relate them.</span>
          <button type="button" className="small primary" id="clsStart" onClick={() => addClass('class')}>Add a class</button>
        </div>
      )}
      <Editor />
      <RelationPicker />
    </>
  );
}

/** Java, Kotlin, Mermaid or class text pasted anywhere (outside a field) is read into the diagram. */
function usePasteToImport() {
  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      if (isTyping(ev.target) || isTyping(document.activeElement)) return;
      const text = ev.clipboardData?.getData('text/plain') ?? ''; if (!text.trim()) return;
      const p = parseClsAny(text);
      if (!p.doc.classes.length) { hint(p.errors[0]?.message ?? 'Nothing to read in what you pasted', 2400); return; }
      ev.preventDefault();
      importDoc(p.doc, p.from === 'code' ? 'code' : p.from === 'mermaid' ? 'Mermaid' : 'text');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);
}

/** The text box over a class name or member while it's edited in place. */
function Editor() {
  const editing = useClsUi(s => s.editing);
  const d = useDoc('class');
  const view = useEditor(s => s.view);
  if (!editing) return null;
  const c = findClass(d, editing.name); if (!c) return null;
  const r = rectOf(d, c), s = boxSize(c);
  const at = (x: number, y: number, w: number): React.CSSProperties => ({ left: x * view.k + view.x, top: y * view.k + view.y, width: Math.max(150, w * view.k) });
  const done = () => useClsUi.setState({ editing: null });
  const key = editKey(editing);
  if (editing.t === 'rename') {
    return <InlineEdit key={key} id="clsEdit" value={c.name} style={at(r.x + 8, r.y + (c.stereo || c.kind !== 'class' ? 20 : 8), r.w - 16)}
      onCommit={v => { done(); tryRename(c.name, v); }} onCancel={done} />;
  }
  const { kind, i } = editing, m = (kind === 'f' ? c.fields : c.methods)[i]; if (!m) return null;
  const y = r.y + s.headH + (kind === 'm' ? s.fieldsH : 0) + 2 + i * CLS.row;
  return <InlineEdit key={key} id="clsEdit" mono value={c.kind === 'enum' ? m.name : memberText(m)} style={at(r.x + 4, y, r.w - 8)}
    onCommit={v => { done(); editMember(c.name, kind, i, v); }} onCancel={done} />;
}
const editKey = (e: Editing) => (e.t === 'rename' ? 'r:' + e.name : `m:${e.name}:${e.kind}:${e.i}`);

const PICKS: { type: RelType; label: string; toMult?: string }[] = [
  { type: 'composition', label: 'has many ◆', toMult: '*' }, { type: 'aggregation', label: 'has ◇' }, { type: 'assoc', label: 'uses →' },
  { type: 'inherit', label: 'extends ▷' }, { type: 'implement', label: 'implements ⇢▷' }, { type: 'depend', label: 'depends ⇢' },
];

/** After a class's dot is dropped on another class: how do they relate? (the likely answer is focused) */
function RelationPicker() {
  const picker = useClsUi(s => s.picker);
  const d = useDoc('class');
  const ref = useRef<HTMLDivElement>(null);
  const close = () => useClsUi.setState({ picker: null });
  useDismiss(ref, !!picker, close);
  useEffect(() => { if (picker) ref.current?.querySelector<HTMLButtonElement>('.sug')?.focus(); }, [picker]);
  if (!picker) return null;
  const sug = suggestedRelation(d, picker.from, picker.to);
  return (
    <div id="clsRelPick" className="cl-pick" role="menu" aria-label="Relation" ref={ref} style={{ left: picker.left, top: picker.top }}
      onKeyDown={ev => {
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') { ev.preventDefault(); moveFocus(ref.current!, '[data-pick]', ev.key === 'ArrowRight' ? 1 : -1); }
        ev.stopPropagation();
      }}>
      <div className="cl-pick-head">{picker.from} → {picker.to}</div>
      {PICKS.map((p, i) => (
        <button type="button" key={p.type} className={'chip' + (p.type === sug ? ' sug' : '')} data-pick={i}
          onClick={() => { close(); addRelation(picker.from, picker.to, p.type, p.toMult); }}>{p.label}</button>
      ))}
    </div>
  );
}
