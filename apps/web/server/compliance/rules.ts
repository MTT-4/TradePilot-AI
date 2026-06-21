/**
 * Tool: certification_rule / hs_code（认证与 HS Code 规则库）
 * 纯本地、纯新增的静态规则库。仅作参考，带版本戳，绝不作为法律/合规结论。
 */

export const COMPLIANCE_RULE_VERSION = "2026-06 baseline";

export const COMPLIANCE_DISCLAIMER =
  "以上为参考性提示，规则库可能过期，最终合规结论须由专业机构/认证实验室或法务确认。本系统不提供法律意见。";

export type CertificationRule = {
  code: string;
  name: string;
  markets: string[]; // 适用市场（大写国家/地区码或 EU/UK/US 等）
  keywords: string[]; // 命中产品关键词
  note: string;
};

// 基线认证规则（示例性、非穷举）。
export const CERTIFICATION_RULES: CertificationRule[] = [
  {
    code: "CE",
    name: "CE Marking",
    markets: ["EU", "EEA"],
    keywords: ["electronic", "electrical", "machine", "machinery", "led", "light", "lamp", "battery", "charger", "toy", "ppe", "device"],
    note: "进入欧盟市场的多类产品强制；具体指令（LVD/EMC/RED/MD 等）按产品判定。",
  },
  {
    code: "UKCA",
    name: "UKCA Marking",
    markets: ["UK", "GB"],
    keywords: ["electronic", "electrical", "machine", "machinery", "led", "toy", "ppe"],
    note: "英国市场对应 CE 的合格标志。",
  },
  {
    code: "RoHS",
    name: "RoHS (2011/65/EU)",
    markets: ["EU", "EEA", "UK"],
    keywords: ["electronic", "electrical", "led", "battery", "pcb", "charger", "cable"],
    note: "限制电子电气产品中的有害物质。",
  },
  {
    code: "REACH",
    name: "REACH (EC 1907/2006)",
    markets: ["EU", "EEA"],
    keywords: ["chemical", "material", "textile", "plastic", "coating", "paint", "rubber"],
    note: "化学品/材料注册、评估、授权与限制。",
  },
  {
    code: "FCC",
    name: "FCC Part 15",
    markets: ["US"],
    keywords: ["electronic", "wireless", "bluetooth", "wifi", "radio", "rf", "transmitter"],
    note: "美国电磁兼容/无线电设备认证。",
  },
  {
    code: "FDA",
    name: "US FDA",
    markets: ["US"],
    keywords: ["food", "cosmetic", "medical", "supplement", "mask", "drug", "dental", "contact"],
    note: "食品/化妆品/医疗器械/药品类受 FDA 监管。",
  },
  {
    code: "UL",
    name: "UL Safety",
    markets: ["US", "CA"],
    keywords: ["electrical", "appliance", "power", "adapter", "charger", "luminaire"],
    note: "北美电气安全认证（市场广泛要求，非强制法规）。",
  },
];

export function lookupCertifications(
  productText: string,
  markets?: string[],
): CertificationRule[] {
  const text = productText.toLowerCase();
  const targetMarkets = (markets ?? []).map((m) => m.toUpperCase());
  return CERTIFICATION_RULES.filter((rule) => {
    const keywordHit = rule.keywords.some((k) => text.includes(k));
    if (!keywordHit) return false;
    if (targetMarkets.length === 0) return true;
    return rule.markets.some((m) => targetMarkets.includes(m));
  });
}

// HS Code 候选（关键词 → 章节级候选；仅参考）。
export type HsCodeCandidate = { code: string; description: string };

const HS_CODE_MAP: { keywords: string[]; candidate: HsCodeCandidate }[] = [
  { keywords: ["led", "lamp", "light", "luminaire"], candidate: { code: "9405", description: "Luminaires and lighting fittings" } },
  { keywords: ["battery", "cell"], candidate: { code: "8507", description: "Electric accumulators (batteries)" } },
  { keywords: ["charger", "adapter", "power supply"], candidate: { code: "8504", description: "Electrical transformers, static converters" } },
  { keywords: ["cable", "wire"], candidate: { code: "8544", description: "Insulated wire and cable" } },
  { keywords: ["machine", "machinery"], candidate: { code: "8479", description: "Machines with individual functions, n.e.s." } },
  { keywords: ["textile", "fabric", "garment"], candidate: { code: "63", description: "Made-up textile articles (chapter)" } },
  { keywords: ["furniture"], candidate: { code: "9403", description: "Other furniture and parts" } },
  { keywords: ["plastic"], candidate: { code: "3926", description: "Other articles of plastics" } },
];

export function suggestHsCode(productText: string): HsCodeCandidate[] {
  const text = productText.toLowerCase();
  const hits = HS_CODE_MAP.filter((entry) =>
    entry.keywords.some((k) => text.includes(k)),
  ).map((entry) => entry.candidate);
  return hits;
}

// 高风险/受限国家：仅提示需做制裁名单实时筛查，不作权威结论。
const SCREENING_FLAG_COUNTRIES = new Set([
  "ir", "iran",
  "kp", "north korea", "dprk",
  "sy", "syria",
  "cu", "cuba",
  "ru", "russia",
]);

export function screenCountry(country?: string | null): {
  needs_screening: boolean;
  note: string;
} {
  const c = (country ?? "").trim().toLowerCase();
  const flagged = c !== "" && SCREENING_FLAG_COUNTRIES.has(c);
  return {
    needs_screening: true,
    note: flagged
      ? "目标国可能涉及出口管制/制裁，必须经实时制裁名单筛查与法务确认后再交易。"
      : "任何出口交易都建议做一次制裁名单（如 OFAC/EU/UN）筛查；本提示非权威结论。",
  };
}
