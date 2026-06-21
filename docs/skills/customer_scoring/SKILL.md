# Skill: customer_scoring（客户质量评分）

## 目标
对询盘客户给出质量评分（A/B/C），并**输出评分原因**，不只给分数。

## 现状对齐（重要）
- `evaluateLeadScore` 已是**规则打分**（不是 AI），返回 `{ score: A/B/C, scoreReason: string }`。
- 落库为 `Lead.score`（枚举 A/B/C）+ `Lead.scoreReason`（**单个字符串**，非数组）。
- G1 最小扩展：保留规则与字符串 reason；`score_reasons` 数组仅作**内存中间结构**，落库时 join 成
  `Lead.scoreReason` 字符串。**不改库**。若未来要按因子查询再考虑加 Json 列。

## 实现落点
- 复用并增强 `apps/web/server/leads/scoring.ts` 的 `evaluateLeadScore`。
- 把现有 `reasons[]` 升级为带 factor/impact 的结构，最后仍 join 进 `scoreReason` 字符串存库。

## 输入
- `inquiry`：inquiry_detection 输出（或等价信号字段）
- 可选信号：company_email、website、country、quantity、request_clarity

## 输出
见 `output_schema.json`：score（A/B/C）、score_value（数值）、score_reasons[]、risk_signals[]。

## 工作流程
1. 计算各因子分（国家优先级、采购量、需求清晰度、企业邮箱/官网、诈骗信号）。
2. 汇总为 A/B/C 与数值分。
3. 为每个因子生成可读原因，写入 score_reasons。

## 禁止事项
- 不允许只给分数不给原因。
- 不允许把个人隐私字段发往第三方模型。

## 风险控制
- 命中诈骗/垃圾信号时进 risk_signals，下游不得自动回复。

## 示例
见 `examples.json`。
