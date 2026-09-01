import { Hono } from 'hono';

type User = { id: number; email: string; name: string; color: string; role: 'admin' | 'pm' | 'member' };
export interface DocsEnv { DB: D1Database; FILES: R2Bucket; ASSETS: Fetcher }
type Ctx = { Bindings: DocsEnv; Variables: { user: User } };

export const docsApp = new Hono<Ctx>();

type Level = 'none' | 'read' | 'edit' | 'manage';
const RANK: Record<Level, number> = { none: 0, read: 1, edit: 2, manage: 3 };
const max = (a: Level, b: Level): Level => (RANK[a] >= RANK[b] ? a : b);

type PermRow = { target_kind: string; target_id: number; subject_kind: string; subject_id: number | null; level: Level };

/** 一次抓出資料夾與權限，於記憶體中計算有效權限（規模小，最單純可靠） */
async function loadAcl(db: D1Database) {
  const folders = (await db.prepare('SELECT * FROM folders').all()).results as any[];
  const perms = (await db.prepare('SELECT * FROM doc_perms').all()).results as unknown as PermRow[];
  const fmap = new Map(folders.map(f => [f.id, f]));
  const chain = (folderId: number | null): any[] => {
    const out: any[] = [];
    let f = folderId != null ? fmap.get(folderId) : undefined;
    while (f) { out.push(f); f = f.parent_id != null ? fmap.get(f.parent_id) : undefined; }
    return out;
  };
  const permsFor = (kind: string, id: number) => perms.filter(p => p.target_kind === kind && p.target_id === id);
  const levelFor = (user: User, doc: any): Level => {
    if (user.role === 'admin' || doc.created_by === user.id) return 'manage';
    let lv: Level = 'none';
    const rows = [...permsFor('doc', doc.id), ...chain(doc.folder_id).flatMap(f => permsFor('folder', f.id))];
    for (const p of rows) {
      if (p.subject_kind === 'everyone' || (p.subject_kind === 'user' && p.subject_id === user.id)) lv = max(lv, p.level);
    }
    const anyRestricted = doc.restricted || chain(doc.folder_id).some(f => f.restricted);
    if (!anyRestricted) lv = max(lv, 'read'); // 公司內公開可讀
    return lv;
  };
  const folderLevelFor = (user: User, folder: any): Level => {
    if (user.role === 'admin' || folder.created_by === user.id) return 'manage';
    let lv: Level = 'none';
    const rows = [folder, ...chain(folder.parent_id)].flatMap(f => permsFor('folder', f.id));
    for (const p of rows) {
      if (p.subject_kind === 'everyone' || (p.subject_kind === 'user' && p.subject_id === user.id)) lv = max(lv, p.level);
    }
    const anyRestricted = folder.restricted || chain(folder.parent_id).some(f => f.restricted);
    if (!anyRestricted) lv = max(lv, 'read');
    return lv;
  };
  return { folders, levelFor, folderLevelFor };
}

async function getDoc(db: D1Database, id: number) {
  return db.prepare('SELECT * FROM docs WHERE id = ?').bind(id).first<any>();
}
async function requireDoc(c: any, minLevel: Level): Promise<{ doc: any; level: Level } | Response> {
  const id = Number(c.req.param('id'));
  const doc = await getDoc(c.env.DB, id);
  if (!doc) return c.json({ error: '找不到文件' }, 404);
  const acl = await loadAcl(c.env.DB);
  const level = acl.levelFor(c.get('user'), doc);
  if (RANK[level] < RANK[minLevel]) return c.json({ error: '權限不足' }, 403);
  return { doc, level };
}

async function updateFts(db: D1Database, docId: number, title: string, body: string) {
  await db.batch([
    db.prepare('DELETE FROM docs_fts WHERE rowid = ?').bind(docId),
    db.prepare('INSERT INTO docs_fts(rowid, title, body) VALUES (?, ?, ?)').bind(docId, title, body),
  ]);
}

/* ── 模版編碼引索樹 ── */
docsApp.get('/tpl-classes', async c => {
  const { results } = await c.env.DB.prepare('SELECT * FROM tpl_classes ORDER BY parent_id, sort, id').all();
  return c.json(results);
});
docsApp.post('/tpl-classes', async c => {
  const { name, code, parent_id = null } = await c.req.json();
  if (!name?.trim() || !code?.trim()) return c.json({ error: '請輸入名稱與代號' }, 400);
  const cleanCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleanCode) return c.json({ error: '代號限英數字' }, 400);
  const dup = await c.env.DB.prepare('SELECT 1 FROM tpl_classes WHERE parent_id IS ? AND code = ?')
    .bind(parent_id, cleanCode).first();
  if (dup) return c.json({ error: `同一層已有代號 ${cleanCode}` }, 409);
  const r = await c.env.DB.prepare('INSERT INTO tpl_classes (name, code, parent_id) VALUES (?, ?, ?)')
    .bind(name.trim(), cleanCode, parent_id).run();
  return c.json({ id: r.meta.last_row_id, code: cleanCode });
});
/** 匯出：每行一個節點的完整路徑，Name(CODE) 以 Tab 分隔 */
docsApp.get('/tpl-classes/export', async c => {
  const classes = (await c.env.DB.prepare('SELECT * FROM tpl_classes ORDER BY parent_id, sort, id').all()).results as any[];
  const map = new Map(classes.map(x => [x.id, x]));
  const pathOf = (n: any): string => {
    const parts: string[] = [];
    let cur = n;
    while (cur) { parts.unshift(`${cur.name}(${cur.code})`); cur = cur.parent_id != null ? map.get(cur.parent_id) : undefined; }
    return parts.join('\t');
  };
  const lines: string[] = [];
  const walk = (parent: number | null) => {
    for (const n of classes.filter(x => x.parent_id === parent)) { lines.push(pathOf(n)); walk(n.id); }
  };
  walk(null);
  return c.text(lines.join('\n'), 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': 'attachment; filename="tpl-index.txt"',
  });
});

/** 匯入：逐層以代號比對，不存在則建立；可重複匯入（冪等） */
docsApp.post('/tpl-classes/import', async c => {
  const { text } = await c.req.json();
  if (!text?.trim()) return c.json({ error: '沒有內容' }, 400);
  const SEG = /^\s*(.*?)\s*[（(]\s*([A-Za-z0-9]+)\s*[)）]\s*$/;
  let created = 0, skipped = 0;
  const badLines: number[] = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const segs = line.split('\t').map(s => s.trim()).filter(Boolean);
    const parsed: { name: string; code: string }[] = [];
    let bad = false;
    for (const seg of segs) {
      const m = seg.match(SEG);
      if (!m || !m[1]) { bad = true; break; }
      parsed.push({ name: m[1], code: m[2].toUpperCase() });
    }
    if (bad || !parsed.length) { badLines.push(i + 1); continue; }
    let parentId: number | null = null;
    for (const p of parsed) {
      const existing: any = await c.env.DB.prepare(
        'SELECT id FROM tpl_classes WHERE parent_id IS ? AND code = ?'
      ).bind(parentId, p.code).first();
      if (existing) { parentId = existing.id; skipped++; }
      else {
        const r = await c.env.DB.prepare('INSERT INTO tpl_classes (name, code, parent_id) VALUES (?, ?, ?)')
          .bind(p.name, p.code, parentId).run();
        parentId = r.meta.last_row_id as number;
        created++;
      }
    }
  }
  return c.json({ created, skipped, bad_lines: badLines });
});

docsApp.patch('/tpl-classes/:id', async c => {
  const id = Number(c.req.param('id'));
  const { name, code } = await c.req.json();
  if (name !== undefined) await c.env.DB.prepare('UPDATE tpl_classes SET name = ? WHERE id = ?').bind(name, id).run();
  if (code !== undefined) {
    const cleanCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleanCode) return c.json({ error: '代號限英數字' }, 400);
    await c.env.DB.prepare('UPDATE tpl_classes SET code = ? WHERE id = ?').bind(cleanCode, id).run();
  }
  return c.json({ ok: true });
});
docsApp.delete('/tpl-classes/:id', async c => {
  const id = Number(c.req.param('id'));
  const child = await c.env.DB.prepare('SELECT 1 FROM tpl_classes WHERE parent_id = ?').bind(id).first();
  if (child) return c.json({ error: '請先刪除子節點' }, 400);
  const tpl = await c.env.DB.prepare('SELECT 1 FROM docs WHERE class_id = ? AND is_template = 1').bind(id).first();
  if (tpl) return c.json({ error: '這個節點下還有模版，請先移走' }, 400);
  await c.env.DB.prepare('DELETE FROM tpl_classes WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

/** 由模版的節點路徑生成文件編號：CODE1-CODE2-YYYYMMDD-NNN（依節點+日期流水） */
async function genDocNo(db: D1Database, classId: number | null): Promise<string | null> {
  if (!classId) return null;
  const classes = (await db.prepare('SELECT * FROM tpl_classes').all()).results as any[];
  const map = new Map(classes.map(x => [x.id, x]));
  const codes: string[] = [];
  let cur = map.get(classId);
  while (cur) { codes.unshift(cur.code); cur = cur.parent_id != null ? map.get(cur.parent_id) : undefined; }
  if (!codes.length) return null;
  const date = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, ''); // 台北時間
  const prefix = `${codes.join('-')}-${date}-`;
  const n = await db.prepare(`SELECT COUNT(*) AS n FROM docs WHERE doc_no LIKE ?`).bind(`${prefix}%`).first<{ n: number }>();
  return `${prefix}${String((n?.n ?? 0) + 1).padStart(3, '0')}`;
}

/* ── 樹狀列表 ── */
docsApp.get('/docs/tree', async c => {
  const user = c.get('user');
  const acl = await loadAcl(c.env.DB);
  const docs = (await c.env.DB.prepare(
    'SELECT id, folder_id, title, restricted, is_template, class_id, doc_no, created_by, updated_at FROM docs ORDER BY updated_at DESC'
  ).all()).results as any[];
  const visibleDocs = docs
    .map(d => ({ ...d, my_level: acl.levelFor(user, d) }))
    .filter(d => d.my_level !== 'none');
  const visibleFolders = acl.folders
    .map(f => ({ ...f, my_level: acl.folderLevelFor(user, f) }))
    .filter(f => f.my_level !== 'none');
  return c.json({ folders: visibleFolders, docs: visibleDocs });
});

/* ── 資料夾 ── */
docsApp.post('/folders', async c => {
  const user = c.get('user');
  const { name, parent_id = null } = await c.req.json();
  if (!name?.trim()) return c.json({ error: '請輸入名稱' }, 400);
  const r = await c.env.DB.prepare('INSERT INTO folders (name, parent_id, created_by) VALUES (?, ?, ?)')
    .bind(name.trim(), parent_id, user.id).run();
  return c.json({ id: r.meta.last_row_id });
});
docsApp.patch('/folders/:id', async c => {
  const id = Number(c.req.param('id'));
  const acl = await loadAcl(c.env.DB);
  const f = acl.folders.find(x => x.id === id);
  if (!f) return c.json({ error: '找不到資料夾' }, 404);
  if (RANK[acl.folderLevelFor(c.get('user'), f)] < RANK.manage) return c.json({ error: '權限不足' }, 403);
  const { name, restricted, parent_id } = await c.req.json();
  if (name !== undefined) await c.env.DB.prepare('UPDATE folders SET name = ? WHERE id = ?').bind(name, id).run();
  if (restricted !== undefined) await c.env.DB.prepare('UPDATE folders SET restricted = ? WHERE id = ?').bind(restricted ? 1 : 0, id).run();
  if (parent_id !== undefined) await c.env.DB.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').bind(parent_id, id).run();
  return c.json({ ok: true });
});
docsApp.delete('/folders/:id', async c => {
  const id = Number(c.req.param('id'));
  const acl = await loadAcl(c.env.DB);
  const f = acl.folders.find(x => x.id === id);
  if (!f) return c.json({ error: '找不到資料夾' }, 404);
  if (RANK[acl.folderLevelFor(c.get('user'), f)] < RANK.manage) return c.json({ error: '權限不足' }, 403);
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM docs WHERE folder_id = ?').bind(id).first<{ n: number }>();
  if ((n?.n ?? 0) > 0) return c.json({ error: '資料夾內還有文件，請先移出或刪除' }, 400);
  await c.env.DB.prepare('DELETE FROM folders WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

/* ── 文件 CRUD ── */
docsApp.post('/docs', async c => {
  const user = c.get('user');
  const { title, folder_id = null, entity_type, entity_id, is_template = 0, template_id = null, class_id = null } = await c.req.json();
  let content = { json: '{}', html: '', text: '' };
  let finalTitle = title?.trim() || '未命名文件';
  let docNo: string | null = null;
  if (template_id) {
    const tpl = await getDoc(c.env.DB, Number(template_id));
    if (!tpl || !tpl.is_template) return c.json({ error: '找不到模版' }, 404);
    const tv = await c.env.DB.prepare('SELECT * FROM doc_versions WHERE id = ?').bind(tpl.current_version_id).first<any>();
    if (tv) content = { json: tv.content_json, html: tv.content_html, text: tv.content_text };
    if (!title?.trim()) finalTitle = tpl.title;
    docNo = await genDocNo(c.env.DB, tpl.class_id);   // 依模版節點路徑自動編號
  }
  const r = await c.env.DB.prepare(
    'INSERT INTO docs (title, folder_id, is_template, class_id, doc_no, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(finalTitle, folder_id, is_template ? 1 : 0, is_template ? class_id : null, docNo, user.id).run();
  const docId = r.meta.last_row_id as number;
  const v = await c.env.DB.prepare(
    `INSERT INTO doc_versions (doc_id, version_no, content_json, content_html, content_text, author_id, note)
     VALUES (?, 1, ?, ?, ?, ?, ?)`
  ).bind(docId, content.json, content.html, content.text, user.id, template_id ? `由模版建立${docNo ? `（${docNo}）` : ''}` : null).run();
  await c.env.DB.prepare('UPDATE docs SET current_version_id = ? WHERE id = ?').bind(v.meta.last_row_id, docId).run();
  await updateFts(c.env.DB, docId, `${docNo ? docNo + ' ' : ''}${finalTitle}`, content.text);
  if (entity_type && entity_id) {
    await c.env.DB.prepare('INSERT OR IGNORE INTO doc_links (doc_id, entity_type, entity_id) VALUES (?, ?, ?)')
      .bind(docId, entity_type, entity_id).run();
  }
  return c.json({ id: docId, doc_no: docNo });
});

/** 把現有文件另存為模版 */
docsApp.post('/docs/:id/save-as-template', async c => {
  const r = await requireDoc(c, 'read');
  if (r instanceof Response) return r;
  const user = c.get('user');
  const v = await c.env.DB.prepare('SELECT * FROM doc_versions WHERE id = ?').bind(r.doc.current_version_id).first<any>();
  const title = `${r.doc.title}（模版）`;
  const nr = await c.env.DB.prepare('INSERT INTO docs (title, is_template, created_by) VALUES (?, 1, ?)')
    .bind(title, user.id).run();
  const docId = nr.meta.last_row_id as number;
  const nv = await c.env.DB.prepare(
    `INSERT INTO doc_versions (doc_id, version_no, content_json, content_html, content_text, author_id, note)
     VALUES (?, 1, ?, ?, ?, ?, '另存自文件')`
  ).bind(docId, v?.content_json ?? '{}', v?.content_html ?? '', v?.content_text ?? '', user.id).run();
  await c.env.DB.prepare('UPDATE docs SET current_version_id = ? WHERE id = ?').bind(nv.meta.last_row_id, docId).run();
  await updateFts(c.env.DB, docId, title, v?.content_text ?? '');
  return c.json({ id: docId });
});

docsApp.get('/docs/:id', async c => {
  const r = await requireDoc(c, 'read');
  if (r instanceof Response) return r;
  const v = await c.env.DB.prepare('SELECT * FROM doc_versions WHERE id = ?').bind(r.doc.current_version_id).first<any>();
  const links = (await c.env.DB.prepare('SELECT entity_type, entity_id FROM doc_links WHERE doc_id = ?').bind(r.doc.id).all()).results;
  return c.json({
    ...r.doc, my_level: r.level, content_json: v?.content_json ?? '{}',
    content_html: v?.content_html ?? '', version_no: v?.version_no ?? 1, links,
  });
});

docsApp.patch('/docs/:id', async c => {
  const r = await requireDoc(c, 'edit');
  if (r instanceof Response) return r;
  const { title, folder_id, restricted, class_id } = await c.req.json();
  if (title !== undefined) {
    await c.env.DB.prepare(`UPDATE docs SET title = ?, updated_at = datetime('now') WHERE id = ?`).bind(title, r.doc.id).run();
    const v = await c.env.DB.prepare('SELECT content_text FROM doc_versions WHERE id = ?').bind(r.doc.current_version_id).first<any>();
    await updateFts(c.env.DB, r.doc.id, `${r.doc.doc_no ? r.doc.doc_no + ' ' : ''}${title}`, v?.content_text ?? '');
  }
  if (folder_id !== undefined) await c.env.DB.prepare('UPDATE docs SET folder_id = ? WHERE id = ?').bind(folder_id, r.doc.id).run();
  if (class_id !== undefined && r.doc.is_template)
    await c.env.DB.prepare('UPDATE docs SET class_id = ? WHERE id = ?').bind(class_id, r.doc.id).run();
  if (restricted !== undefined) {
    if (RANK[r.level] < RANK.manage) return c.json({ error: '權限不足' }, 403);
    await c.env.DB.prepare('UPDATE docs SET restricted = ? WHERE id = ?').bind(restricted ? 1 : 0, r.doc.id).run();
  }
  return c.json({ ok: true });
});

docsApp.delete('/docs/:id', async c => {
  const r = await requireDoc(c, 'manage');
  if (r instanceof Response) return r;
  await c.env.DB.prepare('DELETE FROM docs WHERE id = ?').bind(r.doc.id).run();
  await c.env.DB.prepare('DELETE FROM docs_fts WHERE rowid = ?').bind(r.doc.id).run();
  return c.json({ ok: true });
});

/* ── 內容儲存（10 分鐘內同作者連續編輯合併為同一版本）── */
docsApp.put('/docs/:id/content', async c => {
  const r = await requireDoc(c, 'edit');
  if (r instanceof Response) return r;
  const user = c.get('user');
  const { content_json, content_html, content_text, note = null } = await c.req.json();
  const latest = await c.env.DB.prepare(
    'SELECT * FROM doc_versions WHERE doc_id = ? ORDER BY version_no DESC LIMIT 1'
  ).bind(r.doc.id).first<any>();
  let versionId: number;
  if (latest && latest.author_id === user.id && !note &&
      latest.created_at > new Date(Date.now() - 10 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')) {
    await c.env.DB.prepare(
      'UPDATE doc_versions SET content_json = ?, content_html = ?, content_text = ? WHERE id = ?'
    ).bind(content_json, content_html, content_text, latest.id).run();
    versionId = latest.id;
  } else {
    const v = await c.env.DB.prepare(
      `INSERT INTO doc_versions (doc_id, version_no, content_json, content_html, content_text, author_id, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(r.doc.id, (latest?.version_no ?? 0) + 1, content_json, content_html, content_text, user.id, note).run();
    versionId = v.meta.last_row_id as number;
  }
  await c.env.DB.prepare(`UPDATE docs SET current_version_id = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(versionId, r.doc.id).run();
  await updateFts(c.env.DB, r.doc.id, `${r.doc.doc_no ? r.doc.doc_no + ' ' : ''}${r.doc.title}`, content_text ?? '');
  return c.json({ ok: true, version_id: versionId });
});

/* ── 版本 ── */
docsApp.get('/docs/:id/versions', async c => {
  const r = await requireDoc(c, 'read');
  if (r instanceof Response) return r;
  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.version_no, v.note, v.created_at, u.name AS author
     FROM doc_versions v LEFT JOIN users u ON u.id = v.author_id
     WHERE v.doc_id = ? ORDER BY v.version_no DESC`
  ).bind(r.doc.id).all();
  return c.json(results);
});
docsApp.get('/docs/:id/versions/:vid', async c => {
  const r = await requireDoc(c, 'read');
  if (r instanceof Response) return r;
  const v = await c.env.DB.prepare('SELECT * FROM doc_versions WHERE id = ? AND doc_id = ?')
    .bind(Number(c.req.param('vid')), r.doc.id).first<any>();
  if (!v) return c.json({ error: '找不到版本' }, 404);
  return c.json(v);
});
docsApp.post('/docs/:id/restore/:vid', async c => {
  const r = await requireDoc(c, 'edit');
  if (r instanceof Response) return r;
  const user = c.get('user');
  const v = await c.env.DB.prepare('SELECT * FROM doc_versions WHERE id = ? AND doc_id = ?')
    .bind(Number(c.req.param('vid')), r.doc.id).first<any>();
  if (!v) return c.json({ error: '找不到版本' }, 404);
  const latest = await c.env.DB.prepare('SELECT MAX(version_no) AS m FROM doc_versions WHERE doc_id = ?')
    .bind(r.doc.id).first<{ m: number }>();
  const nv = await c.env.DB.prepare(
    `INSERT INTO doc_versions (doc_id, version_no, content_json, content_html, content_text, author_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(r.doc.id, (latest?.m ?? 0) + 1, v.content_json, v.content_html, v.content_text, user.id, `還原自 v${v.version_no}`).run();
  await c.env.DB.prepare(`UPDATE docs SET current_version_id = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(nv.meta.last_row_id, r.doc.id).run();
  await updateFts(c.env.DB, r.doc.id, r.doc.title, v.content_text ?? '');
  return c.json({ ok: true });
});

/* ── 搜尋（<3 字用 LIKE，>=3 字用 FTS trigram）── */
docsApp.get('/docs-search', async c => {
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json([]);
  const user = c.get('user');
  const acl = await loadAcl(c.env.DB);
  let ids: number[];
  if ([...q].length < 3) {
    const { results } = await c.env.DB.prepare(
      `SELECT DISTINCT d.id FROM docs d
       LEFT JOIN doc_versions v ON v.id = d.current_version_id
       WHERE d.title LIKE ? OR d.doc_no LIKE ? OR v.content_text LIKE ? LIMIT 50`
    ).bind(`%${q}%`, `%${q}%`, `%${q}%`).all();
    ids = (results as any[]).map(r => r.id);
  } else {
    const { results } = await c.env.DB.prepare(
      `SELECT rowid FROM docs_fts WHERE docs_fts MATCH ? ORDER BY rank LIMIT 50`
    ).bind(`"${q.replaceAll('"', '""')}"`).all();
    ids = (results as any[]).map(r => r.rowid);
  }
  if (!ids.length) return c.json([]);
  const { results: docs } = await c.env.DB.prepare(
    `SELECT id, folder_id, title, restricted, is_template, class_id, doc_no, created_by, updated_at FROM docs WHERE id IN (${ids.map(() => '?').join(',')})`
  ).bind(...ids).all();
  const visible = (docs as any[])
    .map(d => ({ ...d, my_level: acl.levelFor(user, d) }))
    .filter(d => d.my_level !== 'none')
    .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  return c.json(visible);
});

/* ── 權限設定 ── */
docsApp.get('/docs/:id/perms', async c => {
  const r = await requireDoc(c, 'read');
  if (r instanceof Response) return r;
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, u.name AS user_name FROM doc_perms p LEFT JOIN users u ON u.id = p.subject_id
     WHERE p.target_kind = 'doc' AND p.target_id = ?`
  ).bind(r.doc.id).all();
  return c.json({ restricted: !!r.doc.restricted, perms: results });
});
docsApp.put('/docs/:id/perms', async c => {
  const r = await requireDoc(c, 'manage');
  if (r instanceof Response) return r;
  const { restricted, perms } = await c.req.json() as { restricted: boolean; perms: { subject_kind: string; subject_id: number | null; level: Level }[] };
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE docs SET restricted = ? WHERE id = ?').bind(restricted ? 1 : 0, r.doc.id),
    c.env.DB.prepare(`DELETE FROM doc_perms WHERE target_kind = 'doc' AND target_id = ?`).bind(r.doc.id),
    ...perms.map(p => c.env.DB.prepare(
      `INSERT INTO doc_perms (target_kind, target_id, subject_kind, subject_id, level) VALUES ('doc', ?, ?, ?, ?)`
    ).bind(r.doc.id, p.subject_kind, p.subject_id, p.level)),
  ]);
  return c.json({ ok: true });
});

/* ── 實體連結（PM / ERP 整合）── */
docsApp.get('/entity-docs', async c => {
  const type = c.req.query('type'), id = Number(c.req.query('id'));
  if (!type || !id) return c.json([]);
  const user = c.get('user');
  const acl = await loadAcl(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.folder_id, d.title, d.restricted, d.created_by, d.updated_at FROM doc_links l
     JOIN docs d ON d.id = l.doc_id WHERE l.entity_type = ? AND l.entity_id = ? ORDER BY d.updated_at DESC`
  ).bind(type, id).all();
  return c.json((results as any[]).map(d => ({ ...d, my_level: acl.levelFor(user, d) })).filter(d => d.my_level !== 'none'));
});
docsApp.post('/entity-docs', async c => {
  const { doc_id, entity_type, entity_id } = await c.req.json();
  await c.env.DB.prepare('INSERT OR IGNORE INTO doc_links (doc_id, entity_type, entity_id) VALUES (?, ?, ?)')
    .bind(doc_id, entity_type, entity_id).run();
  return c.json({ ok: true });
});
docsApp.delete('/entity-docs', async c => {
  const { doc_id, entity_type, entity_id } = await c.req.json();
  await c.env.DB.prepare('DELETE FROM doc_links WHERE doc_id = ? AND entity_type = ? AND entity_id = ?')
    .bind(doc_id, entity_type, entity_id).run();
  return c.json({ ok: true });
});

/* ── 附件（R2）── */
docsApp.post('/files', async c => {
  const user = c.get('user');
  const form = await c.req.formData();
  const file = form.get('file') as File | null;
  if (!file) return c.json({ error: '沒有檔案' }, 400);
  if (file.size > 20 * 1024 * 1024) return c.json({ error: '檔案上限 20MB' }, 400);
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = `${crypto.randomUUID()}.${ext}`;
  await c.env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
  await c.env.DB.prepare('INSERT INTO files (key, name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?)')
    .bind(key, file.name, file.type, file.size, user.id).run();
  return c.json({ url: `/api/files/${key}`, name: file.name });
});
docsApp.get('/files/:key', async c => {
  const key = c.req.param('key');
  const obj = await c.env.FILES.get(key);
  if (!obj) return c.json({ error: '找不到檔案' }, 404);
  const meta = await c.env.DB.prepare('SELECT * FROM files WHERE key = ?').bind(key).first<any>();
  return new Response(obj.body as any, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=31536000',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(meta?.name ?? key)}`,
    },
  });
});
