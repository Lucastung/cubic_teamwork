-- 審核機制：任務五階段生命週期 + 第二人簽核 + 簽章存證（雜湊鏈）

ALTER TABLE nodes ADD COLUMN stage TEXT NOT NULL DEFAULT 'todo';
  -- todo(已建立) / doing(執行中) / done(已完成) / signed(已簽核) / closed(已結案)
ALTER TABLE nodes ADD COLUMN needs_sign INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN done_by INTEGER REFERENCES users(id);
ALTER TABLE nodes ADD COLUMN signed_by INTEGER REFERENCES users(id);
ALTER TABLE nodes ADD COLUMN signed_at TEXT;
ALTER TABLE nodes ADD COLUMN closed_at TEXT;

-- 既有資料回填
UPDATE nodes SET stage = CASE WHEN done = 1 THEN 'done' ELSE 'todo' END WHERE kind = 'task';

-- 簽章存證（物件層共通：任務、之後的報銷單/採購單皆可用）
-- content_hash：被簽內容快照的 SHA-256
-- chain_hash：sha256(前一筆 chain_hash + content_hash + action + signer + 時間)，形成防竄改鏈
CREATE TABLE signatures (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type  TEXT NOT NULL,
  entity_id    INTEGER NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('sign','reject','close')),
  signer_id    INTEGER NOT NULL REFERENCES users(id),
  note         TEXT,
  content_hash TEXT NOT NULL,
  prev_hash    TEXT NOT NULL,
  chain_hash   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sig_entity ON signatures(entity_type, entity_id);
