import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

type ContextBundle = {
  sourceFiles: string[];
  text: string;
};

function resolveRepoRoot() {
  const cwd = process.cwd();
  const appRootCandidate = existsSync(path.join(cwd, "package.json")) &&
      existsSync(path.join(cwd, "app")) &&
      existsSync(path.join(cwd, "server"))
    ? cwd
    : path.join(cwd, "apps", "web");

  if (
    existsSync(path.join(appRootCandidate, "package.json")) &&
    existsSync(path.join(appRootCandidate, "app")) &&
    existsSync(path.join(appRootCandidate, "server"))
  ) {
    return path.resolve(appRootCandidate, "../..");
  }

  return cwd;
}

const repoRoot = resolveRepoRoot();
const docsRoot = path.join(repoRoot, "docs");
const appRoot = path.join(repoRoot, "apps", "web");
const serverRoot = path.join(appRoot, "server");
const apiRoot = path.join(appRoot, "app", "api");

const OPERATOR_HANDBOOK = [
  "# 平台操作手册",
  "",
  "核心入口：",
  "- 工作台 `/`：看待办、提醒、闭环状态。",
  "- 知识库 `/kb/reviews`：上传资料、审核资料、检索资料。",
  "- AI 建站 `/sites`：创建站点、进入站点对话编辑、提交上线审批。",
  "- AI 设计 `/design`：生成内容包、进入内容包对话页、准备发布内容。",
  "- CRM 管道 `/crm`：查看线索、询盘、机会、活动，进入 AI 首响起草。",
  "- AI 首响审批 `/replies`：审阅、编辑、拒绝、确认发送首响草稿。",
  "- 报价助手 `/quotation`：生成报价草稿；价格、交期、认证都需要人工确认。",
  "- 跟进节奏 `/follow-up`：生成跟进计划，不自动发送。",
  "- 合规风险 `/compliance-risk`：看认证/制裁/标签提醒，最终仍需专业确认。",
  "- 通知中心 `/notifications`：统一看提醒，可标记已读/忽略。",
  "- 发布清单 `/publish-checklist`：聚合站点上线、内容发布、待审批任务。",
  "- 设置 `/settings`：成员、品牌、模型策略、数据请求、节假日、审计说明。",
  "",
  "平台规则：",
  "- 客户隐私数据（姓名、电话、询盘正文）只走本地模型。",
  "- 报价、交期、认证等关键承诺不能让 AI 自动定稿，必须人工确认。",
  "- 对外发送和发布动作仍走现有 HITL 审批流。",
  "- 切换租户后，页面数据、权限和操作范围都会跟随当前租户变化。",
  "",
  "常见操作路径：",
  "- 想回答客户：先在 CRM 或询盘详情定位线索，再进入 AI 首响审批。",
  "- 想补知识：去知识库上传或审核资料，再回站点/内容包/回复环节使用。",
  "- 想发布内容：先在设计页准备内容，再到发布清单统一处理待发布动作。",
  "- 想看治理和权限：优先去设置页和通知中心。",
].join("\n");

function limitText(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

async function safeRead(absolutePath: string, label: string, maxChars: number) {
  const content = await fs.readFile(absolutePath, "utf8");
  return `## ${label}\n${limitText(content, maxChars)}`;
}

async function listRouteFiles(absoluteDir: string, labelPrefix: string, maxFiles: number) {
  const entries: string[] = [];

  async function walk(currentDir: string) {
    const items = await fs.readdir(currentDir, { withFileTypes: true });

    for (const item of items) {
      const absolute = path.join(currentDir, item.name);
      const relative = `${labelPrefix}/${path.relative(absoluteDir, absolute).replaceAll("\\", "/")}`;

      if (item.isDirectory()) {
        await walk(absolute);
        continue;
      }

      if (item.isFile()) {
        entries.push(relative);
      }
    }
  }

  await walk(absoluteDir);
  entries.sort();
  return entries.slice(0, maxFiles);
}

async function buildOperatorGuideContext(): Promise<ContextBundle> {
  const sourceFiles = [
    "built_in/operator-handbook",
    "docs/HANDOVER.md",
  ];
  const handover = await safeRead(
    path.join(docsRoot, "HANDOVER.md"),
    "docs/HANDOVER.md",
    5000,
  );

  return {
    sourceFiles,
    text: [OPERATOR_HANDBOOK, handover].join("\n\n"),
  };
}

async function buildTechAssistantContext(): Promise<ContextBundle> {
  const packageJson = await safeRead(
    path.join(repoRoot, "package.json"),
    "package.json",
    5000,
  );
  const handover = await safeRead(
    path.join(docsRoot, "HANDOVER.md"),
    "docs/HANDOVER.md",
    7000,
  );
  const agents = await safeRead(
    path.join(repoRoot, "AGENTS.md"),
    "AGENTS.md",
    4000,
  );
  const env = await safeRead(
    path.join(appRoot, "lib", "env.ts"),
    "apps/web/lib/env.ts",
    2500,
  );
  const modelGateway = await safeRead(
    path.join(serverRoot, "model-gateway", "index.ts"),
    "apps/web/server/model-gateway/index.ts",
    4500,
  );
  const tenantAccess = await safeRead(
    path.join(serverRoot, "auth", "access.ts"),
    "apps/web/server/auth/access.ts",
    2500,
  );

  const skillRoutes = await listRouteFiles(
    path.join(apiRoot, "skills"),
    "apps/web/app/api/skills",
    60,
  );
  const settingsRoutes = await listRouteFiles(
    path.join(apiRoot, "settings"),
    "apps/web/app/api/settings",
    30,
  );

  const architectureSummary = [
    "# 技术上下文摘要",
    "",
    "项目结构：",
    "- 前端页面：`apps/web/app/*`（Next.js App Router）",
    "- API 路由：`apps/web/app/api/*`",
    "- 服务逻辑：`apps/web/server/*`",
    "- 认证：`apps/web/auth.ts` + `apps/web/server/auth/*`",
    "- 多租户：`apps/web/server/db/tenant-prisma.ts` + `apps/web/server/auth/access.ts`",
    "- 模型网关：`apps/web/server/model-gateway/index.ts`",
    "- 环境变量：`apps/web/lib/env.ts`",
    "",
    "常用脚本：",
    "- `npm run lint`",
    "- `npm run typecheck`",
    "- `npm run test`",
    "- `npm run test:redline`",
    "- `npm run test:closed-loop`",
    "- `npm run test:hardening`",
    "- `npm run build`",
    "",
    "Skills API 文件：",
    ...skillRoutes.map((file) => `- ${file}`),
    "",
    "Settings API 文件：",
    ...settingsRoutes.map((file) => `- ${file}`),
  ].join("\n");

  return {
    sourceFiles: [
      "package.json",
      "AGENTS.md",
      "docs/HANDOVER.md",
      "apps/web/lib/env.ts",
      "apps/web/server/model-gateway/index.ts",
      "apps/web/server/auth/access.ts",
      ...skillRoutes,
      ...settingsRoutes,
    ],
    text: [
      architectureSummary,
      packageJson,
      handover,
      agents,
      env,
      tenantAccess,
      modelGateway,
    ].join("\n\n"),
  };
}

let operatorGuidePromise: Promise<ContextBundle> | null = null;
let techAssistantPromise: Promise<ContextBundle> | null = null;

export function getOperatorGuideContext() {
  operatorGuidePromise ??= buildOperatorGuideContext();
  return operatorGuidePromise;
}

export function getTechAssistantContext() {
  techAssistantPromise ??= buildTechAssistantContext();
  return techAssistantPromise;
}
