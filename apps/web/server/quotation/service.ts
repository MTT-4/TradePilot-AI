import { ApiError } from "@/server/api/errors";
import type { TenantContext } from "@/server/db/tenant-context";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import { getQuotationRule, type QuotationRule } from "@/server/quotation/rules";
import { assertLeadOwnerScope } from "@/server/skills/access";
import { inquiryAnalysisSchema } from "@/server/leads/inquiry-detection";

/**
 * Skill: quotation_assistant（AI 报价助手）
 * 契约见 docs/skills/（G2）。纯本地、纯新增。
 *
 * 硬约束（不可放宽）：
 * - AI / 系统绝不"发明"成交价。单价只能由人工提供的 baseUnitCost × 规则利润率算出。
 * - 未提供 baseUnitCost 时，所有价格字段留 null，标 needs_base_cost，正文用 [待确认] 占位。
 * - requires_human_confirmation 恒为 true；本服务只产出草稿，绝不发送。
 *   真正发送仍走现有 reply 的 HITL（REPLY_SEND），本服务不新增 HITL 类型、不改 schema。
 */

const PLACEHOLDER = "[待确认]";

export type QuotationTierLine = {
  minQty: number;
  discountPercent: number;
  unitPrice: number | null;
};

export type QuotationDraft = {
  product: string;
  quantity: string;
  currency: string;
  incoterm: "FOB" | "CIF" | "EXW";
  moq: number | null;
  unitPrice: number | null;
  tiers: QuotationTierLine[];
  validUntil: string;
  paymentTerms: string;
  needs_base_cost: boolean;
  requires_human_confirmation: true;
  confirmation_checklist: string[];
  warnings: string[];
  draft_text: string;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeUnitPrice(
  baseUnitCost: number | null | undefined,
  marginPercent: number | null,
): number | null {
  if (baseUnitCost == null || marginPercent == null) return null;
  return round2(baseUnitCost * (1 + marginPercent / 100));
}

async function resolveFromInquiry(params: {
  tenantContext: TenantContext;
  inquiryId: string;
}): Promise<{ product: string; quantity: string }> {
  const prisma = getTenantPrisma(params.tenantContext);
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: params.inquiryId },
    select: { rawPayload: true, lead: { select: { ownerUserId: true } } },
  });
  if (!inquiry) {
    throw new ApiError(404, "NOT_FOUND", "Inquiry not found.");
  }
  assertLeadOwnerScope(params.tenantContext, inquiry.lead.ownerUserId);
  const raw =
    inquiry.rawPayload && typeof inquiry.rawPayload === "object"
      ? (inquiry.rawPayload as Record<string, unknown>)
      : {};
  const analysisRaw = raw.analysis;
  if (!analysisRaw || typeof analysisRaw !== "object") {
    return { product: "", quantity: "" };
  }
  const analysis = inquiryAnalysisSchema.parse(analysisRaw);
  return { product: analysis.product_interest, quantity: analysis.quantity };
}

function buildDraftText(d: {
  product: string;
  quantity: string;
  currency: string;
  incoterm: string;
  moq: number | null;
  unitPrice: number | null;
  validUntil: string;
  paymentTerms: string;
}): string {
  const price = d.unitPrice == null ? PLACEHOLDER : `${d.currency} ${d.unitPrice}`;
  return [
    "Quotation (DRAFT — 需业务确认后方可发送)",
    `Product: ${d.product || PLACEHOLDER}`,
    `Quantity: ${d.quantity || PLACEHOLDER}`,
    `Incoterm: ${d.incoterm}`,
    `MOQ: ${d.moq ?? PLACEHOLDER}`,
    `Unit price: ${price}`,
    `Payment terms: ${d.paymentTerms}`,
    `Lead time: ${PLACEHOLDER}`,
    `Valid until: ${d.validUntil}`,
    "",
    "注：单价、交期等关键数字须人工核实后填写，系统不自动生成成交价。",
  ].join("\n");
}

export async function buildQuotationDraft(params: {
  tenantContext: TenantContext;
  userId?: string;
  input: {
    inquiryId?: string;
    product?: string;
    quantity?: string;
    baseUnitCost?: number;
    incoterm?: "FOB" | "CIF" | "EXW";
    currency?: string;
    marginPercent?: number;
  };
}): Promise<QuotationDraft> {
  const rule: QuotationRule = await getQuotationRule(params.tenantContext);

  let product = params.input.product?.trim() ?? "";
  let quantity = params.input.quantity?.trim() ?? "";
  if (params.input.inquiryId && (!product || !quantity)) {
    const fromInquiry = await resolveFromInquiry({
      tenantContext: params.tenantContext,
      inquiryId: params.input.inquiryId,
    });
    product = product || fromInquiry.product;
    quantity = quantity || fromInquiry.quantity;
  }

  const currency = params.input.currency?.trim() || rule.currency;
  const incoterm = params.input.incoterm ?? rule.defaultIncoterm;
  const effectiveMargin =
    params.input.marginPercent ?? rule.marginPercent;
  const baseUnitCost = params.input.baseUnitCost;

  const unitPrice = computeUnitPrice(baseUnitCost, effectiveMargin);
  const needs_base_cost = unitPrice == null;

  const tiers: QuotationTierLine[] = rule.tiers
    .slice()
    .sort((a, b) => a.minQty - b.minQty)
    .map((tier) => ({
      minQty: tier.minQty,
      discountPercent: tier.discountPercent,
      unitPrice:
        unitPrice == null
          ? null
          : round2(unitPrice * (1 - tier.discountPercent / 100)),
    }));

  const validUntilDate = new Date();
  validUntilDate.setDate(validUntilDate.getDate() + rule.validityDays);
  const validUntil = validUntilDate.toISOString().slice(0, 10);

  const warnings: string[] = [];
  if (
    effectiveMargin != null &&
    rule.minMarginPercent != null &&
    effectiveMargin < rule.minMarginPercent
  ) {
    warnings.push(
      `利润率 ${effectiveMargin}% 低于规则最低 ${rule.minMarginPercent}%，需审批。`,
    );
  }
  if (needs_base_cost) {
    warnings.push("未提供成本基准，单价留空待人工填写（系统不生成成交价）。");
  }

  const confirmation_checklist = [
    "核实单价（成本 + 利润率）",
    "核实交期 / 生产周期",
    "核实 MOQ 与起订条件",
    "核实币种与汇率时点",
    "核实付款条款",
    "核实是否含运费 / 关税（按 incoterm）",
  ];

  const draft_text = buildDraftText({
    product,
    quantity,
    currency,
    incoterm,
    moq: rule.moq,
    unitPrice,
    validUntil,
    paymentTerms: rule.paymentTerms,
  });

  return {
    product,
    quantity,
    currency,
    incoterm,
    moq: rule.moq,
    unitPrice,
    tiers,
    validUntil,
    paymentTerms: rule.paymentTerms,
    needs_base_cost,
    requires_human_confirmation: true,
    confirmation_checklist,
    warnings,
    draft_text,
  };
}
