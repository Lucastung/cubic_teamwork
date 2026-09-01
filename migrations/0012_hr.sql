-- 人事管理：個人資料欄位、頭像、專長標籤、差勤（請假）

ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN address TEXT;
ALTER TABLE users ADD COLUMN emergency TEXT;   -- 緊急聯絡人（姓名／電話）
ALTER TABLE users ADD COLUMN avatar_key TEXT;  -- R2 檔案 key

-- 專長標籤池（管理者維護）
CREATE TABLE skill_tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
-- 成員 ↔ 專長（多對多，管理者指派）
CREATE TABLE user_skills (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES skill_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, tag_id)
);

-- 請假單：pending(待核准) → approved(已核准)／rejected(已退回)；cancelled(已取消)
-- 半天單位：start_half/end_half = 'am'|'pm'，days 以 0.5 為級距
CREATE TABLE leaves (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL DEFAULT '事假',
  start_date  TEXT NOT NULL,
  start_half  TEXT NOT NULL DEFAULT 'am' CHECK (start_half IN ('am','pm')),
  end_date    TEXT NOT NULL,
  end_half    TEXT NOT NULL DEFAULT 'pm' CHECK (end_half IN ('am','pm')),
  days        REAL NOT NULL DEFAULT 1,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  note        TEXT,           -- 核准／退回附註
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_leaves_user ON leaves(user_id);
CREATE INDEX idx_leaves_status ON leaves(status);
