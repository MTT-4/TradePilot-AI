# Skill: inquiry_detection（询盘识别）

## 目标
把客户自然语言询盘（表单/邮件/WhatsApp 文本）识别为结构化字段，供 first_response_draft、
customer_scoring、crm_auto_entry 复用。

## 实现落点
- 新增 `apps/web/server/leads/inquiry-detection.ts`：产出本契约的结构化结果。
- 复用 `apps/web/server/leads/scoring.ts` 已有的关键词、国家信号，不重写。
- 模型调用走 `server/model-gateway/`，**询盘正文属隐私数据，只走本地 Qwen**。

## 输入
- `text`：询盘原文（必填）
- `locale_hint`：来源语言提示（可选）
- `source`：`form | email | whatsapp | manual`（可选）

## 输出
见 `output_schema.json`。核心字段：language、country、company_name、contact_name、product_interest、
specifications、quantity、intent_type、asks_for_*、urgency、quality_signal、risk_flags、summary_zh。

## 工作流程
1. 语言/国家检测，归一化国家码。
2. 抽取公司、联系人、产品、规格、数量。
3. 判定意图类型与各 asks_for_* 布尔位。
4. 评估紧急度、质量信号、风险标记（垃圾/诈骗）。
5. 生成中文摘要 summary_zh，供业务员速读。

## 落库映射（对齐真实 schema，G1 不改库）
- 结构化结果整体写入 `Inquiry.rawPayload` 的 `analysis` 键（Json），不新增列、不迁移。
  例：`rawPayload = { ...原始, analysis: <本契约 output> }`。
- `Inquiry.sourceType` 枚举当前只有 `FORM | EMAIL`；WhatsApp/manual 来源 G1 暂记在
  `rawPayload.source`，等 P3 接入渠道时再扩 `InquirySourceType` 枚举。
- 模型任务类型用 `ModelTaskType.CLASSIFY`，经 model-gateway 强制走本地 Qwen（询盘正文为隐私数据）。

## 禁止事项
- 不允许编造客户未提供的公司/数量/规格。
- 不允许把询盘正文发往 OpenAI/Google。
- 缺失字段返回空值，不臆测。

## 风险控制
- 低置信字段在 risk_flags 标注。
- risk_flags 命中诈骗/垃圾信号时，下游不得自动回复，须经 HITL。

## 示例
见 `examples.json`。
