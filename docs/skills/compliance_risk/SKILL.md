# Skill: compliance_risk（合规与认证风险）+ Tool: certification_rule / hs_code

## 目标
据产品与目标市场，输出参考性合规清单：所需认证、标签要求、HS Code 候选、出口制裁筛查提示。全本地规则。

## 实现落点
- `apps/web/server/compliance/rules.ts`（静态规则库 + 版本戳）
- `apps/web/server/compliance/service.ts`（assessCompliance）
- 路由：`app/api/skills/compliance-risk`（POST）、`app/api/skills/hs-code`（GET ?q=）

## 硬约束（不可放宽）
- 所有输出恒带 `requires_expert_confirmation=true` 与 `disclaimer`：**参考性提示，须专业机构/认证实验室或法务确认，不作法律意见。**
- 国家风险只提示"需做制裁名单实时筛查"，**不武断断言某国合法/非法**。
- 规则库带 `rule_version`，明示可能过期。

## 输入 / 输出
见 `input_schema.json` / `output_schema.json`。

## 风险控制
- 认证/HS Code 均为关键词命中的候选，非穷举、非结论。
- 事件写现有 AuditLog（经 basic_log）。
