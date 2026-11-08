/** The account's diagrams. Signed out, it explains where diagrams live and offers sign-in. */
import { useState } from 'react';
import { useUi } from '../store/ui';
import { useCloud, signIn, saveAsNew } from '../store/cloud';
import { useTabs } from '../store/tabs';
import { useDiagramList, closeDrawer, newDiagram, openDiagram, deleteDiagram } from '../store/account';
import { timeAgo } from '../lib/format';
import type { Summary } from '../lib/api';

export function Drawer() {
  const open = useUi(s => s.drawerOpen);
  const user = useCloud(s => s.user);
  if (!open) return null;
  return (
    <aside id="drawer" aria-label="Diagrams">
      <div className="dhead">
        <strong>Diagrams</strong><span className="spacer" />
        <button type="button" className="small primary" id="newDiagram" onClick={() => void newDiagram()}>+ New</button>
        <button type="button" className="icon" id="drawerClose" aria-label="Close" onClick={closeDrawer}>×</button>
      </div>
      <div id="drawerList">{user ? <DiagramList /> : <SignInPitch />}</div>
      {user && <div className="dfoot"><button type="button" className="small" id="saveAsNew" onClick={() => { void saveAsNew(); closeDrawer(); }}>Save current as new</button></div>}
    </aside>
  );
}

function SignInPitch() {
  return (
    <div className="dsignin">
      <p>Your diagrams are kept in this browser, one per tab.</p>
      <p>Sign in with GitHub to save them to your account, open them on other devices, share links and use them from Claude (MCP).</p>
      <button type="button" className="small primary" data-signin onClick={signIn}>Sign in with GitHub</button>
    </div>
  );
}

function DiagramList() {
  const { items, error } = useDiagramList();
  const current = useCloud(s => s.id);
  const openIds = new Set(useTabs(s => s.list).map(t => t.cloudId));
  if (error) return <p className="empty">Couldn't load diagrams: {error}</p>;
  if (!items) return null;
  if (!items.length) return <p className="empty">No diagrams yet. Save this one or start a new one.</p>;
  return <>{items.map(d => <DiagramItem key={d.id} d={d} on={d.id === current} open={openIds.has(d.id)} />)}</>;
}

function DiagramItem({ d, on, open }: { d: Summary; on: boolean; open: boolean }) {
  const [armed, setArmed] = useState(false);
  const remove = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (armed) { void deleteDiagram(d.id); return; }
    setArmed(true); setTimeout(() => setArmed(false), 2500);
  };
  return (
    <div className={'ditem' + (on ? ' on' : '')} data-open={d.id} onClick={() => void openDiagram(d.id)}>
      <div className="dtitle">{d.title}{d.shared && <> <span className="tag">shared</span></>}{open && !on && <> <span className="tag">open</span></>}</div>
      <div className="dmeta">{d.kind} · v{d.version} · {timeAgo(d.updatedAt)}</div>
      <button type="button" className={'x' + (armed ? ' armed' : '')} data-del={d.id} aria-label="Delete" onClick={remove}>{armed ? 'sure?' : '×'}</button>
    </div>
  );
}
