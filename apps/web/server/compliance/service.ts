import type { TenantContext } from "@/server/db/tenant-context";
import { logSkillEvent } from "@/server/observability/basic-log";
import {
  COMPLIANCE_DISCLAIMER,
  COMPLIANCE_RULE_VERSION,
  lookupCertifications,
  screenCountry,
  suggestHsCode,
  type HsCodeCandidate,
} from "@/server/compliance/rules";

/**
 * Skill: compliance_risk（合规与认证风险）
 * 契约见 docs/skills/compliance_risk/。纯本地规则、纯新增。
 * 输出恒带"需专业机构确认"免责；不作法律意见。
 */

export type ComplianceAssessment = {
  product: string;
  markets: string[];
  required_certifications: { code: string; name: string; markets: string[]; note: string }[];
  hs_code_candidates: HsCodeCandidate[];
  country_risk: { country: string; needs_screening: boolean; note: string };
  labeling_notes: string[];
  requires_expert_confirmation: true;
  rule_version: string;
  disclaimer: string;
};

const LABELING_BY_MARKET: Record<string, string> = {
  EU: "欧盟：CE 标志、制造商/进口商信息、型号、警告语，必要时多语言说明书。",
  UK: "英国：UKCA 标志与负责人信息。",
  US: "美国：UL/ETL 标记（如适用）、英文标签、能效/加州 Prop 65 警示（如适用）。",
};

export async function assessCompliance(params: {
  tenantContext: TenantContext;
  userId?: string;
  input: { product: string; markets?: string[]; country?: string };
}): Promise<ComplianceAssessment> {
  const product = params.input.product.trim();
  const markets = (params.input.markets ?? []).map((m) => m.toUpperCase());

  const certs = lookupCertifications(product, markets).map((rule) => ({
    code: rule.code,
    name: rule.name,
    markets: rule.markets,
    note: rule.note,
  }));

  const labeling_notes = (markets.length > 0 ? markets : Object.keys(LABELING_BY_MARKET))
    .map((m) => LABELING_BY_MARKET[m])
    .filter((v): v is string => Boolean(v));

  const country_risk = {
    country: params.input.country ?? "",
    ...screenCountry(params.input.country),
  };

  await logSkillEvent({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.userId,
    action: "compliance_assessed",
    entityType: "compliance",
    entityId: product.slice(0, 64) || "unknown",
    metadata: { markets, certCount: certs.length },
  });

  return {
    product,
    markets,
    required_certifications: certs,
    hs_code_candidates: suggestHsCode(product),
    country_risk,
    labeling_notes,
    requires_expert_confirmation: true,
    rule_version: COMPLIANCE_RULE_VERSION,
    disclaimer: COMPLIANCE_DISCLAIMER,
  };
}
