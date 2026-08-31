-- ERP 物件層第一批：當事人（客戶）、服務項目、報價單、訂單
-- 金額一律以新台幣整數儲存

CREATE TABLE parties (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL DEFAULT 'customer' CHECK (kind IN ('customer','supplier','both')),
  name       TEXT NOT NULL,
  tax_id     TEXT,                -- 統一編號
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  note       TEXT,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE party_contacts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  title    TEXT,
  phone    TEXT,
  email    TEXT,
  note     TEXT
);
CREATE INDEX idx_contacts_party ON party_contacts(party_id);

CREATE TABLE items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  unit        TEXT NOT NULL DEFAULT '式',
  price       INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 報價單：草稿 draft → 已送出 sent → 成交 won / 未成交 lost；作廢 void
CREATE TABLE quotes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_no   TEXT NOT NULL UNIQUE,
  party_id   INTEGER NOT NULL REFERENCES parties(id),
  title      TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','won','lost','void')),
  total      INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at    TEXT,
  decided_at TEXT
);

CREATE TABLE quote_lines (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  item_id  INTEGER REFERENCES items(id),
  name     TEXT NOT NULL,
  qty      REAL NOT NULL DEFAULT 1,
  unit     TEXT NOT NULL DEFAULT '式',
  price    INTEGER NOT NULL DEFAULT 0,
  amount   INTEGER NOT NULL DEFAULT 0,
  sort     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_qlines_quote ON quote_lines(quote_id);

-- 訂單：進行中 active → 已交付 delivered → 已請款 invoiced → 已收款 paid；作廢 void
CREATE TABLE orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no   TEXT NOT NULL UNIQUE,
  quote_id   INTEGER REFERENCES quotes(id),
  party_id   INTEGER NOT NULL REFERENCES parties(id),
  title      TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','delivered','invoiced','paid','void')),
  total      INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER REFERENCES projects(id),
  note       TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_lines (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id  INTEGER REFERENCES items(id),
  name     TEXT NOT NULL,
  qty      REAL NOT NULL DEFAULT 1,
  unit     TEXT NOT NULL DEFAULT '式',
  price    INTEGER NOT NULL DEFAULT 0,
  amount   INTEGER NOT NULL DEFAULT 0,
  sort     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_olines_order ON order_lines(order_id);

-- 單據狀態變更記錄（審計軌跡）
CREATE TABLE txn_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  action      TEXT NOT NULL,
  actor_id    INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_txn_entity ON txn_events(entity_type, entity_id);
