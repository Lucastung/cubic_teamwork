-- cubic_teamwork 初始 schema
-- 三層任務結構：project → node(kind=module) → node(kind=group) → node(kind=task)
-- 只有 kind=task（最終子節點）有 owner / due / done，會流入成員河流

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#3E7CB8',
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','pm','member')),
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE projects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('lead','member')),
  PRIMARY KEY (project_id, user_id)
);

-- 心智圖模塊、父節點分組、最終子任務，統一為 nodes（parent_id 構成樹）
CREATE TABLE nodes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('module','group','task')),
  title      TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'free' CHECK (mode IN ('seq','free')), -- 容器的執行模式
  owner_id   INTEGER REFERENCES users(id),   -- 僅 task
  due        TEXT,                            -- 僅 task，YYYY-MM-DD
  done       INTEGER NOT NULL DEFAULT 0,      -- 僅 task
  done_at    TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,      -- 同層排序（依序模式下即執行順序）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_nodes_project ON nodes(project_id);
CREATE INDEX idx_nodes_parent  ON nodes(parent_id);
CREATE INDEX idx_nodes_owner   ON nodes(owner_id);

-- 前置條件：node 可依賴另一個 node（task 或 group/module = 整組完成）
CREATE TABLE deps (
  node_id    INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  depends_on INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (node_id, depends_on)
);
