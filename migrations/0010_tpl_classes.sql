-- 模版編碼引索樹：組織「表單模版」（部門/類型逐層節點，各有代號）
-- 從模版建立的文件自動編號：路徑代號-日期碼-序號（例 RD-EXP-20260901-001）

CREATE TABLE tpl_classes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER REFERENCES tpl_classes(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL,          -- 節點代號（如 RD、EXP）
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tplcls_parent ON tpl_classes(parent_id);

ALTER TABLE docs ADD COLUMN class_id INTEGER REFERENCES tpl_classes(id);  -- 模版所屬節點
ALTER TABLE docs ADD COLUMN doc_no TEXT;                                  -- 生成文件的正式編號（不可變）
