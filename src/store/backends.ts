/**
 * Where projects and diagrams are kept: the account (signed in) or this browser (signed out). Both answer the
 * same questions, so the rest of the app never asks which one it's talking to.
 */
import { api, type Project, type Summary } from '../lib/api';
import type { DiagramKind } from '../domain/document';
import type { AnyFile } from '../diagrams/types';
import { signedIn } from './cloud';
import * as local from './local';

export interface DiagramInfo { id: string; title: string; kind: DiagramKind; updatedAt: string; shared?: boolean }
export interface ProjectInfo { id: string; title: string; shared?: boolean; updatedAt: string; diagrams: DiagramInfo[] }
/** A diagram just added to a project: the key its tab uses, and its account id when it has one. */
export interface Added { key: string; cloudId?: string; version?: number }

export interface Backend {
  scope: 'local' | 'cloud';
  /** Every project, most recently changed first; there's always at least one. */
  list(): Promise<ProjectInfo[]>;
  create(title: string): Promise<string>;
  rename(id: string, title: string): Promise<void>;
  /** Delete a project and every diagram in it. */
  remove(id: string): Promise<void>;
  addDiagram(projectId: string, file: AnyFile): Promise<Added>;
  removeDiagram(id: string): Promise<void>;
  move(diagramId: string, projectId: string): Promise<void>;
  /** A diagram's current file (for exporting a project). */
  file(id: string): Promise<AnyFile>;
}

export const DEFAULT_PROJECT = 'My diagrams';
const now = () => new Date().toISOString();

const browser: Backend = {
  scope: 'local',
  async list() {
    if (!local.localProjects().length) await browser.create(DEFAULT_PROJECT);
    return local.localProjects().map(p => ({
      id: p.id, title: p.title, updatedAt: p.updated,
      diagrams: local.docsOf(p.id).map(([key, d]) => ({
        id: key, title: String(d.file.meta?.title ?? 'Untitled'), kind: d.file.kind as DiagramKind, updatedAt: String(d.file.meta?.updated ?? ''),
      })),
    }));
  },
  async create(title) {
    const id = local.freshKey('p');
    local.putProject({ id, title, created: now(), updated: now() });
    return id;
  },
  async rename(id, title) { const p = local.localProject(id); if (p) local.putProject({ ...p, title, updated: now() }); },
  async remove(id) { local.dropProject(id); },
  async addDiagram(projectId, file) {
    const key = local.freshKey('l');
    local.putDoc(key, { project: projectId, file });
    local.touchProject(projectId);
    return { key };
  },
  async removeDiagram(id) { local.dropDoc(id); },
  async move(id, projectId) {
    const d = local.doc(id); if (!d) throw new Error('No such diagram');
    local.putDoc(id, { ...d, project: projectId });
    local.touchProject(projectId);
  },
  async file(id) { const d = local.doc(id); if (!d) throw new Error('No such diagram'); return d.file; },
};

const toInfo = (p: Project): ProjectInfo => ({ id: p.id, title: p.title, shared: p.shared, updatedAt: p.updatedAt, diagrams: p.diagrams.map(diagramInfo) });
const diagramInfo = (d: Summary): DiagramInfo => ({ id: d.id, title: d.title, kind: d.kind as DiagramKind, updatedAt: d.updatedAt, shared: d.shared });

const account: Backend = {
  scope: 'cloud',
  list: async () => (await api.projects()).map(toInfo),
  create: async title => (await api.createProject(title)).id,
  rename: async (id, title) => { await api.renameProject(id, title); },
  async remove(id) {
    const gone = (await api.projects()).find(p => p.id === id)?.diagrams ?? [];
    await api.removeProject(id);
    gone.forEach(d => local.dropDoc(d.id));
  },
  async addDiagram(projectId, file) {
    const s = await api.create(file, projectId);
    local.putDoc(s.id, { project: null, file: s.document, cloudId: s.id, version: s.version });
    return { key: s.id, cloudId: s.id, version: s.version };
  },
  async removeDiagram(id) { await api.remove(id); local.dropDoc(id); },
  move: async (id, projectId) => { await api.move(id, projectId); },
  file: async id => (await api.get(id)).document,
};

/** The store for a scope, or for the current sign-in state. */
export const backendFor = (scope: 'local' | 'cloud'): Backend => (scope === 'cloud' ? account : browser);
export const backend = (): Backend => backendFor(signedIn() ? 'cloud' : 'local');
