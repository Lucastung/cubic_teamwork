-- 不扣庫存料號（non-stock item）：軟體模組、分析流程等可複製的數位料
-- 可放進 BOM 讓生產單留下使用紀錄，但領料時跳過、不產生庫存異動、不算庫存不足
ALTER TABLE materials ADD COLUMN no_stock INTEGER NOT NULL DEFAULT 0;
