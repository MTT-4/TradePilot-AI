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

## Skills / Tools 扩展约束（新增 skill 或 tool 时必须遵守）

1. **优先只新增文件**：新 skill/tool 放 `apps/web/server/<domain>/` + `apps/web/app/api/skills/<name>/route.ts`，
   只读写现有表与服务；如必须修改现有文件，先说明改哪些、为什么，等人确认。
2. **隐私强制本地**：处理客户隐私数据（询盘正文/姓名/电话）时，model-gateway 调用必须传
   `sensitivity=INTERNAL_ONLY` 走本地 Qwen，绝不外发。
3. **不接第三方**：Gmail/WhatsApp/Stripe/Hunter/Apollo/ImportYeti/Similarweb/Langfuse/Sentry/PostHog/HubSpot
   等外部连接器已全部砍掉，禁止引入；保持全本地、零外发。
4. **AI 不碰钱与承诺**：价格/交期/认证不得 AI 自动生成最终值（关键数字人工填）；
   合规结论必须标"需专业机构确认"；任何对外发送走现有 HITL。
5. **统一文件结构**：每个 skill/tool 配 `docs/skills/<name>/`（SKILL.md + input/output schema + examples）。
6. 完成后 `npm run lint && npm run typecheck`，并输出新增/修改文件清单。

> 详见 `docs/codex_tasks/_指令前缀.md` 与 `docs/codex_tasks/TradePilot_Skill_Tool_落地执行计划_对齐现状版.md`。
> 现状：G1–G5 本地 skill 已实现（15 个 `/api/skills/*`），无需重做；codex 用于 review、增强或新需求。

## 参考

- 高保真原型：`docs/00_原始资料/TradePilot_完整高保真UI.html`
- 任务清单：`docs/00_原始资料/V1.0_开发任务清单与排期.md`
- 演示账号（需先 `npm run prisma:seed`）：`owner-a@tradepilot.local` / `TradePilot@2026`
