# Skill: quotation_assistant（AI 报价助手）

## 目标
据询盘与企业报价规则，生成结构化报价**草稿**，供业务员确认后使用。全本地，不外发。

## 实现落点
- `apps/web/server/quotation/service.ts`（buildQuotationDraft）+ `app/api/skills/quotation`。
- 规则来自 `server/quotation/rules.ts`，存现有 `TenantSetting(key=quotation_rules)`，不新增表。

## 硬约束（不可放宽）
- AI/系统**绝不发明成交价**。单价只能由人工提供的 `baseUnitCost` × 规则利润率算出。
- 未提供 `baseUnitCost` → 价格字段全为 null，`needs_base_cost=true`，正文用 `[待确认]` 占位。
- `requires_human_confirmation` 恒为 true；本服务只产草稿、**绝不发送**。
- 真正发送仍走现有 reply 的 HITL（REPLY_SEND），不新增 HITL 类型、不改 schema。

## 输入 / 输出
见 `input_schema.json` / `output_schema.json`。

## 风险控制
- 利润率低于规则 `minMarginPercent` → 进 warnings 提示需审批。
- 附 confirmation_checklist（单价/交期/MOQ/币种汇率/付款/运费关税）强制人工逐项核对。
