/** 財務：費用報銷（兩層：核准→付款）＋ 請款與收款（含 5% 營業稅） */
import { Hono } from 'hono';
import { verifyPassword, addSignature } from './shared';

type User = { id: number; email: string; name: string; color: string; role: 'admin' | 'pm' | 'member' };
interface FinEnv { DB: D1Database; FILES: R2Bucket; ASSETS: Fetcher }
type Ctx = { Bindings: FinEnv; Variables: { user: User } };

export const finApp = new Hono<Ctx>();

const isMgr = (u: User) => u.role === 'admin' || u.role === 'pm';
const logEvent = (db: D1Database, type: string, id: number, action: string, actor: number) =>
  db.prepare('INSERT INTO txn_events (entity_type, entity_id, action, actor_id) VALUES (?, ?, ?, ?)')
    .bind(type, id, action, actor).run();

async function nextNo(db: D1Database, table: string, col: string, prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} LIKE ?`)
    .bind(`${prefix}-${year}-%`).first<{ n: number }>();
  return `${prefix}-${year}-${String((r?.n ?? 0) + 1).padStart(4, '0')}`;
}

/* ═══════════ 費用報銷 ═══════════ */

type ExpLineIn = { date?: string | null; category?: string; description?: string; amount?: number; project_id?: number | null };
const calcExpLines = (lines: ExpLineIn[]) => {
  const rows = (lines ?? [])
    .filter(l => (l.description ?? '').trim() || Number(l.amount) > 0)
    .map((l, i) => ({
      date: l.date || null,
      category: (l.category ?? '雜項').trim() || '雜項',
      description: (l.description ?? '').trim(),
      amount: Math.round(Number(l.amount) || 0),
      project_id: l.project_id ?? null,
      sort: i,
    }));
  return { rows, total: rows.reduce((s, r) => s + r.amount, 0) };
};

async function expenseFull(db: D1Database, id: number) {
  const e = await db.prepare(
    `SELECT e.*, cu.name AS claimant, au.name AS approver, pu.name AS payer
     FROM expenses e JOIN users cu ON cu.id = e.claimant_id
     LEFT JOIN users au ON au.id = e.approved_by
     LEFT JOIN users pu ON pu.id = e.paid_by
     WHERE e.id = ?`).bind(id).first<any>();
  if (!e) return null;
  e.lines = (await db.prepare(
    `SELECT l.*, p.name AS project_name FROM expense_lines l
     LEFT JOIN projects p ON p.id = l.project_id
     WHERE l.expense_id = ? ORDER BY l.sort`).bind(id).all()).results;
  e.receipts = (await db.prepare(
    'SELECT id, file_key, file_name, created_at FROM expense_receipts WHERE expense_id = ? ORDER BY id').bind(id).all()).results;
  e.signatures = (await db.prepare(
    `SELECT s.action, s.note, s.content_hash, s.chain_hash, s.created_at, u.name AS signer
     FROM signatures s JOIN users u ON u.id = s.signer_id
     WHERE s.entity_type = 'expense' AND s.entity_id = ? ORDER BY s.id`).bind(id).all()).results;
  e.events = (await db.prepare(
    `SELECT ev.action, ev.created_at, u.name AS actor FROM txn_events ev LEFT JOIN users u ON u.id = ev.actor_id
     WHERE ev.entity_type = 'expense' AND ev.entity_id = ? ORDER BY ev.id`).bind(id).all()).results;
  return e;
}

// 清單：一般成員只看自己的；PM／管理員看全部。?box=todo 回傳「待我處理」
finApp.get('/expenses', async c => {
  const u = c.get('user');
  const box = c.req.query('box');
  if (box === 'todo') {
    const to_approve = isMgr(u) ? (await c.env.DB.prepare(
      `SELECT e.id, e.exp_no, e.title, e.total, e.submitted_at, u2.name AS claimant
       FROM expenses e JOIN users u2 ON u2.id = e.claimant_id
       WHERE e.status = 'submitted' AND e.claimant_id != ? ORDER BY e.submitted_at`).bind(u.id).all()).results : [];
    const to_pay = u.role === 'admin' ? (await c.env.DB.prepare(
      `SELECT e.id, e.exp_no, e.title, e.total, e.approved_at, u2.name AS claimant
       FROM expenses e JOIN users u2 ON u2.id = e.claimant_id
       WHERE e.status = 'approved' ORDER BY e.approved_at`).all()).results : [];
    return c.json({ to_approve, to_pay });
  }
  const base = `SELECT e.id, e.exp_no, e.title, e.status, e.total, e.created_at, e.submitted_at, e.reject_note, u2.name AS claimant, e.claimant_id
     FROM expenses e JOIN users u2 ON u2.id = e.claimant_id`;
  const { results } = isMgr(u)
    ? await c.env.DB.prepare(`${base} ORDER BY e.id DESC`).all()
    : await c.env.DB.prepare(`${base} WHERE e.claimant_id = ? ORDER BY e.id DESC`).bind(u.id).all();
  return c.json(results);
});

finApp.post('/expenses', async c => {
  const u = c.get('user');
  const { title = '', note, lines = [] } = await c.req.json();
  const { rows, total } = calcExpLines(lines);
  const no = await nextNo(c.env.DB, 'expenses', 'exp_no', 'EX');
  const r = await c.env.DB.prepare(
    'INSERT INTO expenses (exp_no, claimant_id, title, note, total) VALUES (?, ?, ?, ?, ?)'
  ).bind(no, u.id, String(title).trim(), note ?? null, total).run();
  const eid = r.meta.last_row_id as number;
  if (rows.length) await c.env.DB.batch(rows.map(l => c.env.DB.prepare(
    'INSERT INTO expense_lines (expense_id, date, category, description, amount, project_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(eid, l.date, l.category, l.description, l.amount, l.project_id, l.sort)));
  await logEvent(c.env.DB, 'expense', eid, '建立', u.id);
  return c.json({ id: eid, exp_no: no });
});

const canSeeExpense = (u: User, e: any) => isMgr(u) || e.claimant_id === u.id;

finApp.get('/expenses/:id', async c => {
  const e = await expenseFull(c.env.DB, Number(c.req.param('id')));
  if (!e) return c.json({ error: '找不到報銷單' }, 404);
  if (!canSeeExpense(c.get('user'), e)) return c.json({ error: '權限不足' }, 403);
  return c.json(e);
});

finApp.put('/expenses/:id', async c => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const e = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first<any>();
  if (!e) return c.json({ error: '找不到報銷單' }, 404);
  if (e.claimant_id !== u.id) return c.json({ error: '只有申請人可以編輯' }, 403);
  if (e.status !== 'draft') return c.json({ error: '只有草稿可以編輯（已送審請先抽回）' }, 400);
  const { title = e.title, note = e.note, lines = [] } = await c.req.json();
  const { rows, total } = calcExpLines(lines);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE expenses SET title = ?, note = ?, total = ? WHERE id = ?')
      .bind(String(title).trim(), note, total, id),
    c.env.DB.prepare('DELETE FROM expense_lines WHERE expense_id = ?').bind(id),
    ...rows.map(l => c.env.DB.prepare(
      'INSERT INTO expense_lines (expense_id, date, category, description, amount, project_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, l.date, l.category, l.description, l.amount, l.project_id, l.sort)),
  ]);
  return c.json({ ok: true });
});

// 憑證：前端先 POST /api/files 拿 key，再掛到報銷單
finApp.post('/expenses/:id/receipts', async c => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const e = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first<any>();
  if (!e) return c.json({ error: '找不到報銷單' }, 404);
  if (e.claimant_id !== u.id) return c.json({ error: '只有申請人可以附憑證' }, 403);
  if (!['draft', 'submitted'].includes(e.status)) return c.json({ error: '已核准的單不能再改憑證' }, 400);
  const { file_key, file_name } = await c.req.json();
  if (!file_key) return c.json({ error: '缺少檔案' }, 400);
  const r = await c.env.DB.prepare(
    'INSERT INTO expense_receipts (expense_id, file_key, file_name) VALUES (?, ?, ?)'
  ).bind(id, file_key, file_name ?? null).run();
  return c.json({ id: r.meta.last_row_id });
});
finApp.delete('/expenses/:id/receipts/:rid', async c => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const e = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first<any>();
  if (!e) return c.json({ error: '找不到報銷單' }, 404);
  if (e.claimant_id !== u.id || !['draft', 'submitted'].includes(e.status))
    return c.json({ error: '權限不足' }, 403);
  await c.env.DB.prepare('DELETE FROM expense_receipts WHERE id = ? AND expense_id = ?')
    .bind(Number(c.req.param('rid')), id).run();
  return c.json({ ok: true });
});

// 動作：submit 送審｜withdraw 抽回｜approve 核准｜reject 退回｜pay 付款｜void 作廢
finApp.post('/expenses/:id/action', async c => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const { action, password, note } = await c.req.json();
  const e = await db.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first<any>();
  if (!e) return c.json({ error: '找不到報銷單' }, 404);

  const checkPassword = async () => {
    const me = await db.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first<any>();
    return password && (await verifyPassword(String(password), me.password_hash));
  };
  const sigContent = { entity: 'expense', id, exp_no: e.exp_no, title: e.title, total: e.total, claimant_id: e.claimant_id };

  switch (action) {
    case 'submit': {
      if (e.claimant_id !== u.id) return c.json({ error: '只有申請人可以送審' }, 403);
      if (e.status !== 'draft') return c.json({ error: '只有草稿可以送審' }, 400);
      if (!e.total) return c.json({ error: '報銷金額是 0，請先填明細' }, 400);
      await db.prepare(`UPDATE expenses SET status = 'submitted', submitted_at = datetime('now'), reject_note = NULL WHERE id = ?`).bind(id).run();
      await logEvent(db, 'expense', id, '送審', u.id);
      return c.json({ ok: true });
    }
    case 'withdraw': {
      if (e.claimant_id !== u.id) return c.json({ error: '只有申請人可以抽回' }, 403);
      if (e.status !== 'submitted') return c.json({ error: '只有送審中的單可以抽回' }, 400);
      await db.prepare(`UPDATE expenses SET status = 'draft', submitted_at = NULL WHERE id = ?`).bind(id).run();
      await logEvent(db, 'expense', id, '抽回', u.id);
      return c.json({ ok: true });
    }
    case 'approve': {
      if (!isMgr(u)) return c.json({ error: '需要專案負責人或管理員權限' }, 403);
      if (e.claimant_id === u.id) return c.json({ error: '不能核准自己的報銷單' }, 403);
      if (e.status !== 'submitted') return c.json({ error: '只有送審中的單可以核准' }, 400);
      if (!(await checkPassword())) return c.json({ error: '密碼錯誤，核准需驗證本人' }, 401);
      await addSignature(db, 'expense', id, 'sign', u.id, note ?? null, sigContent);
      await db.prepare(`UPDATE expenses SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?`).bind(u.id, id).run();
      await logEvent(db, 'expense', id, '核准', u.id);
      return c.json({ ok: true });
    }
    case 'reject': {
      if (!isMgr(u)) return c.json({ error: '需要專案負責人或管理員權限' }, 403);
      if (e.claimant_id === u.id) return c.json({ error: '不能審核自己的報銷單' }, 403);
      if (e.status !== 'submitted') return c.json({ error: '只有送審中的單可以退回' }, 400);
      if (!note?.trim()) return c.json({ error: '退回請填寫原因' }, 400);
      await addSignature(db, 'expense', id, 'reject', u.id, note.trim(), sigContent);
      await db.prepare(`UPDATE expenses SET status = 'draft', submitted_at = NULL, reject_note = ? WHERE id = ?`).bind(note.trim(), id).run();
      await logEvent(db, 'expense', id, '退回', u.id);
      return c.json({ ok: true });
    }
    case 'pay': {
      if (u.role !== 'admin') return c.json({ error: '需要管理員權限' }, 403);
      if (e.status !== 'approved') return c.json({ error: '只有已核准的單可以標記付款' }, 400);
      if (!(await checkPassword())) return c.json({ error: '密碼錯誤，付款確認需驗證本人' }, 401);
      await addSignature(db, 'expense', id, 'close', u.id, note ?? null,
        { ...sigContent, approved_by: e.approved_by, approved_at: e.approved_at });
      await db.prepare(`UPDATE expenses SET status = 'paid', paid_by = ?, paid_at = datetime('now') WHERE id = ?`).bind(u.id, id).run();
      await logEvent(db, 'expense', id, '已付款', u.id);
      return c.json({ ok: true });
    }
    case 'void': {
      const ok = (e.claimant_id === u.id && e.status === 'draft') || u.role === 'admin';
      if (!ok) return c.json({ error: '權限不足' }, 403);
      if (e.status === 'paid') return c.json({ error: '已付款的單不能作廢' }, 400);
      await db.prepare(`UPDATE expenses SET status = 'void' WHERE id = ?`).bind(id).run();
      await logEvent(db, 'expense', id, '作廢', u.id);
      return c.json({ ok: true });
    }
    default:
      return c.json({ error: '未知的動作' }, 400);
  }
});

/* ═══════════ 請款與收款 ═══════════ */

const invWriteGuard = async (c: any, next: any) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) && !isMgr(c.get('user')))
    return c.json({ error: '需要管理員或專案負責人權限' }, 403);
  await next();
};
finApp.use('/invoices/*', invWriteGuard); finApp.use('/invoices', invWriteGuard);
finApp.use('/payments/*', invWriteGuard);

type InvLineIn = { item_id?: number | null; name: string; qty: number; unit: string; price: number };
const calcInvLines = (lines: InvLineIn[], taxRate: number) => {
  const rows = (lines ?? []).filter(l => l.name?.trim()).map((l, i) => ({
    item_id: l.item_id ?? null, name: l.name.trim(),
    qty: Number(l.qty) || 1, unit: l.unit || '式',
    price: Math.round(Number(l.price) || 0),
    amount: Math.round((Number(l.qty) || 1) * (Number(l.price) || 0)),
    sort: i,
  }));
  const amount = rows.reduce((s, r) => s + r.amount, 0);
  const tax = Math.round(amount * taxRate);
  return { rows, amount, tax, total: amount + tax };
};

async function invoiceFull(db: D1Database, id: number) {
  const inv = await db.prepare(
    `SELECT i.*, p.name AS party_name, p.tax_id AS party_tax_id, o.order_no
     FROM invoices i JOIN parties p ON p.id = i.party_id
     LEFT JOIN orders o ON o.id = i.order_id WHERE i.id = ?`).bind(id).first<any>();
  if (!inv) return null;
  inv.lines = (await db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort').bind(id).all()).results;
  inv.payments = (await db.prepare(
    `SELECT pm.*, u.name AS creator FROM payments pm LEFT JOIN users u ON u.id = pm.created_by
     WHERE pm.invoice_id = ? ORDER BY pm.date, pm.id`).bind(id).all()).results;
  inv.paid = (inv.payments as any[]).reduce((s: number, p: any) => s + p.amount, 0);
  inv.events = (await db.prepare(
    `SELECT ev.action, ev.created_at, u.name AS actor FROM txn_events ev LEFT JOIN users u ON u.id = ev.actor_id
     WHERE ev.entity_type = 'invoice' AND ev.entity_id = ? ORDER BY ev.id`).bind(id).all()).results;
  return inv;
}

/** 依收款總額重算請款單狀態，並帶動訂單狀態 */
async function refreshInvoiceStatus(db: D1Database, id: number, actor: number) {
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first<any>();
  if (!inv || ['draft', 'void'].includes(inv.status)) return;
  const paid = (await db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id = ?')
    .bind(id).first<{ s: number }>())!.s;
  const next = paid >= inv.total && inv.total > 0 ? 'paid' : paid > 0 ? 'partial' : 'issued';
  if (next !== inv.status) {
    await db.prepare(`UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(next, id).run();
    if (next === 'paid') await logEvent(db, 'invoice', id, '已收齊款項', actor);
  }
  // 訂單帶動：全部請款單都收齊且累計收款 >= 訂單金額 → 訂單標記已收款
  if (inv.order_id) {
    const o = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(inv.order_id).first<any>();
    if (o && o.status === 'invoiced') {
      const agg = await db.prepare(
        `SELECT COALESCE(SUM(pm.amount),0) AS paid FROM payments pm
         JOIN invoices i ON i.id = pm.invoice_id WHERE i.order_id = ? AND i.status != 'void'`
      ).bind(inv.order_id).first<{ paid: number }>();
      if ((agg?.paid ?? 0) >= o.total && o.total > 0) {
        await db.prepare(`UPDATE orders SET status = 'paid', updated_at = datetime('now') WHERE id = ?`).bind(o.id).run();
        await logEvent(db, 'order', o.id, '已收款（請款單全數收齊）', actor);
      }
    }
  }
}

// 清單（?order_id= 過濾）
finApp.get('/invoices', async c => {
  const orderId = c.req.query('order_id');
  const base = `SELECT i.*, p.name AS party_name, o.order_no,
      (SELECT COALESCE(SUM(amount),0) FROM payments pm WHERE pm.invoice_id = i.id) AS paid
     FROM invoices i JOIN parties p ON p.id = i.party_id
     LEFT JOIN orders o ON o.id = i.order_id`;
  const { results } = orderId
    ? await c.env.DB.prepare(`${base} WHERE i.order_id = ? ORDER BY i.id DESC`).bind(Number(orderId)).all()
    : await c.env.DB.prepare(`${base} ORDER BY i.id DESC`).all();
  return c.json(results);
});

finApp.post('/invoices', async c => {
  const u = c.get('user');
  const { order_id, party_id, title = '', lines = [], tax_rate = 0.05, gui_no, issue_date, due_date, note } = await c.req.json();
  let pid = party_id;
  if (order_id && !pid) {
    const o = await c.env.DB.prepare('SELECT party_id FROM orders WHERE id = ?').bind(order_id).first<any>();
    pid = o?.party_id;
  }
  if (!pid) return c.json({ error: '請選擇客戶' }, 400);
  const rate = Number(tax_rate) || 0;
  const { rows, amount, tax, total } = calcInvLines(lines, rate);
  const no = await nextNo(c.env.DB, 'invoices', 'inv_no', 'IN');
  const r = await c.env.DB.prepare(
    `INSERT INTO invoices (inv_no, order_id, party_id, title, amount, tax, total, tax_rate, gui_no, issue_date, due_date, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(no, order_id ?? null, pid, String(title).trim(), amount, tax, total, rate,
    gui_no ?? null, issue_date ?? null, due_date ?? null, note ?? null, u.id).run();
  const iid = r.meta.last_row_id as number;
  if (rows.length) await c.env.DB.batch(rows.map(l => c.env.DB.prepare(
    'INSERT INTO invoice_lines (invoice_id, item_id, name, qty, unit, price, amount, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(iid, l.item_id, l.name, l.qty, l.unit, l.price, l.amount, l.sort)));
  await logEvent(c.env.DB, 'invoice', iid, order_id ? '由訂單建立' : '建立', u.id);
  return c.json({ id: iid, inv_no: no });
});

finApp.get('/invoices/:id', async c => {
  const inv = await invoiceFull(c.env.DB, Number(c.req.param('id')));
  return inv ? c.json(inv) : c.json({ error: '找不到請款單' }, 404);
});

finApp.put('/invoices/:id', async c => {
  const id = Number(c.req.param('id'));
  const inv = await c.env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first<any>();
  if (!inv) return c.json({ error: '找不到請款單' }, 404);
  if (inv.status !== 'draft') return c.json({ error: '只有草稿可以編輯，已送出請作廢重開' }, 400);
  const body = await c.req.json();
  const rate = Number(body.tax_rate ?? inv.tax_rate) || 0;
  const { rows, amount, tax, total } = calcInvLines(body.lines ?? [], rate);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE invoices SET party_id = ?, title = ?, amount = ?, tax = ?, total = ?, tax_rate = ?,
       gui_no = ?, issue_date = ?, due_date = ?, note = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(body.party_id ?? inv.party_id, String(body.title ?? inv.title).trim(), amount, tax, total, rate,
      body.gui_no ?? inv.gui_no, body.issue_date ?? inv.issue_date, body.due_date ?? inv.due_date, body.note ?? inv.note, id),
    c.env.DB.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').bind(id),
    ...rows.map(l => c.env.DB.prepare(
      'INSERT INTO invoice_lines (invoice_id, item_id, name, qty, unit, price, amount, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, l.item_id, l.name, l.qty, l.unit, l.price, l.amount, l.sort)),
  ]);
  return c.json({ ok: true });
});

// 狀態：draft → issued｜void；issued/partial → void（partial/paid 由收款自動算）
finApp.post('/invoices/:id/status', async c => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const { status } = await c.req.json();
  const inv = await c.env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first<any>();
  if (!inv) return c.json({ error: '找不到請款單' }, 404);
  const allowed: Record<string, string[]> = { draft: ['issued', 'void'], issued: ['void'], partial: ['void'] };
  if (!allowed[inv.status]?.includes(status)) return c.json({ error: `狀態不能從「${inv.status}」變成「${status}」` }, 400);
  if (status === 'issued' && !inv.total) return c.json({ error: '請款金額是 0，請先填明細' }, 400);
  await c.env.DB.prepare(
    `UPDATE invoices SET status = ?, issue_date = CASE WHEN ? = 'issued' AND issue_date IS NULL THEN date('now') ELSE issue_date END,
     updated_at = datetime('now') WHERE id = ?`
  ).bind(status, status, id).run();
  await logEvent(c.env.DB, 'invoice', id, status === 'issued' ? '送出請款' : '作廢', u.id);
  // 訂單帶動：已交付的訂單第一次送出請款 → 標記已請款
  if (status === 'issued' && inv.order_id) {
    const o = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(inv.order_id).first<any>();
    if (o && o.status === 'delivered') {
      await c.env.DB.prepare(`UPDATE orders SET status = 'invoiced', updated_at = datetime('now') WHERE id = ?`).bind(o.id).run();
      await logEvent(c.env.DB, 'order', o.id, `已請款（${inv.inv_no}）`, u.id);
    }
  }
  return c.json({ ok: true });
});

// 收款登記
finApp.post('/invoices/:id/payments', async c => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const inv = await c.env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first<any>();
  if (!inv) return c.json({ error: '找不到請款單' }, 404);
  if (!['issued', 'partial'].includes(inv.status)) return c.json({ error: '只有已送出的請款單可以登記收款' }, 400);
  const { date, amount, method = '匯款', note } = await c.req.json();
  const amt = Math.round(Number(amount) || 0);
  if (!date || amt <= 0) return c.json({ error: '請填收款日期與金額' }, 400);
  const r = await c.env.DB.prepare(
    'INSERT INTO payments (invoice_id, date, amount, method, note, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, date, amt, method, note ?? null, u.id).run();
  await logEvent(c.env.DB, 'invoice', id, `收款 ${amt.toLocaleString()}（${method}）`, u.id);
  await refreshInvoiceStatus(c.env.DB, id, u.id);
  return c.json({ id: r.meta.last_row_id });
});
finApp.delete('/payments/:id', async c => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const p = await c.env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(id).first<any>();
  if (!p) return c.json({ error: '找不到收款紀錄' }, 404);
  await c.env.DB.prepare('DELETE FROM payments WHERE id = ?').bind(id).run();
  await logEvent(c.env.DB, 'invoice', p.invoice_id, '刪除收款紀錄', u.id);
  await refreshInvoiceStatus(c.env.DB, p.invoice_id, u.id);
  return c.json({ ok: true });
});

// 應收帳款總覽（未收清的請款單，含帳齡天數）
finApp.get('/ar', async c => {
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.inv_no, i.title, i.status, i.total, i.due_date, i.issue_date, p.name AS party_name, o.order_no,
       (SELECT COALESCE(SUM(amount),0) FROM payments pm WHERE pm.invoice_id = i.id) AS paid,
       CAST(julianday('now') - julianday(COALESCE(i.due_date, i.issue_date)) AS INTEGER) AS overdue_days
     FROM invoices i JOIN parties p ON p.id = i.party_id
     LEFT JOIN orders o ON o.id = i.order_id
     WHERE i.status IN ('issued','partial') ORDER BY COALESCE(i.due_date, i.issue_date)`
  ).all();
  return c.json(results);
});
