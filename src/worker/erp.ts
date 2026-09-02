import { Hono } from 'hono';

type User = { id: number; email: string; name: string; color: string; role: 'admin' | 'pm' | 'member' };
interface ErpEnv { DB: D1Database; FILES: R2Bucket; ASSETS: Fetcher }
type Ctx = { Bindings: ErpEnv; Variables: { user: User } };

export const erpApp = new Hono<Ctx>();

const canWrite = (u: User) => u.role === 'admin' || u.role === 'pm';
const writeGuard = async (c: any, next: any) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) && !canWrite(c.get('user')))
    return c.json({ error: '需要管理員或專案負責人權限' }, 403);
  await next();
};
erpApp.use('/parties/*', writeGuard); erpApp.use('/parties', writeGuard);
erpApp.use('/items/*', writeGuard); erpApp.use('/items', writeGuard);
erpApp.use('/quotes/*', writeGuard); erpApp.use('/quotes', writeGuard);
erpApp.use('/orders/*', writeGuard); erpApp.use('/orders', writeGuard);

async function nextNo(db: D1Database, table: 'quotes' | 'orders', prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'quotes' ? 'quote_no' : 'order_no'} LIKE ?`)
    .bind(like).first<{ n: number }>();
  return `${prefix}-${year}-${String((r?.n ?? 0) + 1).padStart(4, '0')}`;
}
const logEvent = (db: D1Database, type: string, id: number, action: string, actor: number) =>
  db.prepare('INSERT INTO txn_events (entity_type, entity_id, action, actor_id) VALUES (?, ?, ?, ?)')
    .bind(type, id, action, actor).run();

type LineIn = { item_id?: number | null; name: string; qty: number; unit: string; price: number };
const calcLines = (lines: LineIn[]) => {
  const rows = lines.filter(l => l.name?.trim()).map((l, i) => ({
    item_id: l.item_id ?? null, name: l.name.trim(),
    qty: Number(l.qty) || 1, unit: l.unit || '式',
    price: Math.round(Number(l.price) || 0),
    amount: Math.round((Number(l.qty) || 1) * (Number(l.price) || 0)),
    sort: i,
  }));
  return { rows, total: rows.reduce((s, r) => s + r.amount, 0) };
};

/* ═══ 專案模版 ═══ */
erpApp.use('/templates/*', writeGuard); erpApp.use('/templates', writeGuard);

erpApp.get('/templates', async c => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM nodes n WHERE n.project_id = p.id AND n.kind = 'task') AS task_count
     FROM projects p WHERE p.kind = 'template' ORDER BY p.id DESC`
  ).all();
  return c.json(results);
});
erpApp.post('/templates', async c => {
  const u = c.get('user');
  const { name } = await c.req.json();
  if (!name?.trim()) return c.json({ error: '請輸入模版名稱' }, 400);
  const r = await c.env.DB.prepare(`INSERT INTO projects (name, kind, created_by) VALUES (?, 'template', ?)`)
    .bind(name.trim(), u.id).run();
  const pid = r.meta.last_row_id;
  await c.env.DB.prepare(`INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'lead')`).bind(pid, u.id).run();
  return c.json({ id: pid });
});

/** 把模版的整棵任務樹複製進目標專案：相對時程換算成日期、依賴關係重新映射、角色佔位保留 */
export async function applyTemplate(db: D1Database, templateId: number, projectId: number) {
  const nodes = (await db.prepare('SELECT * FROM nodes WHERE project_id = ? ORDER BY sort, id').bind(templateId).all()).results as any[];
  if (!nodes.length) return 0;
  const deps = (await db.prepare(
    'SELECT d.node_id, d.depends_on FROM deps d JOIN nodes n ON n.id = d.node_id WHERE n.project_id = ?'
  ).bind(templateId).all()).results as any[];
  const dueFromOffset = (off: number | null) =>
    off == null ? null : new Date(Date.now() + off * 86400000).toISOString().slice(0, 10);
  const idMap = new Map<number, number>();
  // 由上而下逐層插入（父節點先於子節點）
  let frontier = nodes.filter(n => n.parent_id == null);
  while (frontier.length) {
    for (const n of frontier) {
      const r = await db.prepare(
        `INSERT INTO nodes (project_id, parent_id, kind, title, mode, owner_id, due, role_hint, description, needs_sign, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(projectId, n.parent_id == null ? null : idMap.get(n.parent_id) ?? null,
        n.kind, n.title, n.mode, n.owner_id ?? null,
        n.kind === 'task' ? dueFromOffset(n.due_offset) : null, n.role_hint, n.description ?? null, n.needs_sign ?? 0, n.sort).run();
      idMap.set(n.id, r.meta.last_row_id as number);
    }
    const doneIds = new Set(idMap.keys());
    frontier = nodes.filter(n => n.parent_id != null && doneIds.has(n.parent_id) && !idMap.has(n.id));
  }
  const depRows = deps.filter(d => idMap.has(d.node_id) && idMap.has(d.depends_on));
  if (depRows.length) await db.batch(depRows.map(d =>
    db.prepare('INSERT INTO deps (node_id, depends_on) VALUES (?, ?)').bind(idMap.get(d.node_id), idMap.get(d.depends_on))));
  // 模版預設成員 → 自動成為新專案成員
  await db.prepare(
    `INSERT OR IGNORE INTO project_members (project_id, user_id, role)
     SELECT DISTINCT project_id, owner_id, 'member' FROM nodes WHERE project_id = ? AND owner_id IS NOT NULL`
  ).bind(projectId).run();
  return nodes.filter(n => n.kind === 'task').length;
}

erpApp.post('/projects/:id/apply-template', async c => {
  const projectId = Number(c.req.param('id'));
  const { template_id } = await c.req.json();
  const t = await c.env.DB.prepare(`SELECT id FROM projects WHERE id = ? AND kind = 'template'`).bind(template_id).first();
  if (!t) return c.json({ error: '找不到模版' }, 404);
  const n = await applyTemplate(c.env.DB, Number(template_id), projectId);
  return c.json({ ok: true, tasks: n });
});

/* ═══ 客戶（Party）═══ */
erpApp.get('/parties', async c => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.*,
       (SELECT COUNT(*) FROM party_contacts pc WHERE pc.party_id = p.id) AS contact_count,
       (SELECT COUNT(*) FROM quotes q WHERE q.party_id = p.id) AS quote_count,
       (SELECT COUNT(*) FROM orders o WHERE o.party_id = p.id) AS order_count
     FROM parties p WHERE p.archived = 0 ORDER BY p.id DESC`
  ).all();
  return c.json(results);
});
erpApp.post('/parties', async c => {
  const u = c.get('user');
  const { name, kind = 'customer', tax_id, phone, email, address, note } = await c.req.json();
  if (!name?.trim()) return c.json({ error: '請輸入名稱' }, 400);
  const r = await c.env.DB.prepare(
    'INSERT INTO parties (name, kind, tax_id, phone, email, address, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(name.trim(), kind, tax_id ?? null, phone ?? null, email ?? null, address ?? null, note ?? null, u.id).run();
  return c.json({ id: r.meta.last_row_id });
});
erpApp.get('/parties/:id', async c => {
  const id = Number(c.req.param('id'));
  const p = await c.env.DB.prepare('SELECT * FROM parties WHERE id = ?').bind(id).first();
  if (!p) return c.json({ error: '找不到客戶' }, 404);
  const contacts = (await c.env.DB.prepare('SELECT * FROM party_contacts WHERE party_id = ? ORDER BY id').bind(id).all()).results;
  const quotes = (await c.env.DB.prepare('SELECT id, quote_no, title, status, total, created_at FROM quotes WHERE party_id = ? ORDER BY id DESC').bind(id).all()).results;
  const orders = (await c.env.DB.prepare('SELECT id, order_no, title, status, total, created_at FROM orders WHERE party_id = ? ORDER BY id DESC').bind(id).all()).results;
  return c.json({ ...p, contacts, quotes, orders });
});
erpApp.patch('/parties/:id', async c => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const sets: string[] = []; const vals: any[] = [];
  for (const k of ['name', 'kind', 'tax_id', 'phone', 'email', 'address', 'note', 'archived'] as const) {
    if (k in body) { sets.push(`${k} = ?`); vals.push(body[k]); }
  }
  if (!sets.length) return c.json({ ok: true });
  vals.push(id);
  await c.env.DB.prepare(`UPDATE parties SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});
erpApp.post('/parties/:id/contacts', async c => {
  const { name, title, phone, email, note } = await c.req.json();
  if (!name?.trim()) return c.json({ error: '請輸入姓名' }, 400);
  const r = await c.env.DB.prepare(
    'INSERT INTO party_contacts (party_id, name, title, phone, email, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(Number(c.req.param('id')), name.trim(), title ?? null, phone ?? null, email ?? null, note ?? null).run();
  return c.json({ id: r.meta.last_row_id });
});
erpApp.delete('/contacts/:id', async c => {
  if (!canWrite(c.get('user'))) return c.json({ error: '權限不足' }, 403);
  await c.env.DB.prepare('DELETE FROM party_contacts WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

/* ═══ 服務項目 ═══ */
erpApp.get('/items', async c => {
  const { results } = await c.env.DB.prepare('SELECT * FROM items ORDER BY active DESC, id DESC').all();
  return c.json(results);
});
erpApp.post('/items', async c => {
  const { name, unit = '式', price = 0, description } = await c.req.json();
  if (!name?.trim()) return c.json({ error: '請輸入名稱' }, 400);
  const r = await c.env.DB.prepare('INSERT INTO items (name, unit, price, description) VALUES (?, ?, ?, ?)')
    .bind(name.trim(), unit, Math.round(Number(price) || 0), description ?? null).run();
  return c.json({ id: r.meta.last_row_id });
});
erpApp.patch('/items/:id', async c => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const sets: string[] = []; const vals: any[] = [];
  for (const k of ['name', 'unit', 'price', 'description', 'active', 'template_project_id'] as const) {
    if (k in body) { sets.push(`${k} = ?`); vals.push(body[k]); }
  }
  if (!sets.length) return c.json({ ok: true });
  vals.push(id);
  await c.env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});

/* ═══ 報價單 ═══ */
erpApp.get('/quotes', async c => {
  const { results } = await c.env.DB.prepare(
    `SELECT q.*, p.name AS party_name FROM quotes q JOIN parties p ON p.id = q.party_id ORDER BY q.id DESC`
  ).all();
  return c.json(results);
});
erpApp.post('/quotes', async c => {
  const u = c.get('user');
  const { party_id, title = '', note, lines = [] } = await c.req.json();
  if (!party_id) return c.json({ error: '請選擇客戶' }, 400);
  const { rows, total } = calcLines(lines);
  const no = await nextNo(c.env.DB, 'quotes', 'QT');
  const r = await c.env.DB.prepare(
    'INSERT INTO quotes (quote_no, party_id, title, note, total, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(no, party_id, title, note ?? null, total, u.id).run();
  const qid = r.meta.last_row_id as number;
  if (rows.length) await c.env.DB.batch(rows.map(l => c.env.DB.prepare(
    'INSERT INTO quote_lines (quote_id, item_id, name, qty, unit, price, amount, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(qid, l.item_id, l.name, l.qty, l.unit, l.price, l.amount, l.sort)));
  await logEvent(c.env.DB, 'quote', qid, '建立', u.id);
  return c.json({ id: qid, quote_no: no });
});
async function quoteWithLines(db: D1Database, id: number) {
  const q = await db.prepare(
    'SELECT q.*, p.name AS party_name FROM quotes q JOIN parties p ON p.id = q.party_id WHERE q.id = ?'
  ).bind(id).first<any>();
  if (!q) return null;
  q.lines = (await db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY sort').bind(id).all()).results;
  q.events = (await db.prepare(
    `SELECT e.action, e.created_at, u.name AS actor FROM txn_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.entity_type = 'quote' AND e.entity_id = ? ORDER BY e.id`
  ).bind(id).all()).results;
  return q;
}
erpApp.get('/quotes/:id', async c => {
  const q = await quoteWithLines(c.env.DB, Number(c.req.param('id')));
  return q ? c.json(q) : c.json({ error: '找不到報價單' }, 404);
});
erpApp.put('/quotes/:id', async c => {
  const id = Number(c.req.param('id'));
  const q = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<any>();
  if (!q) return c.json({ error: '找不到報價單' }, 404);
  if (q.status !== 'draft') return c.json({ error: '只有草稿可以編輯，已送出的報價單請作廢後重開' }, 400);
  const { party_id = q.party_id, title = q.title, note = q.note, lines = [] } = await c.req.json();
  const { rows, total } = calcLines(lines);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE quotes SET party_id = ?, title = ?, note = ?, total = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(party_id, title, note, total, id),
    c.env.DB.prepare('DELETE FROM quote_lines WHERE quote_id = ?').bind(id),
    ...rows.map(l => c.env.DB.prepare(
      'INSERT INTO quote_lines (quote_id, item_id, name, qty, unit, price, amount, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, l.item_id, l.name, l.qty, l.unit, l.price, l.amount, l.sort)),
  ]);
  return c.json({ ok: true });
});
const QUOTE_FLOW: Record<string, string[]> = {
  draft: ['sent', 'void'], sent: ['lost', 'void'], won: [], lost: [], void: [],
};
const QUOTE_ACTION: Record<string, string> = { sent: '送出', lost: '未成交', void: '作廢' };
erpApp.post('/quotes/:id/status', async c => {
  const id = Number(c.req.param('id'));
  const u = c.get('user');
  const { status } = await c.req.json();
  const q = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<any>();
  if (!q) return c.json({ error: '找不到報價單' }, 404);
  if (!QUOTE_FLOW[q.status]?.includes(status)) return c.json({ error: `狀態不能從「${q.status}」變成「${status}」` }, 400);
  await c.env.DB.prepare(
    `UPDATE quotes SET status = ?, updated_at = datetime('now'),
     sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE sent_at END,
     decided_at = CASE WHEN ? IN ('lost','void') THEN datetime('now') ELSE decided_at END
     WHERE id = ?`
  ).bind(status, status, status, id).run();
  await logEvent(c.env.DB, 'quote', id, QUOTE_ACTION[status] ?? status, u.id);
  return c.json({ ok: true });
});
/** 成交：報價單 → 訂單 */
erpApp.post('/quotes/:id/convert', async c => {
  const id = Number(c.req.param('id'));
  const u = c.get('user');
  const q = await quoteWithLines(c.env.DB, id);
  if (!q) return c.json({ error: '找不到報價單' }, 404);
  if (q.status !== 'sent') return c.json({ error: '只有「已送出」的報價單可以標記成交' }, 400);
  const no = await nextNo(c.env.DB, 'orders', 'OD');
  const r = await c.env.DB.prepare(
    'INSERT INTO orders (order_no, quote_id, party_id, title, total, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(no, id, q.party_id, q.title || q.quote_no, q.total, q.note, u.id).run();
  const oid = r.meta.last_row_id as number;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE quotes SET status = 'won', decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(id),
    ...(q.lines as any[]).map((l: any) => c.env.DB.prepare(
      'INSERT INTO order_lines (order_id, item_id, name, qty, unit, price, amount, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(oid, l.item_id, l.name, l.qty, l.unit, l.price, l.amount, l.sort)),
  ]);
  await logEvent(c.env.DB, 'quote', id, '成交', u.id);
  await logEvent(c.env.DB, 'order', oid, `由 ${q.quote_no} 成交建立`, u.id);
  return c.json({ order_id: oid, order_no: no });
});

/* ═══ 訂單 ═══ */
erpApp.get('/orders', async c => {
  const { results } = await c.env.DB.prepare(
    `SELECT o.*, p.name AS party_name FROM orders o JOIN parties p ON p.id = o.party_id ORDER BY o.id DESC`
  ).all();
  return c.json(results);
});
erpApp.get('/orders/:id', async c => {
  const id = Number(c.req.param('id'));
  const o = await c.env.DB.prepare(
    `SELECT o.*, p.name AS party_name, q.quote_no, pr.name AS project_name
     FROM orders o JOIN parties p ON p.id = o.party_id
     LEFT JOIN quotes q ON q.id = o.quote_id
     LEFT JOIN projects pr ON pr.id = o.project_id
     WHERE o.id = ?`
  ).bind(id).first<any>();
  if (!o) return c.json({ error: '找不到訂單' }, 404);
  o.lines = (await c.env.DB.prepare('SELECT * FROM order_lines WHERE order_id = ? ORDER BY sort').bind(id).all()).results;
  o.events = (await c.env.DB.prepare(
    `SELECT e.action, e.created_at, u.name AS actor FROM txn_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.entity_type = 'order' AND e.entity_id = ? ORDER BY e.id`
  ).bind(id).all()).results;
  return c.json(o);
});
const ORDER_FLOW: Record<string, string[]> = {
  active: ['delivered', 'void'], delivered: ['invoiced', 'void'], invoiced: ['paid', 'void'], paid: [], void: [],
};
const ORDER_ACTION: Record<string, string> = { delivered: '已交付', invoiced: '已請款', paid: '已收款', void: '作廢' };
erpApp.post('/orders/:id/status', async c => {
  const id = Number(c.req.param('id'));
  const u = c.get('user');
  const { status } = await c.req.json();
  const o = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<any>();
  if (!o) return c.json({ error: '找不到訂單' }, 404);
  if (!ORDER_FLOW[o.status]?.includes(status)) return c.json({ error: `狀態不能從「${o.status}」變成「${status}」` }, 400);
  await c.env.DB.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, id).run();
  await logEvent(c.env.DB, 'order', id, ORDER_ACTION[status] ?? status, u.id);
  return c.json({ ok: true });
});
/** 訂單 → 開 PM 專案 */
erpApp.post('/orders/:id/create-project', async c => {
  const id = Number(c.req.param('id'));
  const u = c.get('user');
  const o = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<any>();
  if (!o) return c.json({ error: '找不到訂單' }, 404);
  if (o.project_id) return c.json({ error: '這張訂單已經有專案了' }, 400);
  const r = await c.env.DB.prepare('INSERT INTO projects (name, created_by) VALUES (?, ?)')
    .bind(`${o.order_no} ${o.title}`.trim(), u.id).run();
  const pid = r.meta.last_row_id as number;
  await c.env.DB.prepare(`INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'lead')`).bind(pid, u.id).run();
  await c.env.DB.prepare('UPDATE orders SET project_id = ? WHERE id = ?').bind(pid, id).run();
  // 訂單明細裡有掛交付模版的服務 → 自動套用（多個服務多個模版都套）
  const tpls = (await c.env.DB.prepare(
    `SELECT DISTINCT i.template_project_id AS tid FROM order_lines ol
     JOIN items i ON i.id = ol.item_id
     WHERE ol.order_id = ? AND i.template_project_id IS NOT NULL`
  ).bind(id).all()).results as any[];
  let taskCount = 0;
  for (const t of tpls) taskCount += await applyTemplate(c.env.DB, t.tid, pid);
  await logEvent(c.env.DB, 'order', id, tpls.length ? `建立交付專案（套用 ${tpls.length} 個模版、${taskCount} 項任務）` : '建立交付專案', u.id);
  return c.json({ project_id: pid, templates_applied: tpls.length, tasks_created: taskCount });
});
