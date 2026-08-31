-- 留言（物件層共通：任務、之後的單據/表單皆可用）
CREATE TABLE comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  author_id   INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_comments_entity ON comments(entity_type, entity_id);
