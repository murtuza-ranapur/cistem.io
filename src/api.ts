/**
 * Thin client for the cistem API (backend/). All calls are optional: the app
 * works offline against localStorage when no API URL or key is configured.
 */
import type { DiagramFile } from './document';

export interface Summary { id: string; title: string; kind: string; version: number; shared: boolean; createdAt: string; updatedAt: string }
export interface Stored { id: string; title: string; kind: string; document: DiagramFile; version: number; shareToken?: string; createdAt: string; updatedAt: string }

export class ConflictError extends Error { constructor(public current: Stored) { super('Diagram changed elsewhere'); } }
export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const CFG_KEY = 'cistem.api';
export interface ApiConfig { url: string; key: string }

export function getConfig(): ApiConfig | null {
  try {
    const s = localStorage.getItem(CFG_KEY);
    if (s) { const c = JSON.parse(s); if (c.url) return c; }
  } catch { /* ignore */ }
  const url = import.meta.env.VITE_API_URL as string | undefined;
  return url ? { url, key: '' } : null;
}
export function setConfig(c: ApiConfig | null) {
  try { c ? localStorage.setItem(CFG_KEY, JSON.stringify(c)) : localStorage.removeItem(CFG_KEY); } catch { /* ignore */ }
}
export const enabled = () => !!getConfig()?.url;

async function call<T>(path: string, init: RequestInit = {}, etag?: number): Promise<{ body: T; etag: number; status: number }> {
  const cfg = getConfig();
  if (!cfg) throw new ApiError(0, 'API not configured');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> || {}) };
  if (cfg.key) headers['X-Api-Key'] = cfg.key;
  if (etag !== undefined) headers['If-Match'] = `"${etag}"`;
  const res = await fetch(cfg.url.replace(/\/$/, '') + path, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  const et = parseInt((res.headers.get('ETag') || '').replace(/\D/g, '')) || (body && body.version) || 0;
  if (res.status === 409) throw new ConflictError(body);
  if (!res.ok) throw new ApiError(res.status, body?.error || body?.message || res.statusText);
  return { body, etag: et, status: res.status };
}

export const api = {
  list: () => call<Summary[]>('/api/diagrams').then(r => r.body),
  get: (id: string) => call<Stored>(`/api/diagrams/${id}`).then(r => r.body),
  create: (document: DiagramFile) => call<Stored>('/api/diagrams', { method: 'POST', body: JSON.stringify({ document }) }).then(r => r.body),
  update: (id: string, version: number, document: DiagramFile) =>
    call<Stored>(`/api/diagrams/${id}`, { method: 'PUT', body: JSON.stringify({ document }) }, version).then(r => r.body),
  remove: (id: string) => call<void>(`/api/diagrams/${id}`, { method: 'DELETE' }).then(() => undefined),
  share: (id: string) => call<Summary>(`/api/diagrams/${id}/share`, { method: 'POST' }).then(r => r.body),
  unshare: (id: string) => call<void>(`/api/diagrams/${id}/share`, { method: 'DELETE' }).then(() => undefined),
  shared: (token: string) => call<Stored>(`/api/share/${token}`).then(r => r.body),
  ping: () => call<unknown>('/api/diagrams').then(() => true),
};
