import { KnowledgeSensitivity, ModelTaskType, Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import type { TenantContext } from "@/server/db/tenant-context";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import { createModelGateway } from "@/server/model-gateway";

/**
 * Skill: inquiry_detection（询盘识别）
 * 契约见 docs/skills/inquiry_detection/。
 * 落库映射：结构化结果写入 Inquiry.rawPayload.analysis（不改库）。
 * 隐私红线：询盘正文为敏感数据，sensitivity=INTERNAL_ONLY 强制走本地 Qwen。
 */

const intentTypes = [
  "price_request",
  "sample_request",
  "product_info",
  "partnership",
  "unknown",
] as const;
const levels = ["low", "medium", "high"] as const;

export const inquiryAnalysisSchema = z.object({
  language: z.string().default(""),
  country: z.string().default(""),
  company_name: z.string().default(""),
  contact_name: z.string().default(""),
  product_interest: z.string().default(""),
  specifications: z.array(z.string()).default([]),
  quantity: z.string().default(""),
  intent_type: z.enum(intentTypes).default("unknown"),
  asks_for_price: z.boolean().default(false),
  asks_for_sample: z.boolean().default(false),
  asks_for_certification: z.boolean().default(false),
  asks_for_delivery_time: z.boolean().default(false),
  asks_for_payment_terms: z.boolean().default(false),
  urgency: z.enum(levels).default("low"),
  quality_signal: z.enum(levels).default("low"),
  risk_flags: z.array(z.string()).default([]),
  summary_zh: z.string().default(""),
});

export type InquiryAnalysis = z.infer<typeof inquiryAnalysisSchema>;

const SYSTEM_PROMPT = [
  "你是外贸询盘识别助手。把客户询盘整理成结构化 JSON，只输出 JSON，不要解释。",
  "字段：language, country, company_name, contact_name, product_interest, specifications(array),",
  "quantity, intent_type(price_request|sample_request|product_info|partnership|unknown),",
  "asks_for_price, asks_for_sample, asks_for_certification, asks_for_delivery_time,",
  "asks_for_payment_terms（布尔）, urgency(low|medium|high), quality_signal(low|medium|high),",
  "risk_flags(array，垃圾/诈骗等信号), summary_zh（中文一句话摘要）。",
  "客户未提供的字段留空字符串或空数组，绝不编造公司、数量、规格。",
].join("\n");

/** 从模型输出里稳健地抽出 JSON 对象。 */
export function extractJsonObject(text: string): unknown {
  const fenced = text.replace(/```json/gi, "```").trim();
  const withoutFence = fenced.startsWith("```")
    ? fenced.replace(/^```/, "").replace(/```$/, "").trim()
    : fenced;
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new ApiError(502, "MODEL_OUTPUT", "Inquiry detection model returned no JSON.");
  }
  return JSON.parse(withoutFence.slice(start, end + 1));
}

async function getAccessibleInquiryOrThrow(params: {
  tenantContext: TenantContext;
  inquiryId: string;
}) {
  const prisma = getTenantPrisma(params.tenantContext);
  const inquiry = await prisma.inquiry.findFirst({
    where: {
      id: params.inquiryId,
    },
    select: {
      id: true,
      subject: true,
      body: true,
      fromEmail: true,
      fromName: true,
      sourceType: true,
      rawPayload: true,
      lead: {
        select: {
          ownerUserId: true,
          companyName: true,
          country: true,
          contact: { select: { name: true, phone: true, whatsapp: true } },
        },
      },
    },
  });

  if (!inquiry) {
    throw new ApiError(404, "NOT_FOUND", "Inquiry not found.");
  }

  if (
    params.tenantContext.role === "SALES" &&
    inquiry.lead.ownerUserId !== params.tenantContext.userId
  ) {
    throw new ApiError(403, "FORBIDDEN", "Sales users can only access their own inquiries.");
  }

  return inquiry;
}

async function createAuditLog(params: {
  tenantContext: TenantContext;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const prisma = getTenantPrisma(params.tenantContext);
  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata,
    },
  });
}

/**
 * 分析单条询盘，返回结构化结果并写入 Inquiry.rawPayload.analysis。
 */
export async function analyzeInquiry(params: {
  tenantContext: TenantContext;
  userId?: string;
  inquiryId: string;
  fetchImpl?: typeof fetch;
}): Promise<{ inquiryId: string; analysis: InquiryAnalysis }> {
  const inquiry = await getAccessibleInquiryOrThrow({
    tenantContext: params.tenantContext,
    inquiryId: params.inquiryId,
  });

  const gateway = createModelGateway({ fetchImpl: params.fetchImpl });
  const result = await gateway.invoke({
    tenantContext: params.tenantContext,
    userId: params.userId,
    taskType: ModelTaskType.CLASSIFY,
    // 询盘正文为隐私数据：sensitivity=INTERNAL_ONLY 强制走本地 Qwen，绝不外发。
    sensitivity: KnowledgeSensitivity.INTERNAL_ONLY,
    temperature: 0,
    systemPrompt: SYSTEM_PROMPT,
    prompt: [
      `已知公司: ${inquiry.lead.companyName ?? ""}`,
      `已知国家: ${inquiry.lead.country ?? ""}`,
      `联系人: ${inquiry.lead.contact?.name ?? inquiry.fromName ?? ""}`,
      `来源邮箱: ${inquiry.fromEmail ?? ""}`,
      `询盘主题: ${inquiry.subject ?? ""}`,
      `询盘正文: ${inquiry.body}`,
    ].join("\n"),
    requestSummary: `inquiry detection ${inquiry.id}`,
    queueOnLocalFailure: undefined,
  });

  let analysis: InquiryAnalysis;
  try {
    analysis = inquiryAnalysisSchema.parse(extractJsonObject(result.text));
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      502,
      "MODEL_OUTPUT",
      "Inquiry detection output failed schema validation.",
    );
  }

  // 兜底补全已知结构化信息（模型漏填时用 DB 已有值）。
  if (!analysis.company_name && inquiry.lead.companyName) {
    analysis.company_name = inquiry.lead.companyName;
  }
  if (!analysis.country && inquiry.lead.country) {
    analysis.country = inquiry.lead.country;
  }

  const prisma = getTenantPrisma(params.tenantContext);
  const existingRaw =
    inquiry.rawPayload && typeof inquiry.rawPayload === "object"
      ? (inquiry.rawPayload as Record<string, unknown>)
      : {};

  await prisma.inquiry.updateMany({
    where: { id: inquiry.id },
    data: {
      rawPayload: {
        ...existingRaw,
        analysis: {
          ...analysis,
          _meta: {
            route: result.route,
            invocationId: result.invocationId,
            analyzedAt: new Date().toISOString(),
          },
        },
      } as Prisma.InputJsonValue,
    },
  });

  await createAuditLog({
    tenantContext: params.tenantContext,
    actorUserId: params.userId,
    action: "inquiry_analyzed",
    entityType: "inquiry",
    entityId: inquiry.id,
    metadata: {
      intentType: analysis.intent_type,
      urgency: analysis.urgency,
      qualitySignal: analysis.quality_signal,
      riskFlags: analysis.risk_flags,
      route: result.route,
    },
  });

  return { inquiryId: inquiry.id, analysis };
}
