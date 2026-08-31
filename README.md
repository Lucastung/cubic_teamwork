# Cubic Teamwork

雲端公司管理系統（第一階段：專案管理 PM）。

## 核心概念

專案啟動 → **心智圖**腦力激盪拆出工作模塊 → 模塊點開是**三層任務樹**
（模塊 → 父節點分組 → 最終子任務）→ 子任務有順序、前置條件、負責人與
deadline → 自動流入每位成員的**河流**（依 deadline 排序的個人工作流）。

- 父節點只做分組與進度統計，不指派人、不入河流
- 容器（模塊/分組）可設「依序執行」（自動把上一項當前置）或「可並行」
- 前置條件可指向單一任務，也可指向整組（等該組全部完成）
- 任務狀態由條件自動推導：鎖定中 → 可開始 → 已完成

## 技術架構

| 層 | 技術 |
|---|---|
| 前端 | React + Vite（SPA） |
| 後端 | Cloudflare Workers + Hono |
| 資料庫 | Cloudflare D1（SQLite） |
| 部署 | GitHub → `wrangler deploy` |

## 開發

```bash
npm install
npm run db:migrate:local   # 建立本地 D1
npm run dev:api            # wrangler dev（port 8787）
npm run dev                # vite dev server（proxy /api → 8787）
```

## 部署

```bash
npx wrangler d1 create cubic_teamwork   # 第一次：把 database_id 填回 wrangler.jsonc
npm run db:migrate
npm run deploy
```

第一次打開網站會要求建立管理員帳號，之後由管理員在系統內新增成員。

## 介面原型

正式介面依照設計原型實作：心智圖（模塊完成度環）、任務樹（順序節點、
條件鎖定、負責人指派）、成員河流（deadline 排序、逾期標紅）。
