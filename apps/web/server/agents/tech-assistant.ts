import { KnowledgeSensitivity, ModelTaskType } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import type { TenantContext } from "@/server/db/tenant-context";
import { createModelGateway } from "@/server/model-gateway";
import { logSkillEvent } from "@/server/observability/basic-log";
import { extractJsonObject } from "@/server/agents/json";
import { getTechAssistantContext } from "@/server/agents/internal-context";
import { getTechAssistantPlaybook } from "@/server/agents/tech-playbook";

const techAssistantAnswerSchema = z.object({
  answer: z.string().default(""),
  source_files: z.array(z.string()).default([]),
  commands: z.array(z.string()).default([]),
  caveats: z.array(z.string()).default([]),
});

export type TechAssistantAnswer = z.infer<typeof techAssistantAnswerSchema>;

const TECH_ASSISTANT_SYSTEM_PROMPT = [
  "你是 TradePilot 项目的技术智能体，面向技术人员答复架构、目录、路由、服务、脚本、排障与联调问题。",
  "你只能依据给定上下文回答，不能编造不存在的文件、命令、接口或环境变量。",
  "优先给出实际文件路径、API 路径、命令和排查顺序。",
  "如果上下文不足，请明确说“根据当前内置资料无法确认”，不要假设。",
  "输出 JSON：",
  "{",
  '  "answer": "string",',
  '  "source_files": ["string"],',
  '  "commands": ["string"],',
  '  "caveats": ["string"]',
  "}",
  "answer 用中文；commands 只放命令；caveats 放风险或前提条件。",
].join("\n");

export async function answerTechAssistant(params: {
  tenantContext: TenantContext;
  userId?: string;
  question: string;
  fetchImpl?: typeof fetch;
}): Promise<TechAssistantAnswer> {
  const playbook = getTechAssistantPlaybook(params.question);

  if (playbook) {
    await logSkillEvent({
      tenantId: params.tenantContext.tenantId,
      actorUserId: params.userId,
      action: "tech_assistant_answered",
      entityType: "tech_assistant",
      entityId: params.question.trim().slice(0, 80) || "question",
      metadata: {
        route: "playbook",
        sourceFiles: playbook.source_files,
      },
    });

    return techAssistantAnswerSchema.parse(playbook);
  }

  const context = await getTechAssistantContext();
  const gateway = createModelGateway({ fetchImpl: params.fetchImpl });

  const result = await gateway.invoke({
    tenantContext: params.tenantContext,
    userId: params.userId,
    taskType: ModelTaskType.GENERATE,
    sensitivity: KnowledgeSensitivity.INTERNAL_ONLY,
    temperature: 0.1,
    systemPrompt: TECH_ASSISTANT_SYSTEM_PROMPT,
    prompt: [
      `技术问题：${params.question.trim()}`,
      "",
      "项目资料：",
      context.text,
    ].join("\n"),
    requestSummary: `tech assistant ${params.question.trim()}`,
  });

  let parsed: TechAssistantAnswer;
  try {
    parsed = techAssistantAnswerSchema.parse(extractJsonObject(result.text));
  } catch {
    throw new ApiError(
      502,
      "MODEL_OUTPUT",
      "Tech assistant output failed schema validation.",
    );
  }

  const normalized: TechAssistantAnswer = {
    ...parsed,
    source_files: parsed.source_files.length > 0
      ? parsed.source_files
      : context.sourceFiles.slice(0, 20),
  };

  await logSkillEvent({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.userId,
    action: "tech_assistant_answered",
    entityType: "tech_assistant",
    entityId: params.question.trim().slice(0, 80) || "question",
    metadata: {
      route: result.route,
      invocationId: result.invocationId,
      sourceFiles: normalized.source_files,
    },
  });

  return normalized;
}
