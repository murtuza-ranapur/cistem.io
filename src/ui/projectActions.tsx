/** What the drawer, the tabs and the header offer for projects and diagrams, with the questions they ask first. */
import { useProjectList, refreshProjects, createProject, renameProject, deleteProject, deleteDiagram, moveDiagram, exportProject, openProjectById } from '../store/projects';
import type { DiagramInfo, ProjectInfo } from '../store/backends';
import { canClose, closeTab, newTab, openProject, peek, tabs, type Tab } from '../store/tabs';
import { diagram } from '../diagrams';
import { useUi } from '../store/ui';
import { signedIn } from '../store/cloud';
import { confirmDialog, promptDialog } from './Dialogs';
import type { MenuItem } from './Menu';

export async function askNewProject() {
  const title = await promptDialog({ title: 'New project', label: 'Name', confirm: 'Create project', placeholder: 'e.g. Payment upload' });
  if (title) await createProject(title);
}

export async function askRenameProject(p: { id: string; title: string }) {
  const title = await promptDialog({ title: 'Rename project', label: 'Name', value: p.title, confirm: 'Rename' });
  if (title && title !== p.title) await renameProject(p.id, title);
}

export async function askDeleteProject(p: ProjectInfo) {
  const n = p.diagrams.length;
  const ok = await confirmDialog({
    title: n ? `Delete “${p.title}” and its ${n} diagram${n === 1 ? '' : 's'}?` : `Delete “${p.title}”?`,
    body: n ? (
      <>
        <p>The project and every diagram in it are deleted{signedIn() ? ' from your account, with their version history' : ' from this browser'}. This can’t be undone.</p>
        <ul className="dlg-list">{p.diagrams.map(d => <li key={d.id}><KindIcon kind={d.kind} />{d.title}</li>)}</ul>
        {p.shared && <p className="dlg-warn">The project’s share link stops working.</p>}
        <button type="button" className="small" onClick={() => void exportProject(p.id)}>Export project first</button>
      </>
    ) : undefined,
    confirm: n ? `Delete project and ${n} diagram${n === 1 ? '' : 's'}` : 'Delete project',
    danger: true,
    typeToConfirm: n ? p.title : undefined,
  });
  if (ok) await deleteProject(p.id);
}

export async function askDeleteDiagram(d: { id: string; title: string }, where = openProject()?.title) {
  const ok = await confirmDialog({
    title: `Delete “${d.title}”?`,
    body: <p>It’s deleted from {where ? <b>{where}</b> : 'its project'}{signedIn() ? ' and your account, with its version history' : ''}. This can’t be undone. To keep it somewhere else, move it to another project instead.</p>,
    confirm: 'Delete diagram',
    danger: true,
  });
  if (ok) await deleteDiagram(d.id);
}

/** "Move to project ›": every other project. */
function moveItems(diagramId: string, from: string): MenuItem[] {
  const others = (useProjectList.getState().items ?? []).filter(p => p.id !== from);
  if (!others.length) return [{ label: 'No other projects yet', disabled: true }, { label: 'New project…', run: () => void askNewProject(), sep: true }];
  return others.map(p => ({ label: p.title, id: 'move-' + p.id, run: () => void moveDiagram(diagramId, p.id) }));
}

/** A project's ⋯ menu. */
export function projectMenu(p: ProjectInfo): MenuItem[] {
  const isOpen = openProject()?.id === p.id;
  return [
    ...(isOpen ? [] : [{ label: 'Open', id: 'p-open', run: () => void openProjectById(p.id) }]),
    { label: 'Rename', id: 'p-rename', run: () => void askRenameProject(p) },
    { label: 'Share…', id: 'p-share', disabled: !signedIn(), run: () => useUi.setState({ shareOpen: { projectId: p.id } }) },
    { label: 'Export project', id: 'p-export', run: () => void exportProject(p.id) },
    { label: 'Delete project…', id: 'p-delete', danger: true, sep: true, run: () => void askDeleteProject(p) },
  ];
}

/** A diagram's menu in the drawer. */
export function diagramMenu(d: DiagramInfo, p: ProjectInfo): MenuItem[] {
  return [
    { label: 'Open', id: 'd-open', run: () => void openProjectById(p.id, d.id) },
    { label: 'Move to project', id: 'd-move', items: () => moveItems(d.id, p.id) },
    { label: 'Delete diagram…', id: 'd-delete', danger: true, sep: true, run: () => void askDeleteDiagram(d, p.title) },
  ];
}

/** A tab's right-click menu. */
export function tabMenu(t: Tab): MenuItem[] {
  const p = openProject();
  if (!p || p.scope === 'view') return [{ label: 'Close tab', id: 't-close', disabled: !canClose(), run: () => void closeTab(t.key) }];
  void refreshProjects();
  return [
    { label: 'Duplicate', id: 't-dup', run: () => duplicate(t) },
    { label: 'Move to project', id: 't-move', items: () => moveItems(t.key, p.id) },
    { label: 'Close tab', id: 't-close', sep: true, disabled: !canClose(), run: () => void closeTab(t.key) },
    { label: 'Delete diagram…', id: 't-delete', danger: true, run: () => void askDeleteDiagram({ id: t.key, title: t.title }) },
  ];
}

function duplicate(t: Tab) {
  const d = peek(t.key); if (!d) return;
  const file = diagram(d.open.kind).toFile(d.open.doc as never, { title: `${d.title} copy`, created: new Date().toISOString(), updated: new Date().toISOString() });
  void newTab(d.open.kind, file);
}

export const openTabsOf = () => new Set(tabs().list.map(t => t.key));

export function KindIcon({ kind }: { kind: string }) {
  return <span className={`tk k-${kind}`} title={diagram(kind as never).label}><svg aria-hidden="true"><use href={`#ic-k-${kind}`} /></svg></span>;
}
