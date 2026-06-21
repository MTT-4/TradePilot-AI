import { KnowledgeSensitivity, ModelTaskType } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import type { TenantContext } from "@/server/db/tenant-context";
import { createModelGateway } from "@/server/model-gateway";
import { logSkillEvent } from "@/server/observability/basic-log";
import { extractJsonObject } from "@/server/agents/json";
import { getOperatorGuideContext } from "@/server/agents/internal-context";
import { getOperatorGuidePlaybook } from "@/server/agents/operator-playbook";

const operatorGuideAnswerSchema = z.object({
  answer: z.string().default(""),
  next_actions: z.array(z.string()).default([]),
  suggested_questions: z.array(z.string()).default([]),
  source_files: z.array(z.string()).default([]),
});

export type OperatorGuideAnswer = z.infer<typeof operatorGuideAnswerSchema>;

const OPERATOR_GUIDE_SYSTEM_PROMPT = [
  "你是 TradePilot 平台的操作指导智能体，只回答平台怎么操作、页面入口、流程顺序、注意事项。",
  "你只能依据给定上下文回答，不能编造不存在的页面、按钮、权限或流程。",
  "如果上下文不足，请明确说“根据当前内置资料无法确认”，并提示用户联系管理员或技术人员。",
  "输出 JSON：",
  "{",
  '  "answer": "string",',
  '  "next_actions": ["string"],',
  '  "suggested_questions": ["string"],',
  '  "source_files": ["string"]',
  "}",
  "answer 用中文，尽量给出页面路径和操作顺序；不要输出 markdown 代码块。",
].join("\n");

export async function answerOperatorGuide(params: {
  tenantContext: TenantContext;
  userId?: string;
  question: string;
  fetchImpl?: typeof fetch;
}): Promise<OperatorGuideAnswer> {
  const playbook = getOperatorGuidePlaybook(params.question);

  if (playbook) {
    await logSkillEvent({
      tenantId: params.tenantContext.tenantId,
      actorUserId: params.userId,
      action: "operator_guide_answered",
      entityType: "operator_guide",
      entityId: params.question.trim().slice(0, 80) || "question",
      metadata: {
        route: "playbook",
        sourceFiles: playbook.source_files,
      },
    });

    return operatorGuideAnswerSchema.parse(playbook);
  }

  const context = await getOperatorGuideContext();
  const gateway = createModelGateway({ fetchImpl: params.fetchImpl });

  const result = await gateway.invoke({
    tenantContext: params.tenantContext,
    userId: params.userId,
    taskType: ModelTaskType.GENERATE,
    sensitivity: KnowledgeSensitivity.INTERNAL_ONLY,
    temperature: 0.2,
    systemPrompt: OPERATOR_GUIDE_SYSTEM_PROMPT,
    prompt: [
      `用户问题：${params.question.trim()}`,
      "",
      "内部资料：",
      context.text,
    ].join("\n"),
    requestSummary: `operator guide ${params.question.trim()}`,
  });

  let parsed: OperatorGuideAnswer;
  try {
    parsed = operatorGuideAnswerSchema.parse(extractJsonObject(result.text));
  } catch {
    throw new ApiError(
      502,
      "MODEL_OUTPUT",
      "Operator guide output failed schema validation.",
    );
  }

  const normalized: OperatorGuideAnswer = {
    ...parsed,
    source_files: parsed.source_files.length > 0
      ? parsed.source_files
      : context.sourceFiles,
  };

  await logSkillEvent({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.userId,
    action: "operator_guide_answered",
    entityType: "operator_guide",
    entityId: params.question.trim().slice(0, 80) || "question",
    metadata: {
      route: result.route,
      invocationId: result.invocationId,
      sourceFiles: normalized.source_files,
    },
  });

  return normalized;
}
