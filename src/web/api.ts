async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(url: string) => req<T>('GET', url),
  post: <T>(url: string, body?: unknown) => req<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => req<T>('PATCH', url, body),
  put: <T>(url: string, body?: unknown) => req<T>('PUT', url, body),
  del: <T>(url: string) => req<T>('DELETE', url),
};

export type User = { id: number; email: string; name: string; color: string; role: 'admin' | 'pm' | 'member' };
export type Project = { id: number; name: string; status: string; my_role: string | null };
export type Node = {
  id: number; project_id: number; parent_id: number | null;
  kind: 'module' | 'group' | 'task'; title: string; mode: 'seq' | 'free';
  owner_id: number | null; due: string | null; done: number; sort: number;
};
export type Dep = { node_id: number; depends_on: number };
