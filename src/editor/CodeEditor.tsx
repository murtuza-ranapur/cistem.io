/**
 * A CodeMirror editor inside React. CodeMirror (and the languages in ./code) load on first use.
 *
 * `mount` creates the editor from the lazily loaded module; it should read callbacks through `latest`
 * so they always see the newest props. When `value` changes from outside (undo, another view) and the
 * editor isn't focused, its text follows.
 */
import { useEffect, useRef } from 'react';
import type { EditorView } from '@codemirror/view';

export type CodeModule = typeof import('./code');
let loading: Promise<CodeModule> | null = null;
export const loadCode = () => (loading ??= import('./code'));

interface Props<L> {
  value: string;
  /** Callbacks and data the editor reads; kept current without re-creating the editor. */
  latest: L;
  mount: (code: CodeModule, host: HTMLElement, value: string, latest: { current: L }) => EditorView;
  className?: string;
  onReady?: (view: EditorView) => void;
}

export function CodeEditor<L>({ value, latest, mount, className = 'cm-host', onReady }: Props<L>) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const live = useRef(latest);
  live.current = latest;

  useEffect(() => {
    let gone = false;
    void loadCode().then(code => {
      if (gone || !host.current) return;
      view.current = mount(code, host.current, value, live);
      onReady?.(view.current);
    });
    return () => { gone = true; view.current?.destroy(); view.current = null; };
    // the editor is created once; `value` changes are applied below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v || v.hasFocus) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  return <div className={className} ref={host} />;
}
