# Skill: knowledge_reference（产品知识库引用）

## 目标
从企业上传的产品资料中引用**真实信息**，避免 AI 瞎编参数/认证/价格/交期。

## 现状对齐（重要）
- `hybridSearchKnowledgeChunks({ tenantContext, query, allowInternalOnly, limit })` 已实现，
  返回 `items[]`，每项含 `text / sourceCitation / sensitivity`。这是**已有能力，直接调用**。
- 本契约的 `matched_knowledge` 是对 `items` 的字段重整；`missing_information` / `notes_for_sales`
  是 G1 **新增的后处理**（对比询盘所需字段，当前 search 不产出），在 knowledge_reference 包装层计算。
- 跨租户由 `tenant-prisma` + `allowInternalOnly` 控制，隐私边界已在 gateway/搜索层强制。

## 输入
- `query`：检索语义（通常来自 inquiry_detection 的 product_interest + specifications）
- `tenant_context`：租户上下文（由调用方注入）
- `top_k`：返回条数（可选，默认平台设定）

## 输出
见 `output_schema.json`：matched_knowledge[]（含 source_file/source_type/confidence）、
missing_information[]、source_files[]、confidence、notes_for_sales。

## 工作流程
1. 用 query 在租户知识库做混合检索。
2. 对每条命中给出来源文件与置信度。
3. 比对询盘所需字段（MOQ/包装/认证/交期/FAQ），列出 missing_information。
4. 生成给业务员的提示 notes_for_sales。

## 禁止事项
- 不允许返回知识库中不存在的内容。
- 缺失信息必须如实进入 missing_information，不得编造填补。

## 风险控制
- 低置信命中标 confidence=low，下游回复须标注不确定。
- 跨租户检索被 tenant-prisma 阻断。

## 示例
见 `examples.json`。
