/**
 * A project file: several diagrams in one download, with the links between them.
 *
 *   { format: "cistem-project", version: 1, title, diagrams: [{ id, file }] }
 *
 * `id` is what the diagram was known by where it came from; a sequence that draws on a system diagram in the
 * same project names that id, and importing points it at the new copy instead.
 */
import { readAny, type DiagramKind } from './document';
import type { SeqUses } from './seq';

export const PROJECT_FORMAT = 'cistem-project';
export const PROJECT_VERSION = 1;

export interface ProjectEntry { id: string; file: unknown }
export interface ProjectFile { format: typeof PROJECT_FORMAT; version: number; title: string; diagrams: ProjectEntry[] }

export const isProjectFile = (v: unknown): v is ProjectFile =>
  !!v && typeof v === 'object' && (v as { format?: unknown }).format === PROJECT_FORMAT;

export function toProjectFile(title: string, diagrams: ProjectEntry[]): ProjectFile {
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, title, diagrams };
}

/** Check a project file; every diagram in it must be readable. Throws with the reason otherwise. */
export function readProjectFile(input: unknown): { title: string; diagrams: { id: string; file: unknown; kind: DiagramKind }[] } {
  if (!isProjectFile(input)) throw new Error('Not a cistem.dev project file');
  if (typeof input.version !== 'number' || input.version > PROJECT_VERSION) throw new Error(`Project file version ${input.version} is newer than this app understands`);
  if (!Array.isArray(input.diagrams)) throw new Error('Malformed project file');
  const title = String(input.title ?? '').trim().slice(0, 200) || 'Imported project';
  const diagrams = input.diagrams.map((d, i) => {
    try { return { id: String(d?.id ?? i), file: d.file, kind: readAny(d.file).kind }; }
    catch (e) { throw new Error(`Diagram ${i + 1}: ${(e as Error).message}`); }
  });
  return { title, diagrams };
}

/** Sequences ordered after the diagrams they draw on, so those have new ids by the time a sequence is copied. */
export function inDependencyOrder<T extends { kind: DiagramKind }>(items: T[]): T[] {
  return [...items.filter(d => d.kind !== 'sequence'), ...items.filter(d => d.kind === 'sequence')];
}

/**
 * The same file with its link to a system diagram pointed elsewhere: `to(oldId)` gives the new reference, or
 * undefined to leave it (a diagram outside the project keeps its link).
 */
export function relink(file: unknown, to: (oldId: string) => SeqUses | undefined): unknown {
  const f = file as { kind?: string; model?: { uses?: SeqUses } };
  const uses = f?.kind === 'sequence' ? f.model?.uses : undefined;
  const old = uses && (uses.id ?? uses.tab);
  const next = old ? to(old) : undefined;
  if (!next) return file;
  return { ...f, model: { ...f.model, uses: { ...next, ...(uses?.title ? { title: uses.title } : {}) } } };
}
