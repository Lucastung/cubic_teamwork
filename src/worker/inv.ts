/** 庫存與生產：料號主檔（自動編碼）、庫存異動（FEFO 批號扣帳）、BOM、生產單 */
import { Hono } from 'hono';

type User = { id: number; email: string; name: string; color: string; role: 'admin' | 'pm' | 'member' };
interface InvEnv { DB: D1Database; FILES: R2Bucket; ASSETS: Fetcher }
type Ctx = { Bindings: InvEnv; Variables: { user: User } };

export const invApp = new Hono<Ctx>();

const isMgr = (u: User) => u.role === 'admin' || u.role === 'pm';
const logEvent = (db: D1Database, type: string, id: number, action: string, actor: number) =>
  db.prepare('INSERT INTO txn_events (entity_type, entity_id, action, actor_id) VALUES (?, ?, ?, ?)')
    .bind(type, id, action, actor).run();

// 主檔／BOM／生產單的變更需 PM 或管理員；庫存出入庫所有成員都能登記
const mgrWriteGuard = async (c: any, next: any) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) && !isMgr(c.get('user')))
    return c.json({ error: '需要管理員或專案負責人權限' }, 403);
  await next();
};
invApp.use('/mat-categories/*', mgrWriteGuard); invApp.use('/mat-categories', mgrWriteGuard);
invApp.use('/work-orders/*', mgrWriteGuard); invApp.use('/work-orders', mgrWriteGuard);

/* ═══ 料號類別 ═══ */
invApp.get('/mat-categories', async c => {
  const { results } = await c.env.DB.prepare(
    `SELECT mc.*, (SELECT COUNT(*) FROM materials m WHERE m.category_id = mc.id) AS mat_count
     FROM mat_categories mc ORDER BY mc.id`).all();
  return c.json(results);
});
invApp.post('/mat-categories', async c => {
  const { code, name } = await c.req.json();
  if (!code?.trim() || !name?.trim()) return c.json({ error: '請填代碼與名稱' }, 400);
  try {
    const r = await c.env.DB.prepare('INSERT INTO mat_categories (code, name) VALUES (?, ?)')
      .bind(code.trim().toUpperCase(), name.trim()).run();
    return c.json({ id: r.meta.last_row_id });
  } catch { return c.json({ error: '這個代碼已存在' }, 400); }
});

/* ═══ 料號主檔 ═══ */
async function nextMatNo(db: D1Database, catId: number): Promise<string> {
  const cat = await db.prepare('SELECT code FROM mat_categories WHERE id = ?').bind(catId).first<any>();
  if (!cat) throw new Error('找不到料號類別');
  const r = await db.prepare('SELECT COUNT(*) AS n FROM materials WHERE mat_no LIKE ?')
    .bind(`${cat.code}-%`).first<{ n: number }>();
  return `${cat.code}-${String((r?.n ?? 0) + 1).padStart(4, '0')}`;
}

// 清單（含即時庫存與低庫存旗標）
invApp.get('/materials', async c => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, mc.code AS cat_code, mc.name AS cat_name, p.name AS supplier_name,
       COALESCE((SELECT SUM(qty) FROM stock_moves sm WHERE sm.material_id = m.id), 0) AS stock
     FROM materials m JOIN mat_categories mc ON mc.id = m.category_id
     LEFT JOIN parties p ON p.id = m.supplier_id
     ORDER BY m.active DESC, m.mat_no`).all();
  return c.json(results);
});

invApp.post('/materials', mgrWriteGuard, async c => {
  const { category_id, name, spec, unit = '個', safe_stock = 0, cost = 0, supplier_id, location, track_lot = 1, note } = await c.req.json();
  if (!category_id || !name?.trim()) return c.json({ error: '請選類別並填名稱' }, 400);
  const matNo = await nextMatNo(c.env.DB, Number(category_id));
  const r = await c.env.DB.prepare(
    `INSERT INTO materials (mat_no, category_id, name, spec, unit, safe_stock, cost, supplier_id, location, track_lot, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(matNo, Number(category_id), name.trim(), spec ?? null, unit, Number(safe_stock) || 0,
    Math.round(Number(cost) || 0), supplier_id ?? null, location ?? null, track_lot ? 1 : 0, note ?? null).run();
  return c.json({ id: r.meta.last_row_id, mat_no: matNo });
});

invApp.patch('/materials/:id', mgrWriteGuard, async c => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const sets: string[] = []; const vals: any[] = [];
  for (const k of ['name', 'spec', 'unit', 'safe_stock', 'cost', 'supplier_id', 'location', 'track_lot', 'active', 'note'] as const) {
    if (k in body) { sets.push(`${k} = ?`); vals.push(body[k] === '' ? null : body[k]); }
  }
  if (!sets.length) return c.json({ ok: true });
  vals.push(id);
  await c.env.DB.prepare(`UPDATE materials SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});

/** 批號結存（依效期排序，FEFO 用） */
async function lotBalances(db: D1Database, materialId: number) {
  const rows = (await db.prepare(
    `SELECT COALESCE(lot_no, '') AS lot_no, SUM(qty) AS qty, MAX(expiry) AS expiry
     FROM stock_moves WHERE material_id = ? GROUP BY COALESCE(lot_no, '')
     HAVING SUM(qty) > 0.000001
     ORDER BY expiry IS NULL, expiry`).bind(materialId).all()).results as any[];
  return rows;
}

invApp.get('/materials/:id', async c => {
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare(
    `SELECT m.*, mc.code AS cat_code, mc.name AS cat_name, p.name AS supplier_name,
       COALESCE((SELECT SUM(qty) FROM stock_moves sm WHERE sm.material_id = m.id), 0) AS stock
     FROM materials m JOIN mat_categories mc ON mc.id = m.category_id
     LEFT JOIN parties p ON p.id = m.supplier_id WHERE m.id = ?`).bind(id).first<any>();
  if (!m) return c.json({ error: '找不到料號' }, 404);
  m.lots = await lotBalances(c.env.DB, id);
  m.moves = (await c.env.DB.prepare(
    `SELECT sm.*, u.name AS actor, wo.wo_no
     FROM stock_moves sm LEFT JOIN users u ON u.id = sm.created_by
     LEFT JOIN work_orders wo ON sm.ref_type = 'work_order' AND wo.id = sm.ref_id
     WHERE sm.material_id = ? ORDER BY sm.id DESC LIMIT 50`).bind(id).all()).results;
  m.bom = (await c.env.DB.prepare(
    `SELECT b.*, cm.mat_no AS component_no, cm.name AS component_name, cm.unit AS component_unit
     FROM boms b JOIN materials cm ON cm.id = b.component_id WHERE b.product_id = ? ORDER BY b.id`).bind(id).all()).results;
  return c.json(m);
});

/* ═══ 庫存出入庫（所有成員可登記） ═══ */
const REASON_LABEL: Record<string, string> = {
  purchase_in: '採購入庫', manual_out: '領用出庫', production_out: '生產領料',
  production_in: '完工入庫', adjust: '盤點調整', scrap: '報廢',
};
invApp.post('/materials/:id/moves', async c => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT * FROM materials WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: '找不到料號' }, 404);
  const { qty, reason = 'adjust', lot_no, expiry, note } = await c.req.json();
  const q = Number(qty);
  if (!q || !isFinite(q)) return c.json({ error: '請填數量（入庫為正、出庫為負）' }, 400);
  if (!REASON_LABEL[reason]) return c.json({ error: '未知的異動原因' }, 400);
  if (q > 0 && m.track_lot && !lot_no?.trim() && reason !== 'adjust')
    return c.json({ error: '這個料號有批號管理，入庫請填批號' }, 400);
  // 負庫存防呆（整體與批號層級）
  if (q < 0) {
    const total = (await c.env.DB.prepare('SELECT COALESCE(SUM(qty),0) AS s FROM stock_moves WHERE material_id = ?')
      .bind(id).first<any>())!.s;
    if (total + q < -0.000001) return c.json({ error: `庫存不足：目前 ${total}，要出 ${-q}` }, 400);
    if (lot_no?.trim()) {
      const lot = (await c.env.DB.prepare(
        'SELECT COALESCE(SUM(qty),0) AS s FROM stock_moves WHERE material_id = ? AND lot_no = ?')
        .bind(id, lot_no.trim()).first<any>())!.s;
      if (lot + q < -0.000001) return c.json({ error: `批號 ${lot_no} 庫存不足：目前 ${lot}` }, 400);
    }
  }
  const r = await c.env.DB.prepare(
    'INSERT INTO stock_moves (material_id, qty, reason, lot_no, expiry, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, q, reason, lot_no?.trim() || null, expiry || null, note ?? null, u.id).run();
  return c.json({ id: r.meta.last_row_id });
});

/* ═══ BOM ═══ */
invApp.put('/materials/:id/bom', mgrWriteGuard, async c => {
  const id = Number(c.req.param('id'));
  const { lines = [] } = await c.req.json();
  const rows = (lines as any[]).filter(l => l.component_id && Number(l.qty) > 0);
  if (rows.some(l => Number(l.component_id) === id)) return c.json({ error: 'BOM 不能包含自己' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM boms WHERE product_id = ?').bind(id),
    ...rows.map(l => c.env.DB.prepare(
      'INSERT INTO boms (product_id, component_id, qty, note) VALUES (?, ?, ?, ?)'
    ).bind(id, Number(l.component_id), Number(l.qty), l.note ?? null)),
  ]);
  return c.json({ ok: true });
});

/* ═══ 生產單 ═══ */
async function woNextNo(db: D1Database): Promise<string> {
  const year = new Date().getFullYear();
  const r = await db.prepare('SELECT COUNT(*) AS n FROM work_orders WHERE wo_no LIKE ?')
    .bind(`WO-${year}-%`).first<{ n: number }>();
  return `WO-${year}-${String((r?.n ?? 0) + 1).padStart(4, '0')}`;
}

invApp.get('/work-orders', async c => {
  const { results } = await c.env.DB.prepare(
    `SELECT wo.*, m.mat_no, m.name AS product_name, m.unit, pr.name AS project_name
     FROM work_orders wo JOIN materials m ON m.id = wo.product_id
     LEFT JOIN projects pr ON pr.id = wo.project_id
     ORDER BY wo.id DESC`).all();
  return c.json(results);
});

invApp.post('/work-orders', async c => {
  const u = c.get('user');
  const { product_id, qty = 1, project_id, note } = await c.req.json();
  if (!product_id) return c.json({ error: '請選擇要生產的料號' }, 400);
  const bomN = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM boms WHERE product_id = ?')
    .bind(Number(product_id)).first<{ n: number }>();
  if (!bomN?.n) return c.json({ error: '這個料號還沒有 BOM 用料清單，請先到料號明細設定' }, 400);
  const no = await woNextNo(c.env.DB);
  const r = await c.env.DB.prepare(
    'INSERT INTO work_orders (wo_no, product_id, qty, project_id, note, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(no, Number(product_id), Number(qty) || 1, project_id ?? null, note ?? null, u.id).run();
  await logEvent(c.env.DB, 'work_order', r.meta.last_row_id as number, '建立', u.id);
  return c.json({ id: r.meta.last_row_id, wo_no: no });
});

/** 需求 vs 庫存對照 */
async function woRequirements(db: D1Database, wo: any) {
  const bom = (await db.prepare(
    `SELECT b.component_id, b.qty, m.mat_no, m.name, m.unit, m.track_lot,
       COALESCE((SELECT SUM(qty) FROM stock_moves sm WHERE sm.material_id = b.component_id), 0) AS stock
     FROM boms b JOIN materials m ON m.id = b.component_id WHERE b.product_id = ?`).bind(wo.product_id).all()).results as any[];
  return bom.map(b => ({ ...b, need: b.qty * wo.qty, enough: b.stock + 0.000001 >= b.qty * wo.qty }));
}

invApp.get('/work-orders/:id', async c => {
  const id = Number(c.req.param('id'));
  const wo = await c.env.DB.prepare(
    `SELECT wo.*, m.mat_no, m.name AS product_name, m.unit, m.track_lot AS product_track_lot, pr.name AS project_name
     FROM work_orders wo JOIN materials m ON m.id = wo.product_id
     LEFT JOIN projects pr ON pr.id = wo.project_id WHERE wo.id = ?`).bind(id).first<any>();
  if (!wo) return c.json({ error: '找不到生產單' }, 404);
  wo.requirements = await woRequirements(c.env.DB, wo);
  wo.moves = (await c.env.DB.prepare(
    `SELECT sm.*, m.mat_no, m.name AS mat_name FROM stock_moves sm JOIN materials m ON m.id = sm.material_id
     WHERE sm.ref_type = 'work_order' AND sm.ref_id = ? ORDER BY sm.id`).bind(id).all()).results;
  wo.events = (await c.env.DB.prepare(
    `SELECT ev.action, ev.created_at, u.name AS actor FROM txn_events ev LEFT JOIN users u ON u.id = ev.actor_id
     WHERE ev.entity_type = 'work_order' AND ev.entity_id = ? ORDER BY ev.id`).bind(id).all()).results;
  return c.json(wo);
});

// 領料：FEFO——效期最早的批號先扣
invApp.post('/work-orders/:id/action', async c => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const { action, lot_no, expiry } = await c.req.json();
  const wo = await db.prepare('SELECT * FROM work_orders WHERE id = ?').bind(id).first<any>();
  if (!wo) return c.json({ error: '找不到生產單' }, 404);

  if (action === 'start') {
    if (wo.status !== 'draft') return c.json({ error: '只有已建立的生產單可以領料開工' }, 400);
    const reqs = await woRequirements(db, wo);
    const short = reqs.filter(r => !r.enough);
    if (short.length)
      return c.json({ error: `庫存不足：${short.map(s => `${s.name} 需 ${s.need}、現有 ${s.stock}`).join('；')}` }, 400);
    const stmts: D1PreparedStatement[] = [];
    for (const r of reqs) {
      let remain = r.need;
      if (r.track_lot) {
        const lots = await lotBalances(db, r.component_id);
        for (const lot of lots) {
          if (remain <= 0.000001) break;
          const take = Math.min(remain, lot.qty);
          stmts.push(db.prepare(
            `INSERT INTO stock_moves (material_id, qty, reason, lot_no, ref_type, ref_id, created_by)
             VALUES (?, ?, 'production_out', ?, 'work_order', ?, ?)`
          ).bind(r.component_id, -take, lot.lot_no || null, id, u.id));
          remain -= take;
        }
        if (remain > 0.000001) return c.json({ error: `${r.name} 批號結存不足` }, 400);
      } else {
        stmts.push(db.prepare(
          `INSERT INTO stock_moves (material_id, qty, reason, ref_type, ref_id, created_by)
           VALUES (?, ?, 'production_out', 'work_order', ?, ?)`
        ).bind(r.component_id, -remain, id, u.id));
      }
    }
    stmts.push(db.prepare(`UPDATE work_orders SET status = 'in_progress', started_at = datetime('now') WHERE id = ?`).bind(id));
    await db.batch(stmts);
    await logEvent(db, 'work_order', id, '領料開工（FEFO 扣批）', u.id);
    return c.json({ ok: true });
  }
  if (action === 'finish') {
    if (wo.status !== 'in_progress') return c.json({ error: '要先領料開工才能完工入庫' }, 400);
    const prod = await db.prepare('SELECT * FROM materials WHERE id = ?').bind(wo.product_id).first<any>();
    if (prod.track_lot && !lot_no?.trim()) return c.json({ error: '成品有批號管理，請填產出批號' }, 400);
    await db.batch([
      db.prepare(
        `INSERT INTO stock_moves (material_id, qty, reason, lot_no, expiry, ref_type, ref_id, created_by)
         VALUES (?, ?, 'production_in', ?, ?, 'work_order', ?, ?)`
      ).bind(wo.product_id, wo.qty, lot_no?.trim() || null, expiry || null, id, u.id),
      db.prepare(`UPDATE work_orders SET status = 'done', done_at = datetime('now'), lot_no = ?, expiry = ? WHERE id = ?`)
        .bind(lot_no?.trim() || null, expiry || null, id),
    ]);
    await logEvent(db, 'work_order', id, '完工入庫', u.id);
    return c.json({ ok: true });
  }
  if (action === 'void') {
    if (!['draft', 'in_progress'].includes(wo.status)) return c.json({ error: '完工的生產單不能作廢' }, 400);
    const stmts: D1PreparedStatement[] = [];
    if (wo.status === 'in_progress') {
      // 回沖：把已領的料原批號退回
      const moves = (await db.prepare(
        `SELECT * FROM stock_moves WHERE ref_type = 'work_order' AND ref_id = ? AND reason = 'production_out'`
      ).bind(id).all()).results as any[];
      for (const mv of moves) {
        stmts.push(db.prepare(
          `INSERT INTO stock_moves (material_id, qty, reason, lot_no, ref_type, ref_id, note, created_by)
           VALUES (?, ?, 'adjust', ?, 'work_order', ?, '生產單作廢退料', ?)`
        ).bind(mv.material_id, -mv.qty, mv.lot_no, id, u.id));
      }
    }
    stmts.push(db.prepare(`UPDATE work_orders SET status = 'void' WHERE id = ?`).bind(id));
    await db.batch(stmts);
    await logEvent(db, 'work_order', id, wo.status === 'in_progress' ? '作廢（退料回庫）' : '作廢', u.id);
    return c.json({ ok: true });
  }
  return c.json({ error: '未知的動作' }, 400);
});

/* ═══ 庫存警示：低於安全庫存＋30 天內到期批號 ═══ */
invApp.get('/stock-alerts', async c => {
  const low = (await c.env.DB.prepare(
    `SELECT * FROM (
       SELECT m.id, m.mat_no, m.name, m.unit, m.safe_stock,
         COALESCE((SELECT SUM(qty) FROM stock_moves sm WHERE sm.material_id = m.id), 0) AS stock
       FROM materials m WHERE m.active = 1 AND m.safe_stock > 0
     ) WHERE stock < safe_stock ORDER BY stock / safe_stock`).all()).results;
  const expiring = (await c.env.DB.prepare(
    `SELECT m.id, m.mat_no, m.name, m.unit, sm.lot_no, MAX(sm.expiry) AS expiry, SUM(sm.qty) AS qty,
       CAST(julianday(MAX(sm.expiry)) - julianday('now') AS INTEGER) AS days_left
     FROM stock_moves sm JOIN materials m ON m.id = sm.material_id
     WHERE sm.lot_no IS NOT NULL
     GROUP BY sm.material_id, sm.lot_no
     HAVING SUM(sm.qty) > 0.000001 AND MAX(sm.expiry) IS NOT NULL AND days_left <= 30
     ORDER BY days_left`).all()).results;
  return c.json({ low, expiring });
});
