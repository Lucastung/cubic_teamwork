import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type User = {
  id: number; email: string; name: string; color: string;
  role: 'admin' | 'pm' | 'member';
};

type Vars = { user: User };

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

/* ── password hashing (PBKDF2, Workers-compatible) ── */
const ITER = 100_000;
async function hashPassword(pw: string, saltHex?: string): Promise<string> {
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256);
  const hex = (buf: ArrayBuffer | Uint8Array) =>
    [...new Uint8Array(buf as ArrayBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex(salt)}:${hex(bits)}`;
}
async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [salt] = stored.split(':');
  return (await hashPassword(pw, salt)) === stored;
}
const newToken = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');

/* ── auth middleware ── */
app.use('/api/*', async (c, next) => {
  const open = ['/api/auth/login', '/api/auth/setup', '/api/auth/status'];
  if (open.includes(c.req.path)) return next();
  const token = getCookie(c, 'ct_session');
  if (!token) return c.json({ error: '請先登入' }, 401);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.color, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`
  ).bind(token).first<User>();
  if (!row) return c.json({ error: '登入已過期' }, 401);
  c.set('user', row);
  await next();
});

const requireRole = (roles: string[]) => async (c: any, next: any) => {
  if (!roles.includes(c.get('user').role)) return c.json({ error: '權限不足' }, 403);
  await next();
};

/* ── auth routes ── */
app.get('/api/auth/status', async c => {
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return c.json({ needsSetup: (n?.n ?? 0) === 0 });
});

// 第一次使用：建立管理員帳號（僅在沒有任何使用者時開放）
app.post('/api/auth/setup', async c => {
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  if ((n?.n ?? 0) > 0) return c.json({ error: '系統已初始化' }, 400);
  const { email, name, password } = await c.req.json();
  if (!email || !name || !password || password.length < 8)
    return c.json({ error: '請填寫 email、姓名，密碼至少 8 碼' }, 400);
  const hash = await hashPassword(password);
  await c.env.DB.prepare(
    `INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, 'admin', ?)`
  ).bind(email.toLowerCase().trim(), name.trim(), hash).run();
  return c.json({ ok: true });
});

app.post('/api/auth/login', async c => {
  const { email, password } = await c.req.json();
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?')
    .bind(String(email ?? '').toLowerCase().trim()).first<any>();
  if (!u || !(await verifyPassword(String(password ?? ''), u.password_hash)))
    return c.json({ error: 'email 或密碼錯誤' }, 401);
  const token = newToken();
  await c.env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))`
  ).bind(token, u.id).run();
  setCookie(c, 'ct_session', token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return c.json({ id: u.id, email: u.email, name: u.name, color: u.color, role: u.role });
});

app.post('/api/auth/logout', async c => {
  const token = getCookie(c, 'ct_session');
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  deleteCookie(c, 'ct_session', { path: '/' });
  return c.json({ ok: true });
});

app.get('/api/auth/me', c => c.json(c.get('user')));

/* ── users ── */
app.get('/api/users', async c => {
  const { results } = await c.env.DB.prepare('SELECT id, email, name, color, role FROM users ORDER BY id').all();
  return c.json(results);
});

app.post('/api/users', requireRole(['admin']), async c => {
  const { email, name, password, role = 'member', color = '#3E7CB8' } = await c.req.json();
  if (!email || !name || !password || password.length < 8)
    return c.json({ error: '請填寫 email、姓名，密碼至少 8 碼' }, 400);
  const hash = await hashPassword(password);
  try {
    const r = await c.env.DB.prepare(
      'INSERT INTO users (email, name, color, role, password_hash) VALUES (?, ?, ?, ?, ?)'
    ).bind(email.toLowerCase().trim(), name.trim(), color, role, hash).run();
    return c.json({ id: r.meta.last_row_id });
  } catch {
    return c.json({ error: '這個 email 已存在' }, 409);
  }
});

app.patch('/api/users/:id', requireRole(['admin']), async c => {
  const id = Number(c.req.param('id'));
  const { name, color, role, password } = await c.req.json();
  if (name) await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, id).run();
  if (color) await c.env.DB.prepare('UPDATE users SET color = ? WHERE id = ?').bind(color, id).run();
  if (role) await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id).run();
  if (password) {
    if (password.length < 8) return c.json({ error: '密碼至少 8 碼' }, 400);
    await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), id).run();
  }
  return c.json({ ok: true });
});

/* ── projects ── */
app.get('/api/projects', async c => {
  const u = c.get('user');
  const sql = u.role === 'admin'
    ? `SELECT p.*, NULL AS my_role FROM projects p ORDER BY p.id DESC`
    : `SELECT p.*, m.role AS my_role FROM projects p
       JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
       ORDER BY p.id DESC`;
  const stmt = u.role === 'admin' ? c.env.DB.prepare(sql) : c.env.DB.prepare(sql).bind(u.id);
  const { results } = await stmt.all();
  return c.json(results);
});

app.post('/api/projects', requireRole(['admin', 'pm']), async c => {
  const u = c.get('user');
  const { name } = await c.req.json();
  if (!name?.trim()) return c.json({ error: '請輸入專案名稱' }, 400);
  const r = await c.env.DB.prepare('INSERT INTO projects (name, created_by) VALUES (?, ?)')
    .bind(name.trim(), u.id).run();
  const pid = r.meta.last_row_id;
  await c.env.DB.prepare(`INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'lead')`)
    .bind(pid, u.id).run();
  return c.json({ id: pid });
});

async function canAccessProject(c: any, projectId: number): Promise<boolean> {
  const u: User = c.get('user');
  if (u.role === 'admin') return true;
  const m = await c.env.DB.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
    .bind(projectId, u.id).first();
  return !!m;
}

app.put('/api/projects/:id/members', async c => {
  const pid = Number(c.req.param('id'));
  if (!(await canAccessProject(c, pid))) return c.json({ error: '權限不足' }, 403);
  const { userIds } = await c.req.json() as { userIds: number[] };
  const batch = [c.env.DB.prepare('DELETE FROM project_members WHERE project_id = ?').bind(pid),
    ...userIds.map(uid =>
      c.env.DB.prepare(`INSERT INTO project_members (project_id, user_id) VALUES (?, ?)`).bind(pid, uid))];
  await c.env.DB.batch(batch);
  return c.json({ ok: true });
});

/* ── nodes（模塊 / 分組 / 任務）── */
app.get('/api/projects/:id/tree', async c => {
  const pid = Number(c.req.param('id'));
  if (!(await canAccessProject(c, pid))) return c.json({ error: '權限不足' }, 403);
  const nodes = await c.env.DB.prepare('SELECT * FROM nodes WHERE project_id = ? ORDER BY parent_id, sort, id')
    .bind(pid).all();
  const deps = await c.env.DB.prepare(
    'SELECT d.node_id, d.depends_on FROM deps d JOIN nodes n ON n.id = d.node_id WHERE n.project_id = ?'
  ).bind(pid).all();
  return c.json({ nodes: nodes.results, deps: deps.results });
});

app.post('/api/nodes', async c => {
  const { project_id, parent_id = null, kind, title, mode = 'free', owner_id = null, due = null } = await c.req.json();
  if (!(await canAccessProject(c, project_id))) return c.json({ error: '權限不足' }, 403);
  if (!['module', 'group', 'task'].includes(kind) || !title?.trim())
    return c.json({ error: '參數不完整' }, 400);
  const s = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM nodes WHERE project_id = ? AND parent_id IS ?'
  ).bind(project_id, parent_id).first<{ next: number }>();
  const r = await c.env.DB.prepare(
    `INSERT INTO nodes (project_id, parent_id, kind, title, mode, owner_id, due, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(project_id, parent_id, kind, title.trim(), mode, owner_id, due, s?.next ?? 0).run();
  return c.json({ id: r.meta.last_row_id });
});

app.patch('/api/nodes/:id', async c => {
  const id = Number(c.req.param('id'));
  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(id).first<any>();
  if (!node) return c.json({ error: '找不到節點' }, 404);
  if (!(await canAccessProject(c, node.project_id))) return c.json({ error: '權限不足' }, 403);
  const body = await c.req.json();
  const sets: string[] = []; const vals: any[] = [];
  for (const k of ['title', 'mode', 'owner_id', 'due', 'sort', 'parent_id'] as const) {
    if (k in body) { sets.push(`${k} = ?`); vals.push(body[k]); }
  }
  if ('done' in body) {
    sets.push('done = ?', `done_at = ${body.done ? "datetime('now')" : 'NULL'}`);
    vals.push(body.done ? 1 : 0);
  }
  if (!sets.length) return c.json({ ok: true });
  vals.push(id);
  await c.env.DB.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});

app.delete('/api/nodes/:id', async c => {
  const id = Number(c.req.param('id'));
  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(id).first<any>();
  if (!node) return c.json({ error: '找不到節點' }, 404);
  if (!(await canAccessProject(c, node.project_id))) return c.json({ error: '權限不足' }, 403);
  await c.env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

app.put('/api/nodes/:id/deps', async c => {
  const id = Number(c.req.param('id'));
  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(id).first<any>();
  if (!node) return c.json({ error: '找不到節點' }, 404);
  if (!(await canAccessProject(c, node.project_id))) return c.json({ error: '權限不足' }, 403);
  const { dependsOn } = await c.req.json() as { dependsOn: number[] };
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM deps WHERE node_id = ?').bind(id),
    ...dependsOn.filter(d => d !== id).map(d =>
      c.env.DB.prepare('INSERT INTO deps (node_id, depends_on) VALUES (?, ?)').bind(id, d)),
  ]);
  return c.json({ ok: true });
});

/* ── 河流：某成員名下所有最終子任務，依 deadline 排序 ── */
app.get('/api/river/:userId?', async c => {
  const u = c.get('user');
  const uid = c.req.param('userId') ? Number(c.req.param('userId')) : u.id;
  const { results } = await c.env.DB.prepare(
    `SELECT n.*, p.name AS project_name FROM nodes n
     JOIN projects p ON p.id = n.project_id
     WHERE n.kind = 'task' AND n.owner_id = ? AND p.status = 'active'
     ORDER BY n.done, n.due IS NULL, n.due`
  ).bind(uid).all();
  return c.json(results);
});

/* ── SPA fallback ── */
app.notFound(c =>
  c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.env.ASSETS.fetch(c.req.raw)
);

export default app;
