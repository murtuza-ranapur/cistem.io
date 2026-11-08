/** Between the open document and files: what's saved, what's loaded, and the local copy of each tab. */
import { readAny, type Loaded } from '../domain/document';
import { diagram } from '../diagrams';
import type { AnyFile } from '../diagrams/types';
import { editor, type Meta, type OpenDoc } from './editor';
import { storage } from '../lib/browser';

/** The open document as a file, whichever kind it is. */
export function currentFile(): AnyFile {
  const { open, meta } = editor();
  return diagram(open.kind).toFile(open.doc as never, meta);
}
export const serialize = () => JSON.stringify(currentFile(), null, 2);

/** A loaded file as the store holds it. */
export function toOpen(l: Loaded): { open: OpenDoc; meta: Meta } {
  switch (l.kind) {
    case 'sequence': return { open: { kind: 'sequence', doc: l.seq }, meta: l.meta };
    case 'class': return { open: { kind: 'class', doc: l.cls }, meta: l.meta };
    default: return { open: { kind: 'system', doc: l.doc }, meta: l.meta };
  }
}
/** Read any supported file (kind and version, migrating as needed); throws when it can't be read. */
export const readFile = (input: unknown) => toOpen(readAny(input));

/** A stored document (any kind or version); null when absent or unreadable. */
export function readLocal(key: string): ReturnType<typeof toOpen> | null {
  const json = storage.getJson<unknown>(key);
  if (!json) return null;
  try { return readFile(json); } catch { return null; }
}

/** JSON with object keys sorted: the server (Postgres jsonb) hands documents back with keys reordered. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
  }
  return JSON.stringify(v) ?? 'null';
}
/** What matters about the open document for saving: its content, ignoring the always-fresh `updated` stamp. */
export function signature(): string {
  const f = currentFile();
  return stable({ ...f, meta: { ...f.meta, updated: '' } });
}
