-- 財務第一批：費用報銷（兩層：核准→付款）＋ 請款與收款（含 5% 營業稅）

-- 報銷單：draft(草稿) → submitted(送審) → approved(已核准) → paid(已付款)；void(作廢)
-- 退回 = 回到 draft 並記 reject_note（簽章鏈另有 reject 存證）
CREATE TABLE expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  exp_no       TEXT NOT NULL UNIQUE,
  claimant_id  INTEGER NOT NULL REFERENCES users(id),
  title        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','paid','void')),
  total        INTEGER NOT NULL DEFAULT 0,
  reject_note  TEXT,
  submitted_at TEXT,
  approved_by  INTEGER REFERENCES users(id),
  approved_at  TEXT,
  paid_by      INTEGER REFERENCES users(id),
  paid_at      TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE expense_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id  INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  date        TEXT,
  category    TEXT NOT NULL DEFAULT '雜項',
  description TEXT NOT NULL DEFAULT '',
  amount      INTEGER NOT NULL DEFAULT 0,
  project_id  INTEGER REFERENCES projects(id),
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_explines_exp ON expense_lines(expense_id);

-- 報銷憑證（發票/收據照片，掛 R2 檔案）
CREATE TABLE expense_receipts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  file_key   TEXT NOT NULL,
  file_name  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_expreceipts_exp ON expense_receipts(expense_id);

-- 請款單：draft(草稿) → issued(已送出) → partial(部分收款) → paid(已收款)；void(作廢)
-- amount 未稅、tax 稅額、total 含稅；gui_no 統一發票號碼
CREATE TABLE invoices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  inv_no     TEXT NOT NULL UNIQUE,
  order_id   INTEGER REFERENCES orders(id),
  party_id   INTEGER NOT NULL REFERENCES parties(id),
  title      TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','partial','paid','void')),
  amount     INTEGER NOT NULL DEFAULT 0,
  tax        INTEGER NOT NULL DEFAULT 0,
  total      INTEGER NOT NULL DEFAULT 0,
  tax_rate   REAL NOT NULL DEFAULT 0.05,
  gui_no     TEXT,
  issue_date TEXT,
  due_date   TEXT,
  note       TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_inv_order ON invoices(order_id);
CREATE INDEX idx_inv_party ON invoices(party_id);

CREATE TABLE invoice_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_id    INTEGER REFERENCES items(id),
  name       TEXT NOT NULL,
  qty        REAL NOT NULL DEFAULT 1,
  unit       TEXT NOT NULL DEFAULT '式',
  price      INTEGER NOT NULL DEFAULT 0,
  amount     INTEGER NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_invlines_inv ON invoice_lines(invoice_id);

-- 收款紀錄（核銷）
CREATE TABLE payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  method     TEXT NOT NULL DEFAULT '匯款',
  note       TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pay_inv ON payments(invoice_id);
