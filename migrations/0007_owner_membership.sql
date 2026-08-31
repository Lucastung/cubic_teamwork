-- 修正：被指派任務的人自動成為專案成員（否則看不到自己的任務）
-- 回填既有資料
INSERT OR IGNORE INTO project_members (project_id, user_id, role)
SELECT DISTINCT n.project_id, n.owner_id, 'member'
FROM nodes n
JOIN projects p ON p.id = n.project_id
WHERE n.kind = 'task' AND n.owner_id IS NOT NULL AND p.kind = 'normal';
