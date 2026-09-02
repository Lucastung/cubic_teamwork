-- 庫存與生產：料號主檔（自動編碼）、庫存異動帳（批號＋效期）、BOM、生產單

-- 料號類別（代碼成為料號前綴）
CREATE TABLE mat_categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
INSERT INTO mat_categories (code, name) VALUES
  ('RM', '原料'), ('CM', '耗材'), ('SF', '半成品'), ('FG', '成品');

-- 料號主檔
CREATE TABLE materials (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mat_no      TEXT NOT NULL UNIQUE,            -- 例：RM-0001
  category_id INTEGER NOT NULL REFERENCES mat_categories(id),
  name        TEXT NOT NULL,
  spec        TEXT,                            -- 規格
  unit        TEXT NOT NULL DEFAULT '個',
  safe_stock  REAL NOT NULL DEFAULT 0,         -- 安全庫存（低於則警示）
  cost        INTEGER NOT NULL DEFAULT 0,      -- 參考單價 NT$
  supplier_id INTEGER REFERENCES parties(id),
  location    TEXT,                            -- 存放位置
  track_lot   INTEGER NOT NULL DEFAULT 1,      -- 批號＋效期管理
  active      INTEGER NOT NULL DEFAULT 1,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 庫存異動帳：唯一真相，庫存量 = SUM(qty)；正=入庫、負=出庫
CREATE TABLE stock_moves (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  qty         REAL NOT NULL,
  reason      TEXT NOT NULL,   -- purchase_in / manual_out / production_out / production_in / adjust / scrap
  lot_no      TEXT,
  expiry      TEXT,            -- 效期（入庫時記錄）
  ref_type    TEXT,            -- 關聯單據：'work_order' 等
  ref_id      INTEGER,
  note        TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_moves_mat ON stock_moves(material_id);
CREATE INDEX idx_moves_lot ON stock_moves(material_id, lot_no);
CREATE INDEX idx_moves_ref ON stock_moves(ref_type, ref_id);

-- BOM：成品／半成品每單位的用料（單層）
CREATE TABLE boms (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES materials(id),
  component_id INTEGER NOT NULL REFERENCES materials(id),
  qty          REAL NOT NULL DEFAULT 1,
  note         TEXT,
  UNIQUE (product_id, component_id)
);
CREATE INDEX idx_boms_product ON boms(product_id);

-- 生產單：draft(已建立) → in_progress(已領料) → done(完工入庫)；void(作廢)
CREATE TABLE work_orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_no      TEXT NOT NULL UNIQUE,             -- WO-2026-0001
  product_id INTEGER NOT NULL REFERENCES materials(id),
  qty        REAL NOT NULL DEFAULT 1,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','done','void')),
  project_id INTEGER REFERENCES projects(id),
  lot_no     TEXT,                             -- 產出批號
  expiry     TEXT,                             -- 產出效期
  note       TEXT,
  started_at TEXT,
  done_at    TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_wo_product ON work_orders(product_id);
