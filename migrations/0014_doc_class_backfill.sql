-- 文件改用引索樹分類：把既有「由模版建立」的文件依編號前綴回填 class_id
-- （之後的新文件會在建立時直接寫入模版的節點）

WITH RECURSIVE paths(id, prefix) AS (
  SELECT id, code FROM tpl_classes WHERE parent_id IS NULL
  UNION ALL
  SELECT t.id, p.prefix || '-' || t.code FROM tpl_classes t JOIN paths p ON t.parent_id = p.id
)
UPDATE docs SET class_id = (
  SELECT p.id FROM paths p
  WHERE docs.doc_no LIKE p.prefix || '-________-%'
  ORDER BY length(p.prefix) DESC LIMIT 1
)
WHERE is_template = 0 AND doc_no IS NOT NULL AND class_id IS NULL;
