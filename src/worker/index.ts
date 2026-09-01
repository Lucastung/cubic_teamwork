import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { docsApp } from './docs';
import { erpApp } from './erp';
import { dumpAll, validateBackup, restoreAll, runScheduledBackup } from './backup';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
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
    ? `SELECT p.*, NULL AS my_role FROM projects p WHERE p.kind = 'normal' ORDER BY p.id DESC`
    : `SELECT DISTINCT p.*, m.role AS my_role FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
       WHERE p.kind = 'normal' AND (m.user_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM nodes n WHERE n.project_id = p.id AND n.owner_id = ?))
       ORDER BY p.id DESC`;
  const stmt = u.role === 'admin' ? c.env.DB.prepare(sql) : c.env.DB.prepare(sql).bind(u.id, u.id);
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

/* ── 進度管理：跨專案任務匯總 ── */
app.get('/api/progress', async c => {
  const u = c.get('user');
  const projStmt = (u.role === 'admin' || u.role === 'pm')
    ? c.env.DB.prepare(`SELECT id, name FROM projects WHERE kind = 'normal' AND status = 'active' ORDER BY id DESC`)
    : c.env.DB.prepare(
        `SELECT DISTINCT p.id, p.name FROM projects p
         LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
         WHERE p.kind = 'normal' AND p.status = 'active' AND (m.user_id IS NOT NULL
           OR EXISTS (SELECT 1 FROM nodes n WHERE n.project_id = p.id AND n.owner_id = ?))
         ORDER BY p.id DESC`).bind(u.id, u.id);
  const projects = (await projStmt.all()).results as any[];
  if (!projects.length) return c.json({ projects: [], nodes: [], deps: [] });
  const ids = projects.map(p => p.id);
  const ph = ids.map(() => '?').join(',');
  const nodes = (await c.env.DB.prepare(
    `SELECT * FROM nodes WHERE project_id IN (${ph}) ORDER BY parent_id, sort, id`).bind(...ids).all()).results;
  const deps = (await c.env.DB.prepare(
    `SELECT d.node_id, d.depends_on FROM deps d JOIN nodes n ON n.id = d.node_id WHERE n.project_id IN (${ph})`
  ).bind(...ids).all()).results;
  return c.json({ projects, nodes, deps });
});

async function canAccessProject(c: any, projectId: number): Promise<boolean> {
  const u: User = c.get('user');
  if (u.role === 'admin') return true;
  const m = await c.env.DB.prepare(
    `SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?
     UNION SELECT 1 FROM nodes WHERE project_id = ? AND owner_id = ? LIMIT 1`
  ).bind(projectId, u.id, projectId, u.id).first();
  return !!m;
}

/** 指派任務給某人時，自動讓他成為專案成員（才看得到專案與自己的河流） */
async function ensureMembership(db: D1Database, projectId: number, userId: number | null | undefined) {
  if (!userId) return;
  await db.prepare(`INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')`)
    .bind(projectId, userId).run();
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
  const { project_id, parent_id = null, kind, title, mode = 'free', owner_id = null, due = null, due_offset = null, role_hint = null } = await c.req.json();
  if (!(await canAccessProject(c, project_id))) return c.json({ error: '權限不足' }, 403);
  if (!['module', 'group', 'task'].includes(kind) || !title?.trim())
    return c.json({ error: '參數不完整' }, 400);
  const s = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM nodes WHERE project_id = ? AND parent_id IS ?'
  ).bind(project_id, parent_id).first<{ next: number }>();
  const r = await c.env.DB.prepare(
    `INSERT INTO nodes (project_id, parent_id, kind, title, mode, owner_id, due, due_offset, role_hint, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(project_id, parent_id, kind, title.trim(), mode, owner_id, due, due_offset, role_hint, s?.next ?? 0).run();
  await ensureMembership(c.env.DB, project_id, owner_id);
  return c.json({ id: r.meta.last_row_id });
});

app.get('/api/nodes/:id', async c => {
  const id = Number(c.req.param('id'));
  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(id).first<any>();
  if (!node) return c.json({ error: '找不到節點' }, 404);
  if (!(await canAccessProject(c, node.project_id))) return c.json({ error: '權限不足' }, 403);
  const project = await c.env.DB.prepare('SELECT id, name, kind, status FROM projects WHERE id = ?')
    .bind(node.project_id).first();
  return c.json({ node, project });
});

app.patch('/api/nodes/:id', async c => {
  const id = Number(c.req.param('id'));
  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(id).first<any>();
  if (!node) return c.json({ error: '找不到節點' }, 404);
  if (!(await canAccessProject(c, node.project_id))) return c.json({ error: '權限不足' }, 403);
  if (node.stage === 'signed' || node.stage === 'closed')
    return c.json({ error: '已簽核／結案的任務內容已鎖定，不可修改' }, 403);
  const body = await c.req.json();
  const sets: string[] = []; const vals: any[] = [];
  for (const k of ['title', 'mode', 'owner_id', 'due', 'due_offset', 'role_hint', 'description', 'needs_sign', 'sort', 'parent_id'] as const) {
    if (k in body) { sets.push(`${k} = ?`); vals.push(body[k]); }
  }
  if (!sets.length) return c.json({ ok: true });
  vals.push(id);
  await c.env.DB.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  if ('owner_id' in body) await ensureMembership(c.env.DB, node.project_id, body.owner_id);
  return c.json({ ok: true });
});

/* ── 生命週期與簽核 ── */
const sha256hex = async (s: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
};
async function addSignature(db: D1Database, entityType: string, entityId: number, action: string, signerId: number, note: string | null, content: object) {
  const content_hash = await sha256hex(JSON.stringify(content));
  const prev = await db.prepare('SELECT chain_hash FROM signatures ORDER BY id DESC LIMIT 1').first<{ chain_hash: string }>();
  const prev_hash = prev?.chain_hash ?? 'GENESIS';
  const now = new Date().toISOString();
  const chain_hash = await sha256hex(prev_hash + content_hash + action + signerId + now);
  await db.prepare(
    'INSERT INTO signatures (entity_type, entity_id, action, signer_id, note, content_hash, prev_hash, chain_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(entityType, entityId, action, signerId, note, content_hash, prev_hash, chain_hash).run();
}

app.post('/api/nodes/:id/stage', async c => {
  const id = Number(c.req.param('id'));
  const u = c.get('user');
  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(id).first<any>();
  if (!node) return c.json({ error: '找不到節點' }, 404);
  if (node.kind !== 'task') return c.json({ error: '只有任務有生命週期' }, 400);
  if (!(await canAccessProject(c, node.project_id))) return c.json({ error: '權限不足' }, 403);
  const { action, password, note } = await c.req.json();
  const db = c.env.DB;
  const set = (sql: string, ...vals: any[]) => db.prepare(`UPDATE nodes SET ${sql} WHERE id = ?`).bind(...vals, id).run();

  switch (action) {
    case 'start':
      if (node.stage !== 'todo') return c.json({ error: '只有「已建立」的任務可以開始執行' }, 400);
      await set(`stage = 'doing'`);
      return c.json({ ok: true });
    case 'finish':
      if (!['todo', 'doing'].includes(node.stage)) return c.json({ error: '這個任務不在可完成的狀態' }, 400);
      await set(`stage = 'done', done = 1, done_by = ?, done_at = datetime('now')`, u.id);
      return c.json({ ok: true });
    case 'undo':
      if (node.stage === 'done')
        await set(`stage = 'doing', done = 0, done_by = NULL, done_at = NULL`);
      else if (node.stage === 'doing')
        await set(`stage = 'todo'`);
      else return c.json({ error: '已簽核／結案的任務不能復原' }, 400);
      return c.json({ ok: true });
    case 'sign': {
      if (node.stage !== 'done') return c.json({ error: '只有「已完成」的任務可以簽核' }, 400);
      if (!node.needs_sign) return c.json({ error: '這個任務未設定需簽核' }, 400);
      if (u.role !== 'admin' && u.role !== 'pm') return c.json({ error: '需要專案負責人或管理員權限' }, 403);
      if (node.done_by === u.id) return c.json({ error: '不能簽核自己執行完成的任務（第二人核實原則）' }, 403);
      const me = await db.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first<any>();
      if (!password || !(await verifyPassword(String(password), me.password_hash)))
        return c.json({ error: '密碼錯誤，簽核需驗證本人' }, 401);
      await addSignature(db, 'node', id, 'sign', u.id, note ?? null, {
        entity: 'node', id, title: node.title, description: node.description,
        project_id: node.project_id, done_by: node.done_by, done_at: node.done_at, due: node.due,
      });
      await set(`stage = 'signed', signed_by = ?, signed_at = datetime('now')`, u.id);
      return c.json({ ok: true });
    }
    case 'reject': {
      if (node.stage !== 'done') return c.json({ error: '只有「已完成」的任務可以退回' }, 400);
      if (u.role !== 'admin' && u.role !== 'pm') return c.json({ error: '需要專案負責人或管理員權限' }, 403);
      if (node.done_by === u.id) return c.json({ error: '不能審核自己執行的任務' }, 403);
      if (!note?.trim()) return c.json({ error: '退回請填寫原因' }, 400);
      await addSignature(db, 'node', id, 'reject', u.id, note.trim(), {
        entity: 'node', id, title: node.title, done_by: node.done_by, done_at: node.done_at,
      });
      await set(`stage = 'doing', done = 0, done_by = NULL, done_at = NULL`);
      return c.json({ ok: true });
    }
    case 'close': {
      const closable = node.stage === 'signed' || (node.stage === 'done' && !node.needs_sign);
      if (!closable) return c.json({ error: '需簽核的任務要先簽核才能結案' }, 400);
      if (u.role !== 'admin' && u.role !== 'pm') return c.json({ error: '需要專案負責人或管理員權限' }, 403);
      await addSignature(db, 'node', id, 'close', u.id, note ?? null, {
        entity: 'node', id, title: node.title, signed_by: node.signed_by, signed_at: node.signed_at,
      });
      await set(`stage = 'closed', closed_at = datetime('now')`);
      return c.json({ ok: true });
    }
  }
  return c.json({ error: '未知的動作' }, 400);
});

/* ── 留言（物件層共通）── */
app.get('/api/comments', async c => {
  const type = c.req.query('type'), id = Number(c.req.query('id'));
  if (!type || !id) return c.json([]);
  const { results } = await c.env.DB.prepare(
    `SELECT cm.id, cm.body, cm.created_at, cm.author_id, u.name AS author, u.color
     FROM comments cm JOIN users u ON u.id = cm.author_id
     WHERE cm.entity_type = ? AND cm.entity_id = ? ORDER BY cm.id`
  ).bind(type, id).all();
  return c.json(results);
});
app.post('/api/comments', async c => {
  const u = c.get('user');
  const { entity_type, entity_id, body } = await c.req.json();
  if (!entity_type || !entity_id || !body?.trim()) return c.json({ error: '留言內容不可為空' }, 400);
  const r = await c.env.DB.prepare(
    'INSERT INTO comments (entity_type, entity_id, author_id, body) VALUES (?, ?, ?, ?)'
  ).bind(entity_type, Number(entity_id), u.id, body.trim()).run();
  return c.json({ id: r.meta.last_row_id });
});
app.delete('/api/comments/:id', async c => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const cm = await c.env.DB.prepare('SELECT * FROM comments WHERE id = ?').bind(id).first<any>();
  if (!cm) return c.json({ error: '找不到留言' }, 404);
  if (cm.author_id !== u.id && u.role !== 'admin') return c.json({ error: '只能刪除自己的留言' }, 403);
  await c.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

app.get('/api/nodes/:id/signatures', async c => {
  const id = Number(c.req.param('id'));
  const { results } = await c.env.DB.prepare(
    `SELECT s.action, s.note, s.content_hash, s.chain_hash, s.created_at, u.name AS signer
     FROM signatures s JOIN users u ON u.id = s.signer_id
     WHERE s.entity_type = 'node' AND s.entity_id = ? ORDER BY s.id`
  ).bind(id).all();
  return c.json(results);
});

app.delete('/api/nodes/:id', async c => {
  const id = Number(c.req.param('id'));
  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(id).first<any>();
  if (!node) return c.json({ error: '找不到節點' }, 404);
  if (!(await canAccessProject(c, node.project_id))) return c.json({ error: '權限不足' }, 403);
  if (node.stage === 'signed' || node.stage === 'closed')
    return c.json({ error: '已簽核／結案的任務不可刪除' }, 403);
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

/* ── 系統備份與還原（僅管理員）── */
const adminOnly = async (c: any, next: any) => {
  if (c.get('user').role !== 'admin') return c.json({ error: '需要管理員權限' }, 403);
  await next();
};

app.get('/api/backup', adminOnly, async c => {
  const data = await dumpAll(c.env.DB);
  const date = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return c.json(data, 200, {
    'Content-Disposition': `attachment; filename="cubic-backup-${date}.json"`,
  });
});

app.get('/api/backups', adminOnly, async c => {
  const list = await c.env.FILES.list({ prefix: 'backups/' });
  return c.json(list.objects
    .sort((a, b) => (a.key > b.key ? -1 : 1))
    .map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded })));
});

app.post('/api/restore', adminOnly, async c => {
  const { password, confirm, backup } = await c.req.json();
  if (confirm !== 'RESTORE') return c.json({ error: '請輸入確認字樣 RESTORE' }, 400);
  const me = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.get('user').id).first<any>();
  if (!password || !(await verifyPassword(String(password), me.password_hash)))
    return c.json({ error: '密碼錯誤' }, 401);
  const err = validateBackup(backup);
  if (err) return c.json({ error: err }, 400);
  const n = await restoreAll(c.env.DB, backup);
  return c.json({ ok: true, restored_rows: n, note: '還原完成，所有人需重新登入' });
});

app.post('/api/restore-from', adminOnly, async c => {
  const { key, password, confirm } = await c.req.json();
  if (confirm !== 'RESTORE') return c.json({ error: '請輸入確認字樣 RESTORE' }, 400);
  const me = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.get('user').id).first<any>();
  if (!password || !(await verifyPassword(String(password), me.password_hash)))
    return c.json({ error: '密碼錯誤' }, 401);
  if (!key?.startsWith('backups/')) return c.json({ error: '無效的備份' }, 400);
  const obj = await c.env.FILES.get(key);
  if (!obj) return c.json({ error: '找不到備份檔' }, 404);
  const backup = await obj.json();
  const err = validateBackup(backup);
  if (err) return c.json({ error: err }, 400);
  const n = await restoreAll(c.env.DB, backup);
  return c.json({ ok: true, restored_rows: n, note: '還原完成，所有人需重新登入' });
});

/* ── 文件中心 ── */
app.route('/api', docsApp as any);

/* ── ERP：客戶 / 服務項目 / 報價 / 訂單 ── */
app.route('/api', erpApp as any);

/* ── SPA fallback ── */
app.notFound(c =>
  c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.env.ASSETS.fetch(c.req.raw)
);

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx),
  /** 每日自動備份（cron 於 wrangler.jsonc 設定，UTC 18:00 = 台北 02:00） */
  scheduled: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runScheduledBackup(env.DB, env.FILES));
  },
};
