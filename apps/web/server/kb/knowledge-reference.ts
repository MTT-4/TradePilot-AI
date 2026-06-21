import type { TenantContext } from "@/server/db/tenant-context";
import { hybridSearchKnowledgeChunks } from "@/server/kb/service";

/**
 * Skill: knowledge_reference（产品知识库引用）
 * 契约见 docs/skills/knowledge_reference/。
 * 纯新增包装：直接复用现有 hybridSearchKnowledgeChunks，附加"缺失信息提醒 + 来源高亮"后处理。
 * 不修改任何现有文件。
 */

export type MatchedKnowledge = {
  title: string;
  content: string;
  source_file: string;
  source_type: "pdf" | "docx" | "xlsx" | "image" | "manual" | "url" | "mock";
  confidence: "low" | "medium" | "high";
};

export type KnowledgeReferenceResult = {
  matched_knowledge: MatchedKnowledge[];
  missing_information: string[];
  source_files: string[];
  confidence: "low" | "medium" | "high";
  notes_for_sales: string;
};

// 询盘常见所需字段 → 命中关键词（中英）。用于缺失信息检测。
const FIELD_KEYWORDS: Record<string, string[]> = {
  price: ["price", "fob", "cif", "exw", "报价", "价格", "单价"],
  moq: ["moq", "minimum order", "起订", "最小起订"],
  lead_time: ["lead time", "delivery", "交期", "货期", "交货"],
  certification: ["ce", "rohs", "fcc", "fda", "iso", "认证", "证书"],
  packaging: ["packing", "package", "carton", "包装", "纸箱"],
  payment: ["payment", "t/t", "l/c", "付款", "账期"],
  warranty: ["warranty", "guarantee", "质保", "保修"],
};

function inferSourceType(sourceFile: string): MatchedKnowledge["source_type"] {
  const lower = sourceFile.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) return "docx";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv"))
    return "xlsx";
  if (/\.(png|jpe?g|gif|webp)$/.test(lower)) return "image";
  if (lower.startsWith("http://") || lower.startsWith("https://")) return "url";
  if (!sourceFile.trim()) return "manual";
  return "manual";
}

function scoreToConfidence(score: number): "low" | "medium" | "high" {
  if (score >= 0.6) return "high";
  if (score >= 0.3) return "medium";
  return "low";
}

function deriveTitle(sourceFile: string, text: string): string {
  if (sourceFile.trim()) return sourceFile.trim();
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  return firstLine.slice(0, 60) || "知识片段";
}

/**
 * 检索知识库并附加缺失信息提醒。requiredFields 为本次询盘需覆盖的字段键（见 FIELD_KEYWORDS）。
 */
export async function referenceKnowledge(params: {
  tenantContext: TenantContext;
  userId?: string;
  query: string;
  requiredFields?: string[];
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<KnowledgeReferenceResult> {
  const search = await hybridSearchKnowledgeChunks({
    tenantContext: params.tenantContext,
    userId: params.userId,
    query: params.query,
    limit: params.limit ?? 5,
    allowInternalOnly: true,
    fetchImpl: params.fetchImpl,
  });

  const matched_knowledge: MatchedKnowledge[] = search.items.map((item) => {
    const sourceFile = item.sourceCitation ?? "";
    return {
      title: deriveTitle(sourceFile, item.text),
      content: item.text,
      source_file: sourceFile,
      source_type: inferSourceType(sourceFile),
      confidence: scoreToConfidence(item.score),
    };
  });

  const source_files = Array.from(
    new Set(matched_knowledge.map((m) => m.source_file).filter(Boolean)),
  );

  // 缺失信息：required 字段在命中内容里找不到关键词 → 提醒人工补充。
  const haystack = matched_knowledge
    .map((m) => m.content)
    .join("\n")
    .toLowerCase();
  const missing_information: string[] = [];
  for (const field of params.requiredFields ?? []) {
    const keywords = FIELD_KEYWORDS[field];
    if (!keywords) continue;
    const found = keywords.some((kw) => haystack.includes(kw.toLowerCase()));
    if (!found) {
      missing_information.push(`知识库未覆盖「${field}」，回复前需人工确认或标注待定。`);
    }
  }

  const topScore = search.items[0]?.score ?? 0;
  const confidence = matched_knowledge.length === 0 ? "low" : scoreToConfidence(topScore);

  const notes_for_sales =
    matched_knowledge.length === 0
      ? "知识库无相关命中，本次回复内容均需人工提供，避免编造。"
      : missing_information.length > 0
        ? `已命中 ${matched_knowledge.length} 条参考；但 ${missing_information.length} 项关键信息缺失，需人工补充后再回复。`
        : `已命中 ${matched_knowledge.length} 条参考，关键信息基本齐全，可据此起草回复。`;

  return {
    matched_knowledge,
    missing_information,
    source_files,
    confidence,
    notes_for_sales,
  };
}
