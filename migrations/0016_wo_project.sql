-- 生產單連動專案：料號可掛「生產模版」，生產單建立時自動開專案展開任務樹
ALTER TABLE materials ADD COLUMN template_project_id INTEGER REFERENCES projects(id);
