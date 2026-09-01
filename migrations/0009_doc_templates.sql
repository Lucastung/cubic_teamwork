-- 文件中心：表單模版（模版是一種特殊文件，之後編號引索系統疊加於此）
ALTER TABLE docs ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0;
