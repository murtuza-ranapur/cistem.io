/**
 * Export the open diagram as JSON (or the whole project as a file), or import a diagram or project file:
 * pasted, or opened from disk. A diagram goes into the open project; a project file becomes a new project.
 */
import { useEffect, useRef, useState } from 'react';
import { useUi } from '../store/ui';
import { serialize, readFile } from '../store/files';
import { useTabs } from '../store/tabs';
import { exportProject, importFile } from '../store/projects';
import { isProjectFile, readProjectFile } from '../domain/project';

export function IoDialog() {
  const mode = useUi(s => s.ioOpen);
  if (!mode) return null;
  return <Dialog blank={mode === 'import'} />;
}

/** Why `text` can't be imported, or null when it can. */
function problem(parsed: unknown): string | null {
  try { if (isProjectFile(parsed)) readProjectFile(parsed); else readFile(parsed); return null; }
  catch (e) { return (e as Error).message; }
}

function Dialog({ blank }: { blank: boolean }) {
  const [text, setText] = useState(() => (blank ? '' : serialize()));
  const [msg, setMsg] = useState('');
  const project = useTabs(s => s.project);
  const area = useRef<HTMLTextAreaElement>(null), picker = useRef<HTMLInputElement>(null);
  const timer = useRef(0);
  const close = () => useUi.setState({ ioOpen: null });
  const say = (t: string) => { setMsg(t); clearTimeout(timer.current); timer.current = window.setTimeout(() => setMsg(''), 3500); };
  useEffect(() => { area.current?.focus(); return () => clearTimeout(timer.current); }, []);
  const canAdd = project?.scope !== 'view';

  const copy = () => {
    const json = serialize(); setText(json);
    const manual = () => { area.current?.select(); say('Select and copy manually'); };
    try { navigator.clipboard.writeText(json).then(() => say('Copied'), manual); } catch { manual(); }
  };
  const load = (raw: string) => {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { say('Not valid JSON'); return; }
    const why = problem(parsed); if (why) { say(why); return; }
    if (!isProjectFile(parsed) && !canAdd) { say('Make a copy of this shared project first'); return; }
    close();
    void importFile(parsed);
  };
  const open = async (f: File | undefined) => { if (!f) return; const t = await f.text(); setText(t); load(t); };
  return (
    <div id="io" className="modal" onClick={e => e.target === e.currentTarget && close()} onKeyDown={e => e.key === 'Escape' && close()}>
      <div className="io-card">
        <div className="io-head"><strong>Import / export</strong><button type="button" className="icon" id="ioClose" aria-label="Close" onClick={close}>×</button></div>
        <textarea id="json" ref={area} aria-label="Diagram JSON" spellCheck={false} value={text} onChange={e => setText(e.target.value)}
          placeholder="Paste a cistem.dev diagram or project (.json) and press Load. A diagram is added to the open project; a project file becomes a new project." />
        <div className="io-row">
          <button type="button" id="copyJson" onClick={copy}>Copy diagram</button>
          {project && project.scope !== 'view' && <button type="button" id="exportProject" onClick={() => { close(); void exportProject(project.id); }}>Download project</button>}
          <button type="button" id="openFile" onClick={() => picker.current?.click()}>Open file…</button>
          <input ref={picker} type="file" accept=".json,application/json" hidden onChange={e => void open(e.target.files?.[0])} />
          <button type="button" id="loadJson" className="primary" onClick={() => load(text)}>Load from text</button>
          <span className="muted" id="ioMsg">{msg}</span>
        </div>
      </div>
    </div>
  );
}
