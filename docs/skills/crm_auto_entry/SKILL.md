# Skill: crm_auto_entry（CRM 自动入库）

## 目标
把询盘识别结果结构化写入 CRM（客户、公司、国家、产品兴趣、下一步动作），减少业务员手工录入。

## 实现落点
- 复用 `apps/web/server/crm/service.ts`（leads / opportunities / activities）。
- 数据写入走 `server/db/tenant-prisma.ts`，强制 `tenantId` 隔离。

## 输入
- `inquiry`：inquiry_detection 输出
- `scoring`：customer_scoring 输出（可选，用于初始机会优先级）
- `source`：来源渠道（form/email/whatsapp）

## 输出
见 `output_schema.json`：lead_id、company、contact、country、product_interest、stage、next_action、created。

## 工作流程
1. 去重匹配已有客户/公司（按邮箱/公司名）。
2. 新建或更新 lead，挂上产品兴趣与评分。
3. 生成初始 activity 与 next_action。
4. 返回写入结果与 lead_id。

## 现状对齐（重要）
- `Lead.status` 真实枚举为 `LeadStatus = new | contacted | following | won | lost`（@map 小写）。
  **不存在 `needs_review` 状态**——「待人工复核」用 `status=new` + 一条 `CrmActivity(type=note)` +
  `Notification(type=lead_new)` 表达，不要造新枚举。
- 客户主体落 `Contact`（companyName/name/email/phone/whatsapp/country），线索落 `Lead`，
  跟进动作落 `CrmActivity`，机会才落 `Opportunity(stage=OpportunityStage)`。
- 去重用现有 `Lead.dedupeHash` / `Contact.email`，不要新写一套去重。

## 禁止事项
- 不允许跨租户写入。
- 不允许在客户未确认前把 Lead 推进到 `won`，或自动建 `Opportunity(stage=quoted/won)`。

## 风险控制
- 写入失败返回可解释错误，不静默丢弃询盘。
- 评分为 C 或含 risk_signals 的，标注待人工复核。

## 示例
见 `examples.json`。
