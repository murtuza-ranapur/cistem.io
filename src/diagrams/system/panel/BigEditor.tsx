/** The same code editor, large, over everything (the panel is narrow). Esc or a click outside closes it. */
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from '@codemirror/view';
import { CodeEditor, loadCode } from '../../../editor/CodeEditor';
import { Icon } from '../../../ui/Icon';
import { useSysDoc } from '../state';
import { currentItem, getPath } from './paths';
import { setPanelUi, usePanelUi } from './ui';
import { mountBody } from './FieldEditor';
import { mountTables, tablesText } from './TablesEditor';

export function BigEditorOverlay() {
  const big = usePanelUi(s => s.big);
  const doc = useSysDoc();
  const view = useRef<EditorView | null>(null);
  const cur = currentItem(doc);
  if (!big || cur?.type !== 'node') return null;
  const n = cur.item;
  const close = () => setPanelUi({ big: null });
  const isField = big.t === 'field';
  return createPortal(
    <div className="cm-overlay" onMouseDown={e => e.target === e.currentTarget && close()}
      onKeyDown={e => { if (e.key === 'Escape' && !document.querySelector('.cm-tooltip-autocomplete')) { e.stopPropagation(); close(); } }}>
      <div className="cm-dialog" role="dialog" aria-label={isField ? big.label : 'Tables'}>
        <div className="cm-dhead">
          <strong>{n.name}</strong><span>{isField ? big.label : 'tables'}</span><span className="spacer" />
          {isField && <button type="button" className="small" data-fmt onClick={() => { const v = view.current; if (v) void loadCode().then(m => { m.formatJson(v); v.focus(); }); }}>Format</button>}
          <button type="button" className="icon" data-close aria-label="Close" title="Close (Esc)" onClick={close}><Icon name="ic-close" /></button>
        </div>
        {isField
          ? <CodeEditor className="cm-dbody" value={getPath(n, big.path) ?? ''} latest={null} mount={mountBody(big.kind, n.id, big.path, true)} onReady={v => { view.current = v; v.focus(); }} />
          : <CodeEditor className="cm-dbody" value={tablesText(doc, n)} latest={null} mount={mountTables(n.id, true)} onReady={v => { view.current = v; v.focus(); }} />}
        <div className="cm-dfoot">{isField ? 'Ctrl-Space suggestions · ⇧⌥F format · Esc close' : 'Ctrl-Space suggestions · paste CREATE TABLE SQL to convert · Esc close'}</div>
      </div>
    </div>,
    document.body,
  );
}
