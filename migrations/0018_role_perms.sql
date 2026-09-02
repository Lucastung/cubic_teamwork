-- 角色權限表：控制各角色可見模組與可用功能
-- 沒有列的組合採程式內建預設值；admin 一律全開（程式強制）
CREATE TABLE role_perms (
  role    TEXT NOT NULL CHECK (role IN ('member','pm')),
  perm    TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (role, perm)
);
