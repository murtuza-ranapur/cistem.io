/** The top bar: title, save status, verdict and the toolbar. */
import { useEffect, useRef, useState } from 'react';
import { useEditor, changeMeta, undo, redo } from '../store/editor';
import { useHistory } from '../store/history';
import * as history from '../store/history';
import { useCloud, saveNow, signIn, signOut, toggleShare, type SyncStatus } from '../store/cloud';
import { useUi, togglePanel, toast } from '../store/ui';
import { openDrawer } from '../store/account';
import { fitView, organise } from '../store/commands';
import { diagram } from '../diagrams';
import { IconButton } from './Icon';
import { useDismiss } from './hooks';
import { openExample } from './actions';

export function Header() {
  const kind = useEditor(s => s.open.kind);
  const m = diagram(kind);
  const { canUndo, canRedo } = useHistory();
  const panelOpen = useUi(s => s.panelOpen);
  return (
    <header id="top">
      <IconButton id="drawerBtn" icon="ic-menu" label="Diagrams" onClick={openDrawer} />
      <div className="brand"><span className="logo" />cistem<span className="tld">.io</span></div>
      <TitleInput />
      {m.HeaderInfo && <m.HeaderInfo />}
      <SyncButton />
      <VerdictBadge />
      <div className="actions">
        <IconButton id="undoBtn" icon="ic-undo" label="Undo" title="Undo (⌘Z)" onClick={undo} disabled={!canUndo} />
        <IconButton id="redoBtn" icon="ic-redo" label="Redo" title="Redo (⌘⇧Z)" onClick={redo} disabled={!canRedo} />
        <span className="sep" />
        <IconButton id="layoutBtn" icon="ic-organise" label="Auto-organise" title="Auto-organise (O)" onClick={organise} />
        <IconButton id="zfit" icon="ic-fit" label="Fit to view" title="Fit to view (⌘0)" onClick={() => fitView()} />
        <IconButton id="panelBtn" icon="ic-panel" label="Toggle details panel" title="Details panel (I)" onClick={togglePanel} className={panelOpen ? 'on' : ''} />
        {m.Tools && <m.Tools />}
        <span className="sep" />
        <ShareButton />
        <IconButton id="ioBtn" icon="ic-save" label="Export or import" title="Export / import JSON" onClick={() => useUi.setState({ ioOpen: 'export' })} />
        <span className="sep" />
        <Account />
        <IconButton id="resetBtn" icon="ic-example" label="Open example" title="Open the example (as a new diagram)" onClick={openExample} />
      </div>
    </header>
  );
}

/** The diagram's title: typing is one undo step; Escape puts the old title back; it can't be left blank. */
function TitleInput() {
  const title = useEditor(s => s.meta.title);
  const kind = useEditor(s => s.open.kind);
  const readonly = useCloud(s => s.status === 'readonly');
  const [draft, setDraft] = useState<{ value: string; before: string } | null>(null);
  const untitled = diagram(kind).untitled;
  useEffect(() => { document.title = `${title} · cistem.io`; }, [title]);
  const set = (t: string) => changeMeta(m => { m.title = t.trim() || untitled; });
  return (
    <input id="title" className="title" type="text" aria-label="Diagram title" placeholder={untitled} readOnly={readonly}
      value={draft?.value ?? title}
      onFocus={() => { history.begin(); setDraft({ value: title, before: title }); }}
      onChange={e => { setDraft(d => d && { ...d, value: e.target.value }); set(e.target.value); }}
      onKeyDown={e => {
        if (e.key === 'Escape' && draft) { set(draft.before); setDraft(d => d && { ...d, value: d.before }); }
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
      }}
      onBlur={() => { setDraft(null); history.end(); }}
    />
  );
}

const SYNC_TEXT: Record<SyncStatus, (signedIn: boolean) => [string, string]> = {
  local: u => (u ? ['save', 'Save this diagram to your account'] : ['not saved', 'Kept in this browser only. Sign in to save.']),
  saved: () => ['saved', 'All changes saved'],
  saving: () => ['saving…', 'Saving…'],
  dirty: () => ['unsaved', 'Changes pending'],
  conflict: () => ['conflict', 'Changed elsewhere'],
  error: () => ['retry save', 'Save failed. Click to retry.'],
  readonly: () => ['read-only', 'Shared link: you are viewing a copy'],
};
function SyncButton() {
  const { status, detail, user } = useCloud();
  const [text, tip] = SYNC_TEXT[status](!!user);
  const canSave = status === 'local' || status === 'dirty' || status === 'error';
  return (
    <button type="button" className={'sync ' + status} id="sync" title={detail || tip} onClick={() => canSave && void saveNow()}>
      <span className="sdot" /><span id="syncText">{text}</span>
    </button>
  );
}

function VerdictBadge() {
  const open = useEditor(s => s.open);
  const v = diagram(open.kind).verdict(open.doc as never);
  return (
    <div className={'verdict ' + v.status} id="verdictWrap">
      <span className="dot" /><span id="verdict">{v.text}</span><span id="lat" className="lat">{v.detail ?? ''}</span>
    </div>
  );
}

function ShareButton() {
  const share = async () => {
    const c = useCloud.getState();
    if (!c.user) { signIn(); return; }
    if (!c.id) { await saveNow(); if (!useCloud.getState().id) return; }
    try {
      const url = await toggleShare();
      if (!url) { toast('Share link removed'); return; }
      try { await navigator.clipboard.writeText(url); toast('Share link copied'); } catch { prompt('Share link', url); }
    } catch (e) { toast((e as Error).message, 4000); }
  };
  return <IconButton id="shareBtn" icon="ic-share" label="Share" title="Share link" onClick={() => void share()} />;
}

function Account() {
  const user = useCloud(s => s.user);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null), btnRef = useRef<HTMLButtonElement>(null);
  useDismiss(menuRef, menu, () => setMenu(false), btnRef);
  if (!user) {
    return (
      <button type="button" id="signInBtn" className="signin" aria-label="Sign in with GitHub" onClick={signIn}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={GITHUB} /></svg>
        <span>Sign in<span className="long"> with GitHub</span></span>
      </button>
    );
  }
  return (
    <>
      <button type="button" ref={btnRef} id="accountBtn" className="account" aria-label="Account" onClick={() => setMenu(v => !v)}>
        <img id="avatar" alt="" width={24} height={24} src={user.avatarUrl || ''} /><span id="login">{user.login}</span>
      </button>
      {menu && (
        <div id="accountMenu" className="menu" ref={menuRef}>
          <div className="menu-head" id="accountName">{user.name || user.login}</div>
          <button type="button" id="signOutBtn" className="menu-item" onClick={() => { setMenu(false); void signOut(); }}>Sign out</button>
        </div>
      )}
    </>
  );
}

const GITHUB = 'M12 2C6.5 2 2 6.6 2 12.3c0 4.5 2.9 8.4 6.8 9.7.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5.1 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 4-2.4 4.8-4.6 5.1.4.3.7 1 .7 1.9v2.8c0 .3.2.6.7.5A10.2 10.2 0 0 0 22 12.3C22 6.6 17.5 2 12 2z';
