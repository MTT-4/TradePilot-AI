# TradePilot AI · Skills 契约目录

本目录是 **Skill 契约文档**，描述每个 AI 业务能力的输入/输出/禁止项/风险控制。
契约对应的实现已存在于 `apps/web/server/<domain>/`，本目录不重复实现逻辑，只锁定接口语义。

## 当前阶段：G1（闭环补全）

| Skill | 契约目录 | 实现落点 | 状态 |
|---|---|---|---|
| inquiry_detection | `inquiry_detection/` | `server/leads/inquiry-detection.ts`（新增）+ `server/leads/scoring.ts`（复用） | 🟡 补结构化输出 |
| knowledge_reference | `knowledge_reference/` | `server/kb/service.ts` `hybridSearchKnowledgeChunks` | ✅ 补缺失提醒/来源高亮 |
| first_response_draft | `first_response_draft/` | `server/replies/service.ts` `requestReplyDraft` | ✅ 补需确认/不确定/下一步 |
| customer_scoring | `customer_scoring/` | `server/leads/scoring.ts` `evaluateLeadScore` | 🟡 补评分原因 |
| crm_auto_entry | `crm_auto_entry/` | `server/crm/service.ts` | ✅ 复用 |

## 已按真实 schema 校正（审核结论）

契约已对齐仓库真实数据模型，落地不需要改库：

- inquiry_detection 结构化结果存 `Inquiry.rawPayload.analysis`（Json）；`InquirySourceType` 仅 `form|email`。
- customer_scoring 用现有规则打分，落 `Lead.score` + `Lead.scoreReason`（单字符串）。
- crm_auto_entry 用真实 `LeadStatus(new/contacted/following/won/lost)`；「待复核」用 note activity 表达，无新枚举。
- first_response_draft 客户回复存 `Reply.draftText`（纯文本），分析/待确认字段存 `Reply.citations.meta`。
- knowledge_reference 直调 `hybridSearchKnowledgeChunks`；`missing_information` 为包装层后处理。

## 统一约束（来自 AGENTS.md 铁律）

- 数据访问走 `server/db/tenant-prisma.ts`，带 `tenantId`。
- 模型调用走 `server/model-gateway/`；隐私数据（姓名/电话/询盘正文）只走本地 Qwen。
- 价格/交期/认证结论与任何自动发送必须经 HITL 人工确认。
- AI 输出统一标注：引用来源、不确定点、下一步建议。

## 每个 Skill 的文件结构

```text
<skill_name>/
  SKILL.md            # 目标/输入/输出/工作流程/禁止事项/风险控制
  input_schema.json   # JSON Schema 输入契约
  output_schema.json  # JSON Schema 输出契约
  examples.json       # 输入->输出示例
```
