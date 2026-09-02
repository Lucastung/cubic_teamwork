/** 備份與還原引擎：全表 JSON 傾印／依 FK 順序還原／FTS 重建 */

export const BACKUP_MARKER = 'cubic_teamwork_backup';

/** FK 安全順序（父表在前） */
const TABLES = [
  'users', 'skill_tags', 'user_skills', 'leaves', 'tpl_classes', 'folders', 'projects', 'project_members',
  'nodes', 'deps', 'parties', 'party_contacts', 'items',
  'quotes', 'quote_lines', 'orders', 'order_lines',
  'mat_categories', 'materials', 'stock_moves', 'boms', 'work_orders',
  'expenses', 'expense_lines', 'expense_receipts',
  'invoices', 'invoice_lines', 'payments',
  'docs', 'doc_versions', 'doc_perms', 'doc_links', 'files',
  'txn_events', 'signatures', 'comments',
];

export async function dumpAll(db: D1Database) {
  const tables: Record<string, any[]> = {};
  for (const t of TABLES) {
    tables[t] = (await db.prepare(`SELECT * FROM ${t}`).all()).results as any[];
  }
  return {
    marker: BACKUP_MARKER,
    format: 1,
    exported_at: new Date().toISOString(),
    tables,
  };
}

export function validateBackup(data: any): string | null {
  if (!data || data.marker !== BACKUP_MARKER || typeof data.tables !== 'object')
    return '這不是有效的系統備份檔';
  for (const t of TABLES) {
    if (data.tables[t] !== undefined && !Array.isArray(data.tables[t]))
      return `備份檔的 ${t} 資料格式錯誤`;
  }
  if (!Array.isArray(data.tables.users) || data.tables.users.length === 0)
    return '備份檔沒有使用者資料，拒絕還原（會把所有人鎖在系統外）';
  return null;
}

export async function restoreAll(db: D1Database, data: any) {
  // 1) 反向清空（含 sessions 與 FTS）
  await db.prepare('DELETE FROM sessions').run();
  await db.prepare('DELETE FROM docs_fts').run();
  for (const t of [...TABLES].reverse()) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  // 2) 依序回填（分批，每批 40 列）
  let restored = 0;
  for (const t of TABLES) {
    const rows: any[] = data.tables[t] ?? [];
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    const stmt = db.prepare(
      `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    );
    for (let i = 0; i < rows.length; i += 40) {
      const chunk = rows.slice(i, i + 40);
      await db.batch(chunk.map(row => stmt.bind(...cols.map(c => row[c] ?? null))));
      restored += chunk.length;
    }
  }
  // 3) 重建全文索引
  const docs = (await db.prepare(
    `SELECT d.id, d.title, d.doc_no, v.content_text FROM docs d
     LEFT JOIN doc_versions v ON v.id = d.current_version_id`
  ).all()).results as any[];
  for (let i = 0; i < docs.length; i += 40) {
    const chunk = docs.slice(i, i + 40);
    await db.batch(chunk.map(d => db.prepare(
      'INSERT INTO docs_fts (rowid, title, body) VALUES (?, ?, ?)'
    ).bind(d.id, `${d.doc_no ? d.doc_no + ' ' : ''}${d.title ?? ''}`, d.content_text ?? '')));
  }
  return restored;
}

/* ── 附件備份（R2 檔案 ZIP 打包／還原）── */
import { zipSync, unzipSync } from 'fflate';

export async function zipAllFiles(bucket: R2Bucket): Promise<{ zip: Uint8Array; count: number }> {
  const entries: Record<string, Uint8Array> = {};
  let cursor: string | undefined;
  let count = 0;
  do {
    const list = await bucket.list({ cursor });
    for (const obj of list.objects) {
      if (obj.key.startsWith('backups/')) continue;   // 自動備份檔不重複打包
      const o = await bucket.get(obj.key);
      if (o) { entries[obj.key] = new Uint8Array(await o.arrayBuffer()); count++; }
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return { zip: zipSync(entries, { level: 0 }), count };   // 圖片已壓縮，level 0 求快
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
};
export async function restoreFilesFromZip(bucket: R2Bucket, zipData: Uint8Array): Promise<number> {
  const entries = unzipSync(zipData);
  let n = 0;
  for (const [key, data] of Object.entries(entries)) {
    if (!data.length || key.endsWith('/') || key.startsWith('backups/')) continue;
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    await bucket.put(key, data as Uint8Array<ArrayBuffer>, {
      httpMetadata: { contentType: MIME[ext] ?? 'application/octet-stream' },
    });
    n++;
  }
  return n;
}

/** 每日自動備份：寫進 R2 backups/，保留最近 30 份 */
export async function runScheduledBackup(db: D1Database, bucket: R2Bucket) {
  const data = await dumpAll(db);
  const date = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const key = `backups/auto-${date}.json`;
  await bucket.put(key, JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json' },
  });
  const list = await bucket.list({ prefix: 'backups/' });
  const objs = list.objects.sort((a, b) => (a.key < b.key ? -1 : 1));
  while (objs.length > 30) {
    const old = objs.shift()!;
    await bucket.delete(old.key);
  }
  return key;
}
