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
  - 顶栏头像是账号菜单（邮箱/租户、设置入口、退出登录走 `POST /api/auth/logout`）。
  - **多标签栏**：访问过的页面在顶栏下累积为可切换/可关闭标签，状态存在 AppShell（路由切换不重挂、整页刷新重置）。
    标签标题由 `resolveTitle(pathname)` 决定；新增顶层路由时在 `TITLE_BY_PREFIX` 里补标题。
    注意该机制用 `useEffect` 累积标签，改 AppShell 时勿误删（已对该处 setState-in-effect 加 lint 豁免）。
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
- **已补齐的前端入口（接现有 API，勿重复做）**：
  - 知识库 `/kb/reviews`：上传区(`POST /api/kb/documents`)、文档列表+失败重试(`/kb/documents/[id]/retry`)、
    公开检索框(`POST /api/kb/search`)。
  - 站点 `/sites`：「新建站点」表单 → `POST /api/sites/generate`。
  - 内容包 `/design`：「新建内容包」表单 → `POST /api/content-packs/generate`。
  - CRM `/crm`：看板每卡「移至阶段」下拉 → `PATCH /api/crm/opportunities/[id]/stage`。
  - 中文标签字典 `apps/web/app/_lib/labels.ts`：状态/角色/敏感度等枚举统一中文化，新页面请复用。
  - 对外站点页询盘表单已接线：`app/site/[slug]/[locale]/inquiry-form.tsx` → `POST /api/public/leads/form`
    （`getPublicSiteLocalePageData` 已返回 `tenantSlug`）。

## 4. 待继续做（参照高保真原型）

1. **对外站点页** `apps/web/app/site/[slug]/[locale]/page.tsx` 是客户访问的落地页，保持独立风格，不要套后台框架。
2. **设置页下一步可补**：如果要继续深挖，优先补更细粒度的策略说明、变更历史和回滚，而不是继续堆只读摘要。
3. **如果要继续做平台升级**：下一轮可以评估 Node 22 之外的依赖升级，但先以当前 CI 全绿为基线，不要在同一提交里混入无关重构。

### 4.1 新需求：建站/设计 引用素材与品牌包（需 DB 环境）

底座已具备：对象存储 `apps/web/server/storage/object-store.ts`（`putTenantObject` 等）、品牌包
`brandKit` 模型 + `apps/web/server/settings/service.ts`、知识库 `sensitivity`(PUBLIC/INTERNAL_ONLY)。

1. 新增 `ContentAsset` 模型（tenantId、objectKey、mimeType、fileName、kind、createdByUserId），写迁移。
   租户隔离是排除式（`server/db/tenant-models.ts`），新模型只要带 `tenantId` 即自动纳入。
2. 上传接口 `POST /api/assets`（multipart，ADMIN/operator），用 `putTenantObject` 落库；
   前端在 `sites/[id]/chat` 和 `design` 加"上传本地素材"区（复用 `.drop` 样式）。
3. 生成请求（`createSiteGenerationRequest` / `createContentPackGenerationRequest`）入参增加
   `assetIds[]`、`knowledgeDocumentIds[]`、`referenceBrandKit: boolean`。
4. **隐私红线（务必）**：进入对外内容的知识库引用必须过滤 `INTERNAL_ONLY`（参考 model-gateway 的
   `buildKnowledgeContext(..., allowInternalOnly=false)`）。补测试：传入 internal_only 文档，
   断言它不进入生成的公开内容。

### 4.2 新需求：按国家习惯/节假日推荐推广时间

纯逻辑核心**已完成**：`apps/web/server/scheduling/promotion-timing.ts`
（`recommendPromotionTiming`，含 t8.1 单测）。待接线：

1. 新增 `GET /api/scheduling/promotion-timing?country=XX`（带租户鉴权），调用上面的函数。
2. 在内容包 / 发布清单页展示"建议投放时段 + 节假日提醒"，并把建议时间预填到发布清单的"计划时间"。
3. 节假日为起步数据、需按年核对；可在 `/settings` 增加运营维护各国节假日的入口（后续可选）。

### 4.3 新需求：自动扫描本地已下载模型，供设置页选择

纯逻辑核心**已完成**：`apps/web/server/model-gateway/local-models.ts`
（`scanLocalModels(baseDir, {maxDepth})` 扫描 `.gguf`、按文件名分类 chat/embedding、给出建议别名，
缺目录返回 []；含 t8.2 单测）。待接线：

1. 在 `lib/env.ts` 增加可选 `LOCAL_MODELS_DIR`（默认 README 约定目录，如 `~/AI/models`），并补进 `.env.example`。
2. 新增 `GET /api/settings/local-models`（ADMIN 鉴权）：调用 `scanLocalModels(env.LOCAL_MODELS_DIR)` 返回模型列表。
3. 在 `/settings` 的"模型策略"表单：加"扫描本地模型"按钮 + 下拉，把所选 chat 模型写入 `localQwenModel`、
   embedding 模型写入 `localBgeModel`（沿用 `server/settings/service.ts` 的 `modelPolicySchema`/`upsertModelPolicy`）。
4. 注意：扫描只读本机文件、要服务端执行；不要把绝对路径暴露给非管理员。

### 4.4 闭环缺口：AI 首响（本地 Qwen）审阅 / 编辑 / 发送界面（需 DB 环境）

现状：后端只有 `requestReplyDraft`（建草稿+建 REPLY_SEND HITL 任务）和 `approveReplySendTask`（审批即发送），
见 `apps/web/server/replies/service.ts`；**前端完全没有首响相关界面**，`/hitl` 只能盲批。
这是闭环核心一环（本地 Qwen 首响草稿 → 人工审 → 发送），原型有专门的"AI 首响审批"屏（询盘正文 + 草稿对照 + 编辑/拒绝/发送）。待做：

1. 后端补「获取草稿详情」与「编辑草稿正文」接口（如 `GET /api/replies/[id]`、`PATCH /api/replies/[id]`），
   只允许 sales 及以上、PENDING_APPROVAL 状态可改；隐私红线：草稿生成只走本地 Qwen。
2. 新建 `/replies` 审阅页（套 AppShell）：左侧询盘正文（含机器翻译），右侧本地 Qwen 草稿，
   支持编辑、拒绝、确认发送（发送沿用 `approveReplySendTask` / `/api/hitl/[id]/approve`）。复用 `.reply-grid/.inq/.draft/.cite` 等类。
3. 起草入口：在询盘/线索处加"用 AI 起草首响"按钮 → `POST /api/replies/draft`。
4. 侧栏可把"AI 首响审批"指向 `/replies`（目前指向 `/hitl`）。

### 4.5 缺口：询盘 / 邮件 / 线索详情视图（需 DB 环境）

现状：无 inquiry 列表接口、无线索详情页；CRM 仅有 leads 表 + 最新询盘摘要；inbound-email 入库后前端不可见。待做：

1. 新增询盘列表接口（如 `GET /api/crm/inquiries`，租户+角色鉴权）与"询盘线索池"视图（原型有，可并入 `/crm` 或独立页）。
2. 线索详情页/抽屉：展示来源归因、历史询盘、活动（`/api/crm/leads/[id]`、`/api/crm/activities` 已存在），并提供进入首响起草的入口。
3. 邮件询盘可见：把 inbound-email 来源的询盘并入上述列表（按 sourceType 标注）。

### 4.6 缺口（低优先 / 部分属 M7）

- 任务监控页：`/api/jobs`、`/api/jobs/[id]` 有接口、无界面，可加只读运维页。
- 追踪链接管理页、租户创建/切换：原型/M7 范围，可缓做。

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
