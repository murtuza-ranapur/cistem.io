/** The middle of the window: the open diagram's canvas, with zoom controls and hints over it. */
import { useEffect, useRef } from 'react';
import { useEditor } from '../store/editor';
import { zoomBy } from '../store/viewport';
import { diagram } from '../diagrams';
import { Hint } from './Banners';
import { ContextMenu } from './ContextMenu';

export function Stage() {
  const kind = useEditor(s => s.open.kind);
  const k = useEditor(s => s.view.k);
  const Canvas = diagram(kind).Canvas;
  const ref = useRef<HTMLElement>(null);
  // the stage never scrolls: focusing an inline editor near its edge would otherwise shift every drawing sideways
  useEffect(() => {
    const el = ref.current!;
    const reset = () => { if (el.scrollLeft || el.scrollTop) { el.scrollLeft = 0; el.scrollTop = 0; } };
    el.addEventListener('scroll', reset);
    return () => el.removeEventListener('scroll', reset);
  }, []);
  return (
    <main id="stage" ref={ref}>
      <Canvas key={kind} />
      <Hint />
      <div className="zoom">
        <button type="button" id="zin" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>+</button>
        <span id="zoomPct">{Math.round(k * 100)}%</span>
        <button type="button" id="zout" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>−</button>
      </div>
      <ContextMenu />
    </main>
  );
}
