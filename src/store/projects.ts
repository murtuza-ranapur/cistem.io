/**
 * Projects: the list (the drawer), opening one, and everything done to a project or to a diagram in one —
 * create, rename, move, share, export, import, delete. Every diagram is in exactly one project, and one
 * project is open at a time. Also what to show when the page opens.
 */
import { create } from 'zustand';
import { api } from '../lib/api';
import { download, fileName } from '../lib/browser';
import { toProjectFile, readProjectFile, inDependencyOrder, isProjectFile, relink, type ProjectEntry } from '../domain/project';
import type { AnyFile } from '../diagrams/types';
import { diagram } from '../diagrams';
import { useCloud, setStatus, signedIn, signOut, saveNow, whenSaved } from './cloud';
import { currentFile, readFile, stable } from './files';
import * as local from './local';
import { backendFor, type Added, type ProjectInfo } from './backends';
import { activeTab, closeTab, newTab, openProject, openTab, renameOpenProject, restoreProject, showView, startTabs, switchProject, tabOf, tabs, viewFiles, type Scope } from './tabs';
import { toast, useUi } from './ui';

/** The drawer's list: null while loading, or the error that stopped it. */
export const useProjectList = create(() => ({ items: null as ProjectInfo[] | null, error: '', leftovers: 0 }));

/** Where the open project lives (a shared view: wherever your own projects are). Projects are listed and changed there. */
const here = (): 'local' | 'cloud' => { const p = openProject(); return p && p.scope !== 'view' ? p.scope : signedIn() ? 'cloud' : 'local'; };
const store = () => backendFor(here());
let leftoversDismissed = false;

export async function refreshProjects(scope = here()): Promise<ProjectInfo[] | null> {
  try {
    const items = await backendFor(scope).list();
    useProjectList.setState({ items, error: '', leftovers: scope === 'cloud' && !leftoversDismissed ? browserLeftovers().length : 0 });
    return items;
  } catch (e) { useProjectList.setState({ error: (e as Error).message }); return null; }
}
whenSaved(() => { if (useUi.getState().drawerOpen) void refreshProjects(); });

export function openDrawer() { useUi.setState({ drawerOpen: true }); void refreshProjects(); }
export const closeDrawer = () => useUi.setState({ drawerOpen: false });

const asOpen = (p: ProjectInfo, scope: Scope) => ({ scope, id: p.id, title: p.title });
async function find(id: string) { return (await refreshProjects())?.find(p => p.id === id); }

/** Open a project (its tabs from last time come back), optionally with one of its diagrams in front. */
export async function openProjectById(id: string, focus?: string) {
  closeDrawer();
  const p = await find(id); if (!p) return;
  if (openProject()?.id === id && openProject()?.scope === here()) {
    if (focus) { const d = p.diagrams.find(x => x.id === focus); if (d) await openTab(tabOf(d, here())); }
    return;
  }
  await switchProject(asOpen(p, here()), p.diagrams, focus);
}

export async function createProject(title: string) {
  closeDrawer();
  const b = store();
  try {
    const id = await b.create(title);
    await switchProject({ scope: b.scope, id, title }, []);   // an empty project opens with a blank diagram
    void refreshProjects();
  } catch (e) { toast((e as Error).message, 4000); }
}

export async function renameProject(id: string, title: string) {
  try { await store().rename(id, title); renameOpenProject(id, title); await refreshProjects(); }
  catch (e) { toast((e as Error).message, 4000); }
}

/** Delete a project and all its diagrams. If it was open, the most recent other project opens. */
export async function deleteProject(id: string) {
  const b = store();
  try {
    await b.remove(id);
    const list = await refreshProjects() ?? [];
    if (openProject()?.id === id) { const next = list[0]; if (next) await switchProject(asOpen(next, b.scope), next.diagrams); }
  } catch (e) { toast((e as Error).message, 4000); }
}

/** Move a diagram to another project (it closes here if it was open). */
export async function moveDiagram(diagramId: string, projectId: string) {
  try {
    await saveNow();
    await store().move(diagramId, projectId);
    if (openProject()?.id !== projectId) await closeTab(diagramId, true);
    const to = (await refreshProjects())?.find(p => p.id === projectId);
    toast(`Moved to ${to?.title ?? 'the project'}`);
  } catch (e) { toast((e as Error).message, 4000); }
}

export async function deleteDiagram(id: string) {
  try {
    await store().removeDiagram(id);
    await closeTab(id, true);
    await refreshProjects();
  } catch (e) { setStatus('error', (e as Error).message); }
}

// ---------- export / import ----------

/** The project's diagrams as entries for a project file (the open one as it is on screen). */
async function entriesOf(p: ProjectInfo): Promise<ProjectEntry[]> {
  await saveNow();
  const b = store();
  return Promise.all(p.diagrams.map(async d => ({ id: d.id, file: d.id === activeTab()?.key ? currentFile() : await b.file(d.id) })));
}

export async function exportProject(id: string) {
  const p = await find(id); if (!p) return;
  try { download(fileName(p.title, '.cistem.json'), JSON.stringify(toProjectFile(p.title, await entriesOf(p)), null, 2)); }
  catch (e) { toast((e as Error).message, 4000); }
}

/**
 * Make a new project from a project file's diagrams, in the account (signed in) or this browser. Links between
 * its diagrams point at the new copies. Returns the new project's id.
 */
async function copyIn(title: string, input: unknown, scope: 'local' | 'cloud' = here()): Promise<string> {
  const { diagrams } = readProjectFile(input);
  const b = backendFor(scope);
  const pid = await b.create(title);
  const made = new Map<string, Added>();
  for (const d of inDependencyOrder(diagrams)) {
    const file = relink(d.file, old => { const a = made.get(old); return a && (a.cloudId ? { id: a.cloudId } : { tab: a.key }); });
    const { open, meta } = readFile(file);
    made.set(d.id, await b.addDiagram(pid, diagram(open.kind).toFile(open.doc as never, meta)));
  }
  return pid;
}

/** Import a project file (or a single diagram file, into the open project). */
export async function importFile(input: unknown) {
  if (!isProjectFile(input)) { await newTab('system', input); return; }
  try {
    const { title } = readProjectFile(input);
    const id = await copyIn(title, input);
    await openProjectById(id);
    toast(`Imported “${title}”`);
  } catch (e) { toast((e as Error).message, 5000); }
}

// ---------- sharing ----------

export const projectShareUrl = (token: string) => `${location.origin}/?p=${token}`;
/** Turn a project's share link on (returns it) or off (returns null). */
export async function setProjectShared(id: string, on: boolean): Promise<string | null> {
  if (!on) { await api.unshareProject(id); void refreshProjects(); return null; }
  const p = await api.shareProject(id); void refreshProjects();
  return projectShareUrl(p.shareToken!);
}
/** The project's current link, if it's shared (sharing again only rotates it, so this asks the server). */
export async function projectShareLink(id: string): Promise<string | null> {
  const p = (await api.projects()).find(x => x.id === id);
  return p?.shareToken ? projectShareUrl(p.shareToken) : null;
}

/** Open a shared project link, read-only. */
export async function openSharedProject(token: string): Promise<boolean> {
  try {
    const s = await api.sharedProject(token);
    await showView(s.title, s.diagrams.map(d => ({ id: d.id, title: d.title, kind: diagramKind(d.kind), updatedAt: d.updatedAt, file: d.document })));
    return true;
  } catch { toast('That share link no longer works', 4000); return false; }
}
/** Open a shared diagram link, read-only. */
export async function openSharedDiagram(token: string): Promise<boolean> {
  try {
    const d = await api.shared(token);
    await showView(d.title, [{ id: d.id, title: d.title, kind: diagramKind(d.kind), updatedAt: d.updatedAt, file: d.document }]);
    return true;
  } catch { toast('That share link no longer works', 4000); return false; }
}
const diagramKind = (k: string) => (k === 'sequence' || k === 'class' ? k : 'system');

/** Copy what a shared link shows into a new project of your own, and open it. */
export async function copyView() {
  const title = openProject()?.title ?? 'Shared project';
  try {
    const id = await copyIn(title, toProjectFile(title, viewFiles().map(([id, file]) => ({ id, file }))));
    await openProjectById(id);
    toast(signedIn() ? 'Copied to your account' : 'Copied into this browser');
  } catch (e) { toast((e as Error).message, 5000); }
}

// ---------- this browser's projects, after signing in ----------

/** The browser's diagrams worth offering to the account (not the untouched first-visit example). */
function browserLeftovers(): [string, local.LocalDoc][] {
  const ex = local.getState<{ key: string; sig: string }>('example');
  return local.localProjects().flatMap(p => local.docsOf(p.id)).filter(([key, d]) => !(ex && key === ex.key && sig(d.file) === ex.sig));
}
const sig = (f: AnyFile) => stable({ ...f, meta: { ...f.meta, updated: '' } });

/** Copy this browser's projects into the account, then remove them from the browser. */
export async function importBrowserProjects() {
  const keep = new Set(browserLeftovers().map(([k]) => k));
  const taken = new Set((useProjectList.getState().items ?? []).map(p => p.title));
  let count = 0, last = '';
  try {
    for (const p of local.localProjects()) {
      const entries = local.docsOf(p.id).filter(([k]) => keep.has(k)).map(([id, d]) => ({ id, file: d.file }));
      if (entries.length) {
        const title = taken.has(p.title) ? `${p.title} (from this browser)` : p.title;
        last = await copyIn(title, toProjectFile(title, entries), 'cloud');
        count += entries.length;
      }
      local.dropProject(p.id);
    }
    local.setState('example', null);
    if (last) await openProjectById(last);
    else await refreshProjects();
    toast(`Added ${count} diagram${count === 1 ? '' : 's'} to your account`);
  } catch (e) { toast((e as Error).message, 5000); await refreshProjects(); }
}
export const dismissLeftovers = () => { leftoversDismissed = true; useProjectList.setState({ leftovers: 0 }); };

// ---------- starting up ----------

/** Open this browser's last project (first visit: "My diagrams" with the example in it). */
async function openBrowserProject(example?: () => unknown) {
  const b = backendFor('local');
  const firstVisit = !local.localProjects().length;
  let list = await b.list();
  const last = local.getState<{ id: string }>('open:local');
  let p = list.find(x => x.id === last?.id) ?? list[0];
  if (firstVisit && example && !p.diagrams.length) {
    const file = example() as AnyFile;
    const a = await b.addDiagram(p.id, file);
    local.setState('example', { key: a.key, sig: sig(file) });
    list = await b.list(); p = list.find(x => x.id === p.id)!;
  }
  await switchProject(asOpen(p, 'local'), p.diagrams);
}

/** Before the account answers: show the project this device had open last, from what's kept here. */
export async function bootWorkspace(example: () => unknown) {
  await local.bootLocal();
  if (!local.isPersistent()) toast('This browser isn\'t keeping anything between visits (private window?) — sign in or export to keep your work', 7000);
  // the open browser project was deleted in another window: open another
  local.onRemote(m => {
    const p = openProject();
    if (m.type === 'project' && p?.scope === 'local' && m.key === p.id && !local.localProject(m.key)) void openBrowserProject();
  });
  startTabs();
  const lastCloud = local.getState<{ id: string; title: string }>('open:cloud');
  if (local.getState('scope') === 'cloud' && lastCloud && await restoreProject({ scope: 'cloud', ...lastCloud })) return;
  await openBrowserProject(example);
}

/**
 * Who are we, and what to show: ?p= / ?s= open a shared link; signed in, the account's projects (?d= opens
 * that diagram in its project); signed out, this browser's.
 */
export async function bootAccount(href: string): Promise<void> {
  const u = new URL(href);
  const p = u.searchParams.get('p'), s = u.searchParams.get('s'), d = u.searchParams.get('d');
  useCloud.setState({ user: await api.me().catch(() => null) });
  if (p && await openSharedProject(p)) return;
  if (s && await openSharedDiagram(s)) return;
  if (!signedIn()) { if (openProject()?.scope !== 'local') await openBrowserProject(); return; }

  // just came back from GitHub? restore the address we left from
  try {
    const back = sessionStorage.getItem('cistem.returnTo');
    if (back !== null) {
      sessionStorage.removeItem('cistem.returnTo');
      const bu = new URL(location.origin + '/' + back);
      if (!d && (bu.searchParams.get('d') || bu.searchParams.get('p') || bu.searchParams.get('s'))) {
        window.history.replaceState(null, '', bu.toString());
        return bootAccount(bu.toString());
      }
    }
  } catch { /* ignore */ }
  await enterAccount(d);
}

/** Show the account's projects: the one holding `focus`, else the one open before, else the most recent. */
async function enterAccount(focus?: string | null) {
  const list = await refreshProjects('cloud');
  if (!list?.length) { setStatus('error', useProjectList.getState().error || 'Couldn\'t load your projects'); return; }
  const holding = focus ? list.find(x => x.diagrams.some(y => y.id === focus)) : undefined;
  if (focus && !holding) toast('That diagram isn\'t in your account', 4000);
  const cur = openProject();
  const last = local.getState<{ id: string }>('open:cloud');
  const p = holding ?? list.find(x => x.id === (cur?.scope === 'cloud' ? cur.id : last?.id)) ?? list[0];
  await switchProject(asOpen(p, 'cloud'), p.diagrams, holding ? focus! : cur?.scope === 'cloud' ? tabs().active : undefined);
  const n = useProjectList.getState().leftovers;
  if (n) toast(`${n} diagram${n === 1 ? ' is' : 's are'} only in this browser — open Projects to add ${n === 1 ? 'it' : 'them'} to your account`, 6000);
}

/** Sign out, and carry on with this browser's projects. */
export async function signOutHere() {
  await saveNow();
  await signOut();
  await openBrowserProject();
}
