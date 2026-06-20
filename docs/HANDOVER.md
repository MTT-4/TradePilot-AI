# 交接说明（给接手开发的 AI / 工程师）

> 本文档记录最近一轮改动与后续开发约定，作为 Codex / 其他代理继续开发的共同上下文。
> 配套参考：`docs/00_原始资料/TradePilot_完整高保真UI.html`（高保真原型）、`docs/00_原始资料/V1.0_开发任务清单与排期.md`（实现依据）。

## 1. 最近改动（已提交到 `main`）

```
f94f11c ci: upgrade github actions runtimes
dcea1f9 test: stabilize t6.4 acceptance fixture
a8b03ea fix: harden ci and settings operations
0aac4c3 feat: add compliance console and rbac coverage
530d747 feat: restyle content pack chat workspace
91788c2 feat: restyle site chat workspace
```

## 2. 开始前请先做

1. 确认同步：`git log --oneline -5` 应能看到以上提交；`git status` 应为干净。
2. 如遇 `.git/index.lock` 报错：`rm -f .git/index.lock`；再 `rm -rf apps/web/tmp`（构建临时产物，已被 gitignore）。
3. `npm install` 重装依赖（此前为在 Linux 沙箱跑测试，往 `node_modules` 加过原生二进制，重装即恢复干净）。
4. 验证基线：`npm run lint`、`npm run typecheck`、`npm run test` 当前均已通过。
   如需本地完整复现，先 `docker compose up -d` + `npm run prisma:migrate` + `npm run prisma:seed`。

## 3. 已完成（不要重复做）

- **设计系统**集中在 `apps/web/app/globals.css`：teal 主题 CSS 变量 + 组件类
  （`card / btn / badge / st / stat-strip / kanban / pk(pack-grid) / row-card / hitl-item / loop / chat / pv-* / drop / fixes` 等）。
  改样式优先复用这些类，不要再写一次性 Tailwind 硬编码颜色。
- **共享框架** `apps/web/app/_components/app-shell.tsx`：深色侧边栏 + 顶栏，在 `layout.tsx` 里包裹所有页面；
  `/login` 与 `/site/`（对外站点）会自动不套框架。导航高亮跟随路由，顶栏铃铛拉真实未读数。
- **字体**：`layout.tsx` 用 next/font 接入 Space Grotesk / Inter / Space Mono，变量对应 globals.css 的 `--font-*`。
- **已按原型改版的页面**：工作台 (`/`)、登录 (`/login`)、知识库 (`/kb/reviews`)、站点 (`/sites`)、
  内容包 (`/design`)、CRM (`/crm`)、首响审批 (`/hitl`)、站点对话编辑 (`/sites/[id]/chat`)、
  内容包对话 (`/content-packs/[id]/chat`)、通知中心 (`/notifications`)、发布清单 (`/publish-checklist`)、设置 (`/settings`)。
  所有数据接线 / API 调用 / 权限判断均未改，只换外观或做聚合展示。
- **权限与合规**：
  - `/settings` 已接入成员管理、数据请求（导出 / 删除）、品牌配置表单、模型策略表单、模型用量与审计基线；
  - `t7.1` RBAC 测试已补齐 owner/admin/operator/sales/viewer 的权限覆盖；
  - `t7.2` 数据请求服务 / API / 测试已落地，保留审计链路。
- **治理入口**：
  - 侧栏已新增 `/notifications` 与 `/publish-checklist`，顶部铃铛保留快捷入口并可跳完整通知页；
  - `/publish-checklist` 聚合站点上线、内容发布与待审批任务，减少在 `/sites`、`/design`、`/hitl` 之间来回切换；
  - `/notifications` 已支持对真实通知执行“标记已读 / 忽略(archived)”动作，派生的 HITL 待办仍需回具体事项处理。
- **闭环验收与 CI**：
  - `T6.4` 18 步闭环验收测试已稳定化，不再依赖脆弱 seed 内容包模板；
  - GitHub Actions 现有 `quality` + `closed-loop` 两个 job，使用 `pgvector/pgvector:pg16`，并带 `ops:check-secrets` 检查；
  - CI / `.nvmrc` / README 已统一到 Node 22 基线。
- **演示账号**（在 `prisma/seed.ts`，需重新 `npm run prisma:seed` 生效）：
  - `owner-a@tradepilot.local` / `TradePilot@2026`（所有者 · 租户 A，未开 2FA，可直接登录）
  - 另有 `sales-a` / `owner-b` / `sales-b`，密码相同。上线前务必改密码并按需启用 2FA。

## 4. 待继续做（参照高保真原型）

1. **对外站点页** `apps/web/app/site/[slug]/[locale]/page.tsx` 是客户访问的落地页，保持独立风格，不要套后台框架。
2. **设置页下一步可补**：如果要继续深挖，优先补更细粒度的策略说明、变更历史和回滚，而不是继续堆只读摘要。
3. **如果要继续做平台升级**：下一轮可以评估 Node 22 之外的依赖升级，但先以当前 CI 全绿为基线，不要在同一提交里混入无关重构。

## 5. 开发约定

- 复用 `globals.css` 的组件类，避免重复造样式；新增通用样式也加到 globals.css。
- 页面内容直接渲染即可——外层框架（侧边栏 + 顶栏 + `.content` 容器）由 AppShell 提供，**不要再加整页 `<main>` 背景**。
- 保持每个页面原有的数据获取（`fetchCurrentMe` + `X-Tenant-Id` 头）、权限判断与 HITL 审批逻辑。
- 隐私 / 安全红线：客户隐私数据（姓名、电话、询盘正文）只走本地 Qwen，绝不发往 OpenAI / Google；
  多租户隔离统一在 `apps/web/server/db/tenant-prisma.ts`，新增模型注意 `tenantId` 注入。
- 每完成一块：`npm run lint && npm run typecheck` 通过，尽量补 / 跑相关测试后再提交，提交信息写清改了什么。

## 6. 环境与启动（本机 Mac）

```bash
nvm use
cp .env.example .env          # 填好 OPENAI / GOOGLE 等密钥
npm install
docker compose up -d          # postgres(pgvector) + redis + minio
npm run prisma:migrate
npm run prisma:seed
npm run dev                   # http://localhost:3100
# 本地模型端点（llama.cpp）见 README：Qwen :8080 / bge-m3 :8082
```
