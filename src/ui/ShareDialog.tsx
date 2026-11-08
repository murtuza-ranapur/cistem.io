/** Share the open diagram, or a whole project, as a read-only link. */
import { useEffect, useState } from 'react';
import { useUi, toast } from '../store/ui';
import { api } from '../lib/api';
import { useCloud, shareUrl, toggleShare } from '../store/cloud';
import { useTabs } from '../store/tabs';
import { useProjectList, refreshProjects, projectShareLink, setProjectShared } from '../store/projects';
import { Modal } from './Dialogs';
import { KindIcon } from './projectActions';

export function ShareDialog() {
  const state = useUi(s => s.shareOpen);
  return state ? <Share projectId={state.projectId} /> : null;
}

const close = () => useUi.setState({ shareOpen: null });

function Share({ projectId }: { projectId?: string }) {
  const open = useTabs(s => s.project);
  const pid = projectId ?? (open?.scope === 'cloud' ? open.id : undefined);
  const [what, setWhat] = useState<'diagram' | 'project'>(projectId ? 'project' : 'diagram');
  useEffect(() => { void refreshProjects(); }, []);
  return (
    <Modal label="Share" onClose={close} id="shareDialog">
      <div className="dlg-body">
        <h2>Share</h2>
        <div className="seg" role="tablist" aria-label="What to share">
          <button type="button" role="tab" id="shareDiagramTab" aria-selected={what === 'diagram'} disabled={!!projectId} onClick={() => setWhat('diagram')}>This diagram</button>
          <button type="button" role="tab" id="shareProjectTab" aria-selected={what === 'project'} disabled={!pid} onClick={() => setWhat('project')}>Whole project</button>
        </div>
        {what === 'diagram' ? <DiagramShare /> : pid ? <ProjectShare id={pid} /> : null}
        <div className="dlg-actions"><button type="button" id="shareDone" onClick={close}>Done</button></div>
      </div>
    </Modal>
  );
}

/** The link, a switch to turn it on or off, and Copy. */
function LinkControl({ name, load, set }: { name: string; load(): Promise<string | null>; set(on: boolean): Promise<string | null> }) {
  const [link, setLink] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; load().then(l => live && setLink(l), e => { toast((e as Error).message, 4000); setLink(null); }); return () => { live = false; }; }, [load]);
  const flip = async (on: boolean) => {
    setBusy(true);
    try { const l = await set(on); setLink(l); if (l) await copy(l); }
    catch (e) { toast((e as Error).message, 4000); }
    finally { setBusy(false); }
  };
  return (
    <>
      <label className="dlg-switch">
        <span>Anyone with the link can <b>view</b> {name}</span>
        <input type="checkbox" role="switch" id="shareSwitch" checked={!!link} disabled={busy || link === undefined} onChange={e => void flip(e.target.checked)} />
      </label>
      {link && (
        <div className="dlg-link">
          <input type="text" readOnly aria-label="Share link" id="shareLink" value={link} onFocus={e => e.currentTarget.select()} />
          <button type="button" className="primary" id="shareCopy" onClick={() => void copy(link)}>Copy link</button>
        </div>
      )}
    </>
  );
}
async function copy(link: string) {
  try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { /* the field shows it */ }
}

function DiagramShare() {
  const id = useCloud(s => s.id);
  const title = useTabs(s => s.list.find(t => t.key === s.active)?.title ?? 'this diagram');
  const load = useState(() => async () => { const d = await api.get(id!); return d.shareToken ? shareUrl(d.shareToken) : null; })[0];
  const set = useState(() => async (on: boolean) => { const now = await load(); return !!now === on ? now : toggleShare(); })[0];
  if (!id) return <p className="muted">Only diagrams in your account can be shared.</p>;
  return (
    <>
      <LinkControl name={`“${title}”`} load={load} set={set} />
      <p className="muted">Read-only. People with the link see this diagram as it is now and as you change it.</p>
    </>
  );
}

function ProjectShare({ id }: { id: string }) {
  const p = useProjectList(s => s.items?.find(x => x.id === id));
  const load = useState(() => () => projectShareLink(id))[0];
  const set = useState(() => (on: boolean) => setProjectShared(id, on))[0];
  return (
    <>
      <LinkControl name={p ? `“${p.title}”` : 'this project'} load={load} set={set} />
      {p && (
        <>
          <div className="dlg-sub">Included · {p.diagrams.length} diagram{p.diagrams.length === 1 ? '' : 's'}</div>
          <ul className="dlg-list">{p.diagrams.map(d => <li key={d.id}><KindIcon kind={d.kind} />{d.title}</li>)}</ul>
        </>
      )}
      <p className="muted">Read-only. Diagrams you add later are included; ones you move out stop being visible. Turning it off ends the link straight away.</p>
    </>
  );
}
