/**
 * Projects: every project with its diagrams. The open one is expanded; open another to switch to it.
 * Signed out, they're this browser's; signed in, the account's (and this browser's can be brought over).
 */
import { useEffect, useState } from 'react';
import { useUi } from '../store/ui';
import { useCloud, signIn } from '../store/cloud';
import { useTabs } from '../store/tabs';
import { useProjectList, closeDrawer, openProjectById, importBrowserProjects, dismissLeftovers } from '../store/projects';
import type { DiagramInfo, ProjectInfo } from '../store/backends';
import { timeAgo } from '../lib/format';
import { Icon } from './Icon';
import { openMenu } from './Menu';
import { askNewProject, diagramMenu, projectMenu, KindIcon } from './projectActions';

export function Drawer() {
  const open = useUi(s => s.drawerOpen);
  const user = useCloud(s => s.user);
  if (!open) return null;
  return (
    <aside id="drawer" aria-label="Projects">
      <div className="dhead">
        <strong>Projects</strong><span className="spacer" />
        <button type="button" className="small primary" id="newProject" onClick={() => void askNewProject()}>+ New project</button>
        <button type="button" className="icon" id="drawerClose" aria-label="Close" onClick={closeDrawer}>×</button>
      </div>
      <Leftovers />
      <div id="drawerList"><ProjectList /></div>
      <div className="dfoot">
        {user
          ? <span className="muted">Saved to your account.</span>
          : <>
              <p className="muted">Kept in this browser. Sign in to save to your account, share links and use them from Claude.</p>
              <button type="button" className="small primary" data-signin onClick={signIn}>Sign in with GitHub</button>
            </>}
        <button type="button" className="small" id="importBtn" onClick={() => { closeDrawer(); useUi.setState({ ioOpen: 'import' }); }}>Import…</button>
      </div>
    </aside>
  );
}

/** Signed in with diagrams still in this browser: offer to bring them over. */
function Leftovers() {
  const n = useProjectList(s => s.leftovers);
  const [busy, setBusy] = useState(false);
  if (!n) return null;
  return (
    <div className="leftovers" id="leftovers">
      <p>{n} diagram{n === 1 ? ' is' : 's are'} only in this browser.</p>
      <div>
        <button type="button" className="small primary" id="importLocal" disabled={busy} onClick={() => { setBusy(true); void importBrowserProjects().finally(() => setBusy(false)); }}>Add to my account</button>
        <button type="button" className="small" onClick={dismissLeftovers}>Not now</button>
      </div>
    </div>
  );
}

function ProjectList() {
  const { items, error } = useProjectList();
  const openId = useTabs(s => s.project?.id);
  if (error) return <p className="empty">Couldn’t load projects: {error}</p>;
  if (!items) return null;
  return <>{items.map(p => <ProjectRow key={p.id} p={p} isOpen={p.id === openId} />)}</>;
}

function ProjectRow({ p, isOpen }: { p: ProjectInfo; isOpen: boolean }) {
  const [expanded, setExpanded] = useState(isOpen);
  useEffect(() => { if (isOpen) setExpanded(true); }, [isOpen]);
  return (
    <section className={'prow' + (isOpen ? ' on' : '')} data-project={p.id}>
      <div className="phead">
        <button type="button" className="ptoggle" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
          <svg className={'caret' + (expanded ? ' open' : '')} viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg>
          <Icon name="ic-folder" className="pfolder" />
          <span className="ptitle">{p.title}</span>
          {p.shared && <span className="tag">shared</span>}
          <span className="pcount">{p.diagrams.length}</span>
        </button>
        {!isOpen && <button type="button" className="small" data-open-project={p.id} onClick={() => void openProjectById(p.id)}>Open</button>}
        <button type="button" className="icon pmore" aria-label={`${p.title} menu`} data-project-menu={p.id} onClick={e => openMenu(e.currentTarget, p.title, projectMenu(p))}>⋯</button>
      </div>
      {expanded && (
        <div className="plist">
          {p.diagrams.map(d => <DiagramRow key={d.id} d={d} p={p} />)}
          {!p.diagrams.length && <p className="empty">No diagrams yet.</p>}
        </div>
      )}
    </section>
  );
}

function DiagramRow({ d, p }: { d: DiagramInfo; p: ProjectInfo }) {
  const active = useTabs(s => s.project?.id === p.id && s.active === d.id);
  const open = useTabs(s => s.project?.id === p.id && s.list.some(t => t.key === d.id));
  const menu = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); openMenu({ x: e.clientX, y: e.clientY }, d.title, diagramMenu(d, p)); };
  return (
    <div className={'ditem' + (active ? ' on' : '')} data-open={d.id} role="button" tabIndex={0}
      onClick={() => void openProjectById(p.id, d.id)} onKeyDown={e => e.key === 'Enter' && void openProjectById(p.id, d.id)} onContextMenu={menu}>
      <KindIcon kind={d.kind} />
      <div className="dtext">
        <div className="dtitle">{d.title}{d.shared && <> <span className="tag">shared</span></>}{open && !active && <> <span className="tag">open</span></>}</div>
        <div className="dmeta">{d.updatedAt ? timeAgo(d.updatedAt) : ''}</div>
      </div>
      <button type="button" className="x" aria-label={`${d.title} menu`} data-diagram-menu={d.id} onClick={e => { e.stopPropagation(); openMenu(e.currentTarget, d.title, diagramMenu(d, p)); }}>⋯</button>
    </div>
  );
}
