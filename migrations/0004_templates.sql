-- 專案模版：模版是一種特殊專案（kind='template'）
-- 模版任務用相對時程（開案後第 N 天）與角色佔位，套用時換算

ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE nodes ADD COLUMN due_offset INTEGER;   -- 模版任務：開案後第 N 天到期
ALTER TABLE nodes ADD COLUMN role_hint TEXT;       -- 模版任務：角色佔位（例如「實驗員」）
ALTER TABLE items ADD COLUMN template_project_id INTEGER REFERENCES projects(id);
