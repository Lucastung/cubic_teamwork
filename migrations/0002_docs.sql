-- 文件中心：資料夾、文件、版本、權限、實體連結、全文索引

CREATE TABLE folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  restricted INTEGER NOT NULL DEFAULT 0,   -- 1 = 關閉「全公司可讀」預設
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE docs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id          INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  title              TEXT NOT NULL DEFAULT '未命名文件',
  restricted         INTEGER NOT NULL DEFAULT 0,
  current_version_id INTEGER,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_docs_folder ON docs(folder_id);

CREATE TABLE doc_versions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id       INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  version_no   INTEGER NOT NULL,
  content_json TEXT NOT NULL DEFAULT '{}',
  content_html TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '',
  author_id    INTEGER REFERENCES users(id),
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_versions_doc ON doc_versions(doc_id, version_no);

-- 權限：target 可為資料夾或文件；subject 可為單一使用者或全體
CREATE TABLE doc_perms (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  target_kind  TEXT NOT NULL CHECK (target_kind IN ('folder','doc')),
  target_id    INTEGER NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('user','everyone')),
  subject_id   INTEGER,                    -- subject_kind='user' 時使用
  level        TEXT NOT NULL CHECK (level IN ('read','edit','manage'))
);
CREATE INDEX idx_perms_target ON doc_perms(target_kind, target_id);

-- 文件掛到任何實體：PM 專案/任務，未來 ERP 單據
CREATE TABLE doc_links (
  doc_id      INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,               -- 'project' | 'node' | 之後 'order' 等
  entity_id   INTEGER NOT NULL,
  PRIMARY KEY (doc_id, entity_type, entity_id)
);
CREATE INDEX idx_links_entity ON doc_links(entity_type, entity_id);

-- 附件（R2 物件的中介資料）
CREATE TABLE files (
  key        TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 全文索引：trigram 斷詞，中文可搜尋任意子字串
CREATE VIRTUAL TABLE docs_fts USING fts5(title, body, tokenize='trigram');
