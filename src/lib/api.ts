/**
 * Client for the cistem API. Same origin, cookie session (GitHub sign-in).
 * Every call can fail with AuthError when signed out; the app then works offline.
 */
import type { DiagramFile, SequenceFile, ClassFile } from '../domain/document';
type AnyFile = DiagramFile | SequenceFile | ClassFile;

export interface Profile { id: string; login: string; name?: string; avatarUrl?: string }
export interface Summary { id: string; title: string; kind: string; version: number; shared: boolean; createdAt: string; updatedAt: string }
export interface Stored { id: string; title: string; kind: string; document: AnyFile; version: number; shareToken?: string; createdAt: string; updatedAt: string }

export class ConflictError extends Error { constructor(public current: Stored) { super('Diagram changed elsewhere'); } }
export class AuthError extends Error { constructor() { super('Sign in required'); } }
export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const xsrf = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)?.[1] ?? '');

async function call<T>(path: string, init: RequestInit = {}, etag?: number): Promise<{ body: T; etag: number; status: number }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> || {}) };
  if (etag !== undefined) headers['If-Match'] = `"${etag}"`;
  if (init.method && init.method !== 'GET') headers['X-XSRF-TOKEN'] = xsrf();
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const text = await res.text();
  let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  const et = parseInt((res.headers.get('ETag') || '').replace(/\D/g, '')) || (body && body.version) || 0;
  if (res.status === 401) throw new AuthError();
  if (res.status === 409) throw new ConflictError(body);
  if (!res.ok) throw new ApiError(res.status, body?.error || body?.message || res.statusText);
  return { body, etag: et, status: res.status };
}

export const api = {
  me: () => call<Profile>('/api/me').then(r => r.body),
  list: () => call<Summary[]>('/api/diagrams').then(r => r.body),
  get: (id: string) => call<Stored>(`/api/diagrams/${id}`).then(r => r.body),
  create: (document: AnyFile) => call<Stored>('/api/diagrams', { method: 'POST', body: JSON.stringify({ document }) }).then(r => r.body),
  update: (id: string, version: number, document: AnyFile) =>
    call<Stored>(`/api/diagrams/${id}`, { method: 'PUT', body: JSON.stringify({ document }) }, version).then(r => r.body),
  remove: (id: string) => call<void>(`/api/diagrams/${id}`, { method: 'DELETE' }).then(() => undefined),
  share: (id: string) => call<Stored>(`/api/diagrams/${id}/share`, { method: 'POST' }).then(r => r.body),
  unshare: (id: string) => call<void>(`/api/diagrams/${id}/share`, { method: 'DELETE' }).then(() => undefined),
  shared: (token: string) => call<Stored>(`/api/share/${token}`).then(r => r.body),
  logout: () => call<void>('/api/logout', { method: 'POST' }).then(() => undefined),
  signInUrl: () => '/oauth2/authorization/github',
};
