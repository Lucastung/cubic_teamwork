/** 人事管理：個人資料／密碼／頭像／專長標籤／差勤請假 */
import { Hono } from 'hono';
import { hashPassword, verifyPassword } from './shared';

type User = { id: number; email: string; name: string; color: string; role: 'admin' | 'pm' | 'member' };
interface HrEnv { DB: D1Database; FILES: R2Bucket; ASSETS: Fetcher }
type Ctx = { Bindings: HrEnv; Variables: { user: User } };

export const hrApp = new Hono<Ctx>();

const isMgr = (u: User) => u.role === 'admin' || u.role === 'pm';
const logEvent = (db: D1Database, type: string, id: number, action: string, actor: number) =>
  db.prepare('INSERT INTO txn_events (entity_type, entity_id, action, actor_id) VALUES (?, ?, ?, ?)')
    .bind(type, id, action, actor).run();

export const LEAVE_KINDS = ['事假', '病假', '特休', '公假', '婚假', '喪假', '其他'];

/* ═══ 個人資料 ═══ */
hrApp.get('/me/profile', async c => {
  const u = c.get('user');
  const row = await c.env.DB.prepare(
    'SELECT id, email, name, color, role, phone, address, emergency, avatar_key FROM users WHERE id = ?'
  ).bind(u.id).first<any>();
  row.skills = (await c.env.DB.prepare(
    `SELECT t.id, t.name FROM user_skills us JOIN skill_tags t ON t.id = us.tag_id WHERE us.user_id = ? ORDER BY t.name`
  ).bind(u.id).all()).results;
  return c.json(row);
});

hrApp.patch('/me/profile', async c => {
  const u = c.get('user');
  const body = await c.req.json();
  const sets: string[] = []; const vals: any[] = [];
  for (const k of ['name', 'color', 'phone', 'address', 'emergency', 'avatar_key'] as const) {
    if (k in body) { sets.push(`${k} = ?`); vals.push(body[k] === '' ? null : body[k]); }
  }
  if (!sets.length) return c.json({ ok: true });
  vals.push(u.id);
  await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});

hrApp.post('/me/password', async c => {
  const u = c.get('user');
  const { old_password, new_password } = await c.req.json();
  if (!new_password || new_password.length < 8) return c.json({ error: '新密碼至少 8 碼' }, 400);
  const me = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(u.id).first<any>();
  if (!old_password || !(await verifyPassword(String(old_password), me.password_hash)))
    return c.json({ error: '目前密碼錯誤' }, 401);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(String(new_password)), u.id).run();
  return c.json({ ok: true, note: '密碼已更新' });
});

/* ═══ 專長標籤 ═══ */
hrApp.get('/skill-tags', async c => {
  const tags = (await c.env.DB.prepare(
    `SELECT t.id, t.name, (SELECT COUNT(*) FROM user_skills us WHERE us.tag_id = t.id) AS user_count
     FROM skill_tags t ORDER BY t.name`).all()).results;
  return c.json(tags);
});
hrApp.post('/skill-tags', async c => {
  if (c.get('user').role !== 'admin') return c.json({ error: '需要管理員權限' }, 403);
  const { name } = await c.req.json();
  if (!name?.trim()) return c.json({ error: '請輸入標籤名稱' }, 400);
  try {
    const r = await c.env.DB.prepare('INSERT INTO skill_tags (name) VALUES (?)').bind(name.trim()).run();
    return c.json({ id: r.meta.last_row_id });
  } catch { return c.json({ error: '這個標籤已存在' }, 400); }
});
hrApp.delete('/skill-tags/:id', async c => {
  if (c.get('user').role !== 'admin') return c.json({ error: '需要管理員權限' }, 403);
  await c.env.DB.prepare('DELETE FROM skill_tags WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// 全成員的專長對照（人員列表、任務配發參考用）
hrApp.get('/user-skills', async c => {
  const { results } = await c.env.DB.prepare(
    `SELECT us.user_id, t.id AS tag_id, t.name FROM user_skills us JOIN skill_tags t ON t.id = us.tag_id ORDER BY t.name`
  ).all();
  return c.json(results);
});
// 指派某成員的專長（管理員）
hrApp.put('/users/:id/skills', async c => {
  if (c.get('user').role !== 'admin') return c.json({ error: '需要管理員權限' }, 403);
  const uid = Number(c.req.param('id'));
  const { tag_ids = [] } = await c.req.json();
  await c.env.DB.prepare('DELETE FROM user_skills WHERE user_id = ?').bind(uid).run();
  if (tag_ids.length) await c.env.DB.batch((tag_ids as number[]).map(t =>
    c.env.DB.prepare('INSERT OR IGNORE INTO user_skills (user_id, tag_id) VALUES (?, ?)').bind(uid, t)));
  return c.json({ ok: true });
});

/* ═══ 差勤（請假）═══ */
function calcDays(sd: string, sh: string, ed: string, eh: string): number {
  const d1 = new Date(sd + 'T00:00:00'), d2 = new Date(ed + 'T00:00:00');
  const span = Math.round((d2.getTime() - d1.getTime()) / 86400000);
  if (span < 0) return -1;
  let days = span + 1;
  if (sh === 'pm') days -= 0.5;
  if (eh === 'am') days -= 0.5;
  return days;
}

const LS_LABEL: Record<string, string> = { pending: '送出', approved: '核准', rejected: '退回', cancelled: '取消' };

hrApp.get('/leaves', async c => {
  const u = c.get('user');
  const scope = c.req.query('scope');
  const base = `SELECT l.*, u2.name AS user_name, au.name AS approver
     FROM leaves l JOIN users u2 ON u2.id = l.user_id LEFT JOIN users au ON au.id = l.approved_by`;
  if (scope === 'pending') {
    if (!isMgr(u)) return c.json([]);
    const { results } = await c.env.DB.prepare(
      `${base} WHERE l.status = 'pending' AND l.user_id != ? ORDER BY l.start_date`).bind(u.id).all();
    return c.json(results);
  }
  if (scope === 'all') {
    if (!isMgr(u)) return c.json({ error: '權限不足' }, 403);
    const { results } = await c.env.DB.prepare(`${base} ORDER BY l.id DESC LIMIT 200`).all();
    return c.json(results);
  }
  const { results } = await c.env.DB.prepare(`${base} WHERE l.user_id = ? ORDER BY l.id DESC`).bind(u.id).all();
  return c.json(results);
});

hrApp.post('/leaves', async c => {
  const u = c.get('user');
  const { kind = '事假', start_date, start_half = 'am', end_date, end_half = 'pm', reason } = await c.req.json();
  if (!start_date || !end_date) return c.json({ error: '請選擇起訖日期' }, 400);
  const days = calcDays(start_date, start_half, end_date, end_half);
  if (days <= 0) return c.json({ error: '起訖日期／時段不合理' }, 400);
  const r = await c.env.DB.prepare(
    `INSERT INTO leaves (user_id, kind, start_date, start_half, end_date, end_half, days, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(u.id, kind, start_date, start_half, end_date, end_half, days, reason ?? null).run();
  const id = r.meta.last_row_id as number;
  await logEvent(c.env.DB, 'leave', id, '送出', u.id);
  return c.json({ id, days });
});

hrApp.post('/leaves/:id/action', async c => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const { action, note } = await c.req.json();
  const l = await c.env.DB.prepare('SELECT * FROM leaves WHERE id = ?').bind(id).first<any>();
  if (!l) return c.json({ error: '找不到請假單' }, 404);

  if (action === 'cancel') {
    const ok = (l.user_id === u.id && l.status === 'pending') || (u.role === 'admin' && ['pending', 'approved'].includes(l.status));
    if (!ok) return c.json({ error: '只有待核准的假單可以由本人取消' }, 403);
    await c.env.DB.prepare(`UPDATE leaves SET status = 'cancelled' WHERE id = ?`).bind(id).run();
    await logEvent(c.env.DB, 'leave', id, '取消', u.id);
    return c.json({ ok: true });
  }
  if (action === 'approve' || action === 'reject') {
    if (!isMgr(u)) return c.json({ error: '需要專案負責人或管理員權限' }, 403);
    if (l.user_id === u.id) return c.json({ error: '不能核准自己的請假單' }, 403);
    if (l.status !== 'pending') return c.json({ error: '只有待核准的假單可以處理' }, 400);
    if (action === 'reject' && !note?.trim()) return c.json({ error: '退回請填寫原因' }, 400);
    await c.env.DB.prepare(
      `UPDATE leaves SET status = ?, approved_by = ?, approved_at = datetime('now'), note = ? WHERE id = ?`
    ).bind(action === 'approve' ? 'approved' : 'rejected', u.id, note?.trim() || null, id).run();
    await logEvent(c.env.DB, 'leave', id, action === 'approve' ? '核准' : '退回', u.id);
    return c.json({ ok: true });
  }
  return c.json({ error: '未知的動作' }, 400);
});
