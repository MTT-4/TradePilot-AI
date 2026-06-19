# AGENTS.md

TradePilot AI · 本地优先的 AI 外贸营销获客平台（Next.js App Router + TS + Tailwind v4 + Prisma/PostgreSQL）。
完整背景、已完成/待办、启动步骤见 `docs/HANDOVER.md`（需要细节时再读）。

## 铁律

1. **UI 复用设计系统**：样式优先用 `apps/web/app/globals.css` 里的组件类
   （`card / btn / badge / st / stat-strip / kanban / pk / row-card / hitl-item / chat / split / preview` 等），
   不要硬编码一次性颜色。
2. **页面别套整页背景**：侧边栏 + 顶栏 + `.content` 容器由 `apps/web/app/_components/app-shell.tsx` 统一提供；
   页面组件直接渲染内容即可。`/login` 与对外站点 `/site/*` 不套框架。
3. **隐私红线**：客户隐私数据（姓名、电话、询盘正文）只走本地 Qwen，绝不发往 OpenAI / Google。
4. **多租户隔离**：数据访问走 `apps/web/server/db/tenant-prisma.ts`；新增模型注意 `tenantId` 注入与校验。
5. **保留数据/权限逻辑**：改 UI 时不要动各页原有的数据获取（`fetchCurrentMe` + `X-Tenant-Id`）、权限判断与 HITL 审批流。

## 提交前

- `npm run lint && npm run typecheck` 必须通过；尽量补/跑相关测试。
- 提交信息写清改了什么。

## 参考

- 高保真原型：`docs/00_原始资料/TradePilot_完整高保真UI.html`
- 任务清单：`docs/00_原始资料/V1.0_开发任务清单与排期.md`
- 演示账号（需先 `npm run prisma:seed`）：`owner-a@tradepilot.local` / `TradePilot@2026`
