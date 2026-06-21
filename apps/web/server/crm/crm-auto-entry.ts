import { ApiError } from "@/server/api/errors";
import type { TenantContext } from "@/server/db/tenant-context";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import { createCrmActivity } from "@/server/crm/service";
import { assertLeadOwnerScope } from "@/server/skills/access";
import {
  inquiryAnalysisSchema,
  type InquiryAnalysis,
} from "@/server/leads/inquiry-detection";

/**
 * Skill: crm_auto_entry（CRM 自动入库）
 * 契约见 docs/skills/crm_auto_entry/。
 * 纯新增编排：读取询盘已存的 inquiry_detection 结果，补全 Lead 缺失字段并写一条 CRM note。
 * 复用现有 createCrmActivity，不修改任何现有文件。不自动推进成交阶段。
 */

export type CrmAutoEntryResult = {
  lead_id: string;
  company: string;
  contact: string;
  country: string;
  product_interest: string;
  lead_status: "new" | "contacted" | "following" | "won" | "lost";
  needs_review: boolean;
  next_action: string;
  created: boolean;
};

function deriveNextAction(analysis: InquiryAnalysis, needsReview: boolean): string {
  if (needsReview) {
    return "疑似低质或风险询盘，人工复核后再决定是否跟进。";
  }
  if (analysis.asks_for_price) {
    return "确认价格与交期后，准备首封报价回复（须人工确认）。";
  }
  if (analysis.asks_for_sample) {
    return "确认样品政策与寄送方式，回复样品安排。";
  }
  if (analysis.asks_for_certification) {
    return "核对认证资料，回复客户认证问题。";
  }
  return "整理产品资料，准备首封回复。";
}

export async function crmAutoEntryFromInquiry(params: {
  tenantContext: TenantContext;
  userId?: string;
  inquiryId: string;
}): Promise<CrmAutoEntryResult> {
  const prisma = getTenantPrisma(params.tenantContext);
  const inquiry = await prisma.inquiry.findFirst({
    where: {
      id: params.inquiryId,
    },
    select: {
      id: true,
      rawPayload: true,
      lead: {
        select: {
          id: true,
          ownerUserId: true,
          status: true,
          companyName: true,
          country: true,
          contact: { select: { name: true } },
        },
      },
    },
  });

  if (!inquiry) {
    throw new ApiError(404, "NOT_FOUND", "Inquiry not found.");
  }
  assertLeadOwnerScope(params.tenantContext, inquiry.lead.ownerUserId);

  const raw =
    inquiry.rawPayload && typeof inquiry.rawPayload === "object"
      ? (inquiry.rawPayload as Record<string, unknown>)
      : {};
  const storedAnalysis = raw.analysis;
  if (!storedAnalysis || typeof storedAnalysis !== "object") {
    throw new ApiError(
      409,
      "ANALYSIS_MISSING",
      "Run inquiry_detection before crm_auto_entry.",
    );
  }

  const analysis = inquiryAnalysisSchema.parse(storedAnalysis);
  const lead = inquiry.lead;
  const needsReview =
    analysis.quality_signal === "low" || analysis.risk_flags.length > 0;
  const nextAction = deriveNextAction(analysis, needsReview);

  // 补全 Lead 缺失的公司/国家（仅在原值为空时回填，不覆盖人工数据）。
  const leadUpdate: { companyName?: string; country?: string } = {};
  if (!lead.companyName && analysis.company_name) {
    leadUpdate.companyName = analysis.company_name;
  }
  if (!lead.country && analysis.country) {
    leadUpdate.country = analysis.country;
  }
  if (Object.keys(leadUpdate).length > 0) {
    await prisma.lead.updateMany({
      where: { id: lead.id },
      data: leadUpdate,
    });
  }

  // 写一条 CRM note（复用现有服务，含 SALES 归属校验）。
  const noteLines = [
    `[AI 询盘归档] 意图：${analysis.intent_type}，紧急度：${analysis.urgency}，质量：${analysis.quality_signal}`,
    analysis.product_interest ? `产品兴趣：${analysis.product_interest}` : "",
    analysis.quantity ? `数量：${analysis.quantity}` : "",
    analysis.risk_flags.length > 0 ? `风险标记：${analysis.risk_flags.join(", ")}` : "",
    `下一步：${nextAction}`,
    needsReview ? "⚠️ 待人工复核" : "",
  ].filter(Boolean);

  await createCrmActivity({
    tenantContext: params.tenantContext,
    input: {
      leadId: lead.id,
      type: "note",
      body: noteLines.join("\n"),
    },
  });

  return {
    lead_id: lead.id,
    company: leadUpdate.companyName ?? lead.companyName ?? "",
    contact: lead.contact?.name ?? "",
    country: leadUpdate.country ?? lead.country ?? "",
    product_interest: analysis.product_interest,
    lead_status: lead.status.toLowerCase() as CrmAutoEntryResult["lead_status"],
    needs_review: needsReview,
    next_action: nextAction,
    created: false,
  };
}
