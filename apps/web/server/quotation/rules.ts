import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import type { TenantContext } from "@/server/db/tenant-context";

/**
 * Tool: quotation_rule（报价规则）
 * 契约见 docs/skills/（G2）。纯本地、纯新增：报价规则存现有 TenantSetting，不新增表、不改 schema。
 * 规则只描述"利润率/价格区间/MOQ/阶梯/币种/账期/有效期"，不含任何具体成交价。
 */

export const QUOTATION_RULE_KEY = "quotation_rules";

export const priceTierSchema = z.object({
  minQty: z.number().int().min(1),
  discountPercent: z.number().min(0).max(90),
});

export const quotationRuleSchema = z.object({
  currency: z.string().trim().min(1).max(8).default("USD"),
  validityDays: z.number().int().min(1).max(365).default(15),
  defaultIncoterm: z.enum(["FOB", "CIF", "EXW"]).default("FOB"),
  // 利润率为空时：系统不建议任何单价，全部留待人工填写。
  marginPercent: z.number().min(0).max(500).nullable().default(null),
  minMarginPercent: z.number().min(0).max(500).nullable().default(null),
  moq: z.number().int().min(1).nullable().default(null),
  tiers: z.array(priceTierSchema).max(10).default([]),
  paymentTerms: z.string().trim().max(400).default("30% T/T deposit, 70% balance before shipment."),
  notes: z.string().trim().max(1000).default(""),
});

export type QuotationRule = z.infer<typeof quotationRuleSchema>;

export const DEFAULT_QUOTATION_RULE: QuotationRule = quotationRuleSchema.parse({});

export async function getQuotationRule(
  tenantContext: TenantContext,
): Promise<QuotationRule> {
  const tenantPrisma = getTenantPrisma(tenantContext);
  const record = await tenantPrisma.tenantSetting.findFirst({
    where: { key: QUOTATION_RULE_KEY },
    select: { value: true },
  });
  if (!record) {
    return DEFAULT_QUOTATION_RULE;
  }
  const parsed = quotationRuleSchema.safeParse(record.value);
  return parsed.success ? parsed.data : DEFAULT_QUOTATION_RULE;
}

export async function updateQuotationRule(params: {
  tenantContext: TenantContext;
  actorUserId?: string;
  input: unknown;
}): Promise<QuotationRule> {
  const payload = quotationRuleSchema.parse(params.input);
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const existing = await tenantPrisma.tenantSetting.findFirst({
    where: { key: QUOTATION_RULE_KEY },
    select: { id: true, value: true },
  });

  const record = existing
    ? await tenantPrisma.tenantSetting.update({
        where: { id: existing.id },
        data: {
          value: payload as Prisma.InputJsonValue,
          updatedByUserId: params.actorUserId,
        },
        select: { id: true },
      })
    : await tenantPrisma.tenantSetting.create({
        data: {
          tenantId: params.tenantContext.tenantId,
          key: QUOTATION_RULE_KEY,
          value: payload as Prisma.InputJsonValue,
          updatedByUserId: params.actorUserId,
        },
        select: { id: true },
      });

  await tenantPrisma.auditLog.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      actorUserId: params.actorUserId,
      action: "quotation_rules_updated",
      entityType: "tenant_setting",
      entityId: record.id,
      metadata: { after: payload as Prisma.InputJsonValue },
    },
  });

  return payload;
}
