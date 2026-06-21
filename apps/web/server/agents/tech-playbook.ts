type TechAssistantAnswerLike = {
  answer: string;
  source_files: string[];
  commands: string[];
  caveats: string[];
};

function normalizeQuestion(question: string) {
  return question.trim().toLowerCase();
}

export function getTechAssistantPlaybook(question: string): TechAssistantAnswerLike | null {
  const normalized = normalizeQuestion(question);

  if (
    (normalized.includes("qwen") || normalized.includes("bge") || normalized.includes("端点")) &&
    (normalized.includes("排查") || normalized.includes("不在线") || normalized.includes("在线") || normalized.includes("故障"))
  ) {
    return {
      answer: [
        "这个项目的本地模型端点按当前仓库约定是固定的：",
        "- Qwen 文本端点：`http://localhost:8080/v1`",
        "- bge-m3 embedding 端点：`http://localhost:8082/v1`",
        "",
        "建议按这个顺序排查：",
        "1. 先看环境变量：确认 `.env` 里的 `LOCAL_QWEN_BASE_URL`、`LOCAL_BGE_BASE_URL`、`LOCAL_QWEN_MODEL`、`LOCAL_BGE_MODEL` 是否与本地端点一致。",
        "2. 再看端口监听：`lsof -nP -iTCP:8080 -sTCP:LISTEN` 和 `lsof -nP -iTCP:8082 -sTCP:LISTEN`。",
        "3. 再做健康检查：Qwen 用 `curl http://localhost:8080/v1/models`；bge 用 `curl http://localhost:8082/health` 和 `curl http://localhost:8082/v1/models`。",
        "4. 如果 8082 不在线，直接执行 `npm run serve:bge-local`。",
        "5. 如果 8080 不在线，按 README 里的 `llama-server` 命令手动起 Qwen；这个项目目前没有把 Qwen 收进自动启动脚本。",
        "6. 如果端点在线但业务接口还报错，再检查 `apps/web/server/model-gateway/index.ts` 的调用路径，以及接口实际报的是 `LOCAL_MODEL_UNAVAILABLE` 还是别的 500/502。",
      ].join("\n"),
      source_files: [
        "README.md",
        "package.json",
        "apps/web/lib/env.ts",
        "apps/web/server/model-gateway/index.ts",
        "scripts/run-bge-local.sh",
      ],
      commands: [
        "lsof -nP -iTCP:8080 -sTCP:LISTEN",
        "lsof -nP -iTCP:8082 -sTCP:LISTEN",
        "curl http://localhost:8080/v1/models",
        "curl http://localhost:8082/health",
        "curl http://localhost:8082/v1/models",
        "npm run serve:bge-local",
      ],
      caveats: [
        "隐私路径依赖本地 Qwen；8080 不在线时，相关接口会返回 503，不允许回退到第三方。",
        "知识库向量化和检索依赖本地 bge；8082 不在线时，embedding 相关链路会失败。",
        "当前仓库只把 bge 做成了可复用脚本，Qwen 仍按 README 手动启动。",
      ],
    };
  }

  if (
    normalized.includes("新增") &&
    (normalized.includes("skill") || normalized.includes("tool"))
  ) {
    return {
      answer: [
        "按 AGENTS.md，这个项目新增 skill / tool 的标准落点是固定的：",
        "1. 服务逻辑放 `apps/web/server/<domain>/`。",
        "2. API 路由放 `apps/web/app/api/skills/<name>/route.ts`。",
        "3. 每个 skill / tool 都要补 `docs/skills/<name>/`，至少包含 `SKILL.md`、`input_schema.json`、`output_schema.json`、`examples.json`。",
        "4. 如果涉及客户隐私数据，模型调用必须统一走 `apps/web/server/model-gateway/`，并传 `sensitivity=INTERNAL_ONLY`，只能走本地 Qwen。",
        "5. 如果读写租户数据，必须复用 `apps/web/server/db/tenant-prisma.ts` 的租户隔离，不要裸查。",
        "6. 如果必须改现有文件，不要直接扩改，先说明要改哪些文件、为什么要改，再等确认。",
      ].join("\n"),
      source_files: [
        "AGENTS.md",
        "docs/HANDOVER.md",
        "apps/web/server/model-gateway/index.ts",
        "apps/web/server/db/tenant-prisma.ts",
      ],
      commands: [
        "npm run lint",
        "npm run typecheck",
      ],
      caveats: [
        "不要接 Gmail、WhatsApp、Stripe、HubSpot 等第三方连接器。",
        "不要改 schema 规避约束；优先只新增文件。",
        "对外发送、价格、交期、认证结论仍要保留人工把关链路。",
      ],
    };
  }

  if (
    normalized.includes("目录") ||
    normalized.includes("职责") ||
    normalized.includes("架构")
  ) {
    return {
      answer: [
        "项目主结构可以按四层理解：",
        "1. `apps/web/app/*`：页面与 App Router 路由。",
        "2. `apps/web/app/api/*`：HTTP API 路由层，只做鉴权、校验、调用服务。",
        "3. `apps/web/server/*`：业务服务层，放 skill、CRM、站点、知识库、模型网关、多租户访问等核心逻辑。",
        "4. `docs/*`：产品背景、交接、任务说明、skills 文档和验收资料。",
        "",
        "补充两条关键横切：",
        "- 认证/权限：`apps/web/auth.ts` + `apps/web/server/auth/*`。",
        "- 多租户隔离：`apps/web/server/db/tenant-prisma.ts` + `apps/web/server/auth/access.ts`。",
      ].join("\n"),
      source_files: [
        "docs/HANDOVER.md",
        "AGENTS.md",
        "apps/web/server/auth/access.ts",
        "apps/web/server/db/tenant-prisma.ts",
      ],
      commands: [],
      caveats: [
        "页面改 UI 时，不要动现有 fetchCurrentMe、X-Tenant-Id、权限判断和 HITL 流程。",
      ],
    };
  }

  if (
    normalized.includes("启动") ||
    normalized.includes("测试") ||
    normalized.includes("验收") ||
    normalized.includes("命令")
  ) {
    return {
      answer: [
        "本项目常用启动和验收命令如下：",
        "- 开发：`npm run dev`",
        "- 静态检查：`npm run lint`、`npm run typecheck`",
        "- 全量测试：`npm run test`",
        "- 关键闭环验收：`npm run test:closed-loop`",
        "- 隐私/权限加固：`npm run test:hardening`",
        "- 构建校验：`npm run build`",
        "- 数据库初始化：`npm run prisma:migrate`、`npm run prisma:seed`",
        "",
        "如果是完整本地启动，还要先起 Docker 依赖，并确保本地 Qwen / bge-m3 端点在线。",
      ].join("\n"),
      source_files: [
        "README.md",
        "package.json",
        "docs/HANDOVER.md",
      ],
      commands: [
        "docker compose up -d",
        "npm run prisma:migrate",
        "npm run prisma:seed",
        "npm run dev",
        "npm run lint",
        "npm run typecheck",
        "npm run test:closed-loop",
        "npm run build",
      ],
      caveats: [
        "隐私路径依赖本地 Qwen；端口 8080 不在线时，相关能力会返回 503，不允许回退到第三方。",
      ],
    };
  }

  return null;
}
