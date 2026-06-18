# Codex 任务指令 · 第一批（M0 · T0.1–T0.3）

> **怎么用：** 一次只发一个任务（T0.1 完成并由 Claude 审核通过、创始人验收后，再发 T0.2，依此类推）。每个任务把对应小节**整段**粘给 Codex 即可。
> **共同上下文（每个任务都让 Codex 先读）：** 仓库 `/docs` 下的《数据库 Schema 契约》《API 契约》《UI 数据契约》《E2E 测试骨架》《开发任务清单与排期》。**契约是规格，不是建议；不得擅自改表结构、端点、隔离/隐私红线。**

---

## 通用规则（适用于全部任务）

**技术栈（已定，不要改选）：** Next.js(App Router)+TypeScript · Tailwind + shadcn/ui · PostgreSQL + pgvector · Prisma · BullMQ + Redis · Auth.js · S3 兼容(MinIO) · 模型网关接 OpenAI / Google 翻译 / 本地 llama.cpp(Qwen+bge-m3)。

**运行环境（前期）：** 单机部署在 Mac M5 128G（Apple Silicon）。本地依赖用 Docker Compose 起：Postgres(pgvector)、Redis、MinIO；Qwen/bge-m3 由 llama.cpp `llama-server` 暴露 OpenAI 兼容端点，地址走环境变量。

**交付方式：** 新建分支 → 实现 → 跑 `npm run check`（lint+typecheck+test）→ 开 PR，PR 描述里附"红线自检表"（逐条说明如何满足本任务红线）。**任何涉及密钥、对外请求、隐私路由的改动，显式标注等待人工/Claude 审核。**

**全局红线（任何任务都不得违反）：**
1. 不提交任何真实密钥；`.env` 进 `.gitignore`，只提交 `.env.example` 占位。
2. 不超范围：本批只做地基，**不实现任何业务功能/页面/对外端点**。
3. 不偏离契约的表名、字段、枚举、隔离与隐私约束。

---

## T0.1 · 项目脚手架

**目标：** 建一个可运行的空骨架，后续任务在上面长。

**交付物：**
- Next.js+TS+Tailwind+shadcn/ui 初始化；`tsconfig` strict。
- 目录结构：`/app`、`/components`、`/lib`、`/server`（服务层）、`/db`（prisma）、`/jobs`（worker）、`/tests`、`/docs`（放契约）。
- 工具链：ESLint + Prettier；`npm run check` = lint + typecheck + test。
- **环境变量校验**（用 zod）：`DATABASE_URL`、`REDIS_URL`、`S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET`、`AUTH_SECRET`、`APP_URL`、`OPENAI_API_KEY`、`GOOGLE_TRANSLATE_KEY`、`LOCAL_QWEN_BASE_URL`、`LOCAL_QWEN_MODEL`、`LOCAL_BGE_BASE_URL`、`LOCAL_BGE_MODEL`。`.env.example` 列全占位值。
- `docker-compose.yml`：`pgvector/pgvector:pg16`、`redis:7`、`minio/minio`（含 healthcheck 与数据卷）。
- `GET /api/health` → `{status:"ok", db, redis}`（探活，不连业务表）。
- `README.md`：Mac M5 启动步骤（含如何用 llama.cpp 起 Qwen 与 bge-m3 两个端点、填进 `.env`）。

**不做：** 任何业务表、页面、API（除 health）、鉴权逻辑。

**验收：**
- `docker compose up -d` 起好三个依赖；`npm install && npm run dev` 能启动。
- 访问 `/api/health` 返回 ok 且 db/redis 探活通过。
- `npm run check` 全绿。
- 缺任一必需环境变量时，应用启动**明确报错**（zod 校验生效）。

**红线：** 不提交密钥；`.env` 已 gitignore；除 health 外无其它端点。

---

## T0.2 · 数据模型与 Prisma（[关键审核]）

**目标：** 按《Schema 契约》实现完整 Prisma schema + 迁移 + 种子。

**参考：** `/docs/数据库Schema契约.md`（33 张表 + 枚举 + 硬约束）。

**交付物：**
- `prisma/schema.prisma`：**完整实现契约里全部表与枚举**，逐条对齐：
  - 除 `tenants/users/platform_rules` 外，**每张表必有 `tenantId` 字段 + `@@index([tenantId])` + 指向 tenants 的关系**。
  - 主键 `cuid()`；`createdAt/updatedAt`；契约标注的表加 `deletedAt`。
  - 枚举严格按契约第 4 节命名。
  - 启用 `previewFeatures = ["postgresqlExtensions"]`，`extensions = [vector]`；`knowledge_chunks.embedding` 用 `Unsupported("vector(1024)")`；在迁移 SQL 里建向量索引（HNSW 或 IVFFlat）。
- 迁移：`prisma migrate dev` 生成可用迁移；pgvector 扩展在迁移中 `CREATE EXTENSION IF NOT EXISTS vector`。
- `prisma/seed.ts`：按《E2E 骨架》§0 造种子——租户 **A=晟海机械 / B=对照公司**，各 1 owner + 1 sales；A 含样本知识库（产品手册 / 报价[仅内部] / 认证）、1 站点、1 内容包（9 平台 items + tracking_links）、2 条样本询盘。

**不做：** 任何查询逻辑、API、租户过滤中间件（留给 T0.3）。

**验收：**
- `prisma migrate dev` 与 `prisma generate` 干净通过；pgvector 扩展与向量索引创建成功。
- `prisma db seed` 后，A/B 两租户与样本数据齐全。
- 用脚本断言：**所有 tenant-scoped 表都含 `tenantId`**（可用 schema 解析或 introspection 校验）。
- 枚举值与契约第 4 节逐一一致。

**红线：**
- **任何 tenant-scoped 表都不得缺 `tenantId`。**
- **不得增删/重命名核心表、不得改枚举值**；如契约有歧义，先在 PR 里提出，不擅自决定。

---

## T0.3 · 多租户中间件与强制隔离（[关键审核] · 红线任务）

**目标：** 让**所有**对租户数据的读写在数据访问层强制带 `tenantId`，杜绝越权；并实现租户上下文与 membership 校验。

**参考：** 《Schema 契约》硬约束 #1；《API 契约》§0（`X-Tenant-Id` 校验）；《E2E 骨架》R1。

**交付物：**
- **租户上下文**：从会话取当前用户，读 `X-Tenant-Id`，**服务端校验该用户在此租户有有效 membership**，否则返回 403 `FORBIDDEN`。无 membership 不得继续。
- **数据层强制隔离**：用 Prisma Client Extension（`$extends`）对所有 tenant-scoped 模型：
  - 读（findMany/findFirst/count/aggregate）自动注入 `where.tenantId = ctx.tenantId`；
  - 写（create/update/delete/upsert）强制带/校验 `tenantId`；
  - **若调用时没有租户上下文，直接抛错**（不允许"裸查"tenant-scoped 表）。
  - 提供 `getTenantPrisma(ctx)` 返回受约束的 client；业务代码只能拿它，不直接用全局 client 查业务表。
- **审计**：越权尝试（membership 校验失败）写 `audit_logs`。
- **R1 红线测试**（Playwright/集成）：实现并通过 R1.1（带他人 tenantId 调读端点→403/空）、R1.2（查他租户 id→NOT_FOUND）、R1.3（向量检索按 tenant 隔离——用种子数据验证 B 检索不到 A 的 chunk）。再加一条：**对 tenant-scoped 表发起无上下文查询 → 抛错**。
- 为演示隔离，可加 1 个最小只读探针端点（如 `GET /api/_probe/leads`，仅测试用、标注 internal），不算业务功能。

**不做：** 业务端点、页面、RBAC 细粒度操作授权（角色枚举已在 schema，细粒度授权留后续任务）。

**验收：**
- R1.1 / R1.2 / R1.3 + "无上下文裸查抛错" 四条测试全绿。
- 代码审查可见：业务侧无法绕过 `getTenantPrisma` 直接查 tenant-scoped 表（全局 client 对业务表的直接使用应被 lint 规则或封装阻止）。
- membership 校验失败有 audit_log。

**红线（最高优先级，Claude 重点审）：**
- **任何 tenant-scoped 查询不得在缺 `tenantId` 条件时执行**——必须在数据层强制，而不是依赖每个端点"记得加"。
- 租户身份**只能**来自服务端会话 + membership 校验，**不得**信任前端传入的任意 tenantId 而不校验。
- R1 测试不得用 skip/标记绕过。

---

## 审核与推进

- 每个任务 Codex 交 PR 后，**Claude 对照本指令的"验收"与"红线"逐条审**；红线任一不满足即退回，不合并。
- T0.1→T0.2→T0.3 顺序执行，**T0.3 的隔离没立住之前，不要开始任何业务模块**（M1 起的功能全建立在隔离地基上）。
- 创始人在每个任务 PR 合并前做一次"能跑通吗"的确认。
