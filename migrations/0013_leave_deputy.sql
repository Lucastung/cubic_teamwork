-- 請假加入職代關卡：送出 → 職代確認(pending_deputy) → 主管核准(pending) → approved
-- SQLite 無法改 CHECK 約束，重建資料表

CREATE TABLE leaves_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL DEFAULT '事假',
  start_date  TEXT NOT NULL,
  start_half  TEXT NOT NULL DEFAULT 'am' CHECK (start_half IN ('am','pm')),
  end_date    TEXT NOT NULL,
  end_half    TEXT NOT NULL DEFAULT 'pm' CHECK (end_half IN ('am','pm')),
  days        REAL NOT NULL DEFAULT 1,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending_deputy'
              CHECK (status IN ('pending_deputy','pending','approved','rejected','cancelled')),
  deputy_id   INTEGER REFERENCES users(id),   -- 職代（舊資料可為空）
  deputy_at   TEXT,                            -- 職代同意時間
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO leaves_new (id, user_id, kind, start_date, start_half, end_date, end_half, days, reason, status, approved_by, approved_at, note, created_at)
  SELECT id, user_id, kind, start_date, start_half, end_date, end_half, days, reason, status, approved_by, approved_at, note, created_at FROM leaves;
DROP TABLE leaves;
ALTER TABLE leaves_new RENAME TO leaves;
CREATE INDEX idx_leaves_user ON leaves(user_id);
CREATE INDEX idx_leaves_status ON leaves(status);
CREATE INDEX idx_leaves_deputy ON leaves(deputy_id);
