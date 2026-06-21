# Tool: quotation_rule（报价规则）

## 目标
维护租户级报价规则，包括利润率、MOQ、阶梯折扣、币种、账期与有效期。

## 实现落点
- `apps/web/server/quotation/rules.ts`
- `GET/PUT /api/skills/quotation-rules`

## 输入 / 输出
- GET：返回当前租户规则；无记录时回默认值。
- PUT：写入一整套规则配置。

## 风险控制
- 读取 SALES 可用，修改仅 `ADMIN` 及以上。
- 规则存现有 `TenantSetting(key=quotation_rules)`，不新增表。
- 规则不存具体成交价；最终报价仍需人工确认。
