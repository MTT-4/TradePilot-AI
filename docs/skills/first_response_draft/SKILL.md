# Skill: first_response_draft（首封回复草稿）

## 目标
根据 inquiry_detection 与 knowledge_reference 的结果，生成外贸首封回复草稿（中文分析 + 目标语言客户回复），
只生成可编辑草稿，**不自动发送**。

## 现状对齐（重要）
- `requestReplyDraft` 已完整实现：KB 混合检索 → model-gateway invoke → 建 `Reply(DRAFT)` →
  建 `HitlTask(REPLY_SEND, PENDING)` → 置 `PENDING_APPROVAL` → 写审计日志。**这是扩展不是重写。**
- `Reply` 表只有 `draftText`(纯文本) + `citations`(Json)。系统提示当前要求 "plain text only"。
- G1 落库映射（不改库）：
  - `reply_body`（客户可见回复）→ 仍存 `Reply.draftText`，保持纯文本、地道、不机翻。
  - `internal_analysis_zh / questions_to_confirm / uncertain_points / next_action / knowledge_sources`
    → 统一存进 `Reply.citations` Json 的 `meta` 键，例：`citations = { sources:[...], meta:{...} }`。
  - 前端"人工编辑区"读 `draftText`，"内部分析/待确认"区读 `citations.meta`。

## 实现落点
- 复用 `apps/web/server/replies/service.ts` 的 `requestReplyDraft`（已串 KB 检索 + model-gateway）。
- 让模型在一次调用里返回纯文本回复 + 一段结构化分析；服务层拆分后分别写 `draftText` 与 `citations.meta`。
- 隐私内容只走本地 Qwen；草稿落库后进入现有 HITL 审批再发送（已实现，不改）。

## 输入
- `inquiry`：inquiry_detection 输出
- `knowledge`：knowledge_reference 输出
- `target_locale`：客户回复语言（默认取 inquiry.language）

## 输出
见 `output_schema.json`：internal_analysis_zh、reply_subject、reply_body、questions_to_confirm、
uncertain_points、knowledge_sources、next_action。

## 工作流程
1. 用中文写内部分析（客户画像、需求、机会、风险）。
2. 用目标语言写专业、地道的客户回复草稿，引用 knowledge 中的真实信息。
3. 列出需人工确认的问题与不确定点。
4. 标注引用来源与下一步建议。

## 禁止事项
- 不允许编造不存在的认证。
- 不允许承诺未确认的价格 / 交期。
- 不允许自动发送邮件。
- 不允许机翻腔、不允许过度营销夸张。

## 风险控制
- knowledge.confidence=low 的内容必须进 uncertain_points。
- 所有发送动作必须经 HITL（`server/replies` 的 approve 流程）。

## 示例
见 `examples.json`。
