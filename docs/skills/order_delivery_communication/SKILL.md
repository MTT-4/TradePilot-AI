# Skill: order_delivery_communication（订单与交期沟通）

## 目标
为订单全生命周期生成沟通草稿：PI、付款提醒、生产进度、验货、发货、售后、补货。全本地，不发送。

## 实现落点
- `apps/web/server/orders/communication.ts`（buildOrderMessage）+ `app/api/skills/order-communication`。
- 公司/联系人从现有 Lead/Inquiry 解析（租户隔离）；事件写现有 AuditLog（经 basic_log）。

## 硬约束（不可放宽）
- **禁止系统/AI 承诺交期或金额**：所有日期、金额、单号均为 `{{token}}` 占位，人工未提供则渲染为 `[待确认]`；
  模板本身从不断言具体交期。
- `requires_human_confirmation` 恒为 true；只产草稿，**绝不发送**。真正发送走现有 reply 的 HITL。

## 输入 / 输出
见 `input_schema.json` / `output_schema.json`。stage 取值：
pi | payment_reminder | production_update | inspection | shipment | after_sales | restock。

## 风险控制
- 未填字段进 `unresolved_fields` 与 warnings，发送前必须人工补全。
- 附 confirmation_checklist（订单号/金额币种/交期由生产确认/单据）。
