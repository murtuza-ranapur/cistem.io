/** Export the open diagram as JSON, or import one (opened in a new tab). */
import { useEffect, useRef, useState } from 'react';
import { useUi } from '../store/ui';
import { serialize, readFile } from '../store/files';
import { newTab } from '../store/tabs';

export function IoDialog() {
  const mode = useUi(s => s.ioOpen);
  if (!mode) return null;
  return <Dialog blank={mode === 'import'} />;
}

function Dialog({ blank }: { blank: boolean }) {
  const [text, setText] = useState(() => (blank ? '' : serialize()));
  const [msg, setMsg] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef(0);
  const close = () => useUi.setState({ ioOpen: null });
  const say = (t: string) => { setMsg(t); clearTimeout(timer.current); timer.current = window.setTimeout(() => setMsg(''), 3500); };
  useEffect(() => { area.current?.focus(); return () => clearTimeout(timer.current); }, []);

  const copy = () => {
    const json = serialize(); setText(json);
    const manual = () => { area.current?.select(); say('Select and copy manually'); };
    try { navigator.clipboard.writeText(json).then(() => say('Copied'), manual); } catch { manual(); }
  };
  const load = () => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); readFile(parsed); }
    catch (e) { say(e instanceof SyntaxError ? 'Not valid JSON' : (e as Error).message); return; }
    close();
    void newTab('system', parsed);
  };
  return (
    <div id="io" className="modal" onClick={e => e.target === e.currentTarget && close()} onKeyDown={e => e.key === 'Escape' && close()}>
      <div className="io-card">
        <div className="io-head"><strong>Diagram JSON</strong><button type="button" className="icon" id="ioClose" aria-label="Close" onClick={close}>×</button></div>
        <textarea id="json" ref={area} aria-label="Diagram JSON" spellCheck={false} value={text} onChange={e => setText(e.target.value)}
          placeholder="Paste a cistem.io diagram (.json) and press Load" />
        <div className="io-row">
          <button type="button" id="copyJson" onClick={copy}>Copy</button>
          <button type="button" id="loadJson" className="primary" onClick={load}>Load from text</button>
          <span className="muted" id="ioMsg">{msg}</span>
        </div>
      </div>
    </div>
  );
}
