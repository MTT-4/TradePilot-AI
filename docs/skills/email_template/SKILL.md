# Tool: email_template（邮件模板）

## 目标
维护开发信/跟进信/报价信模板，供业务员套用编辑。全本地。

## 实现落点
- `apps/web/server/templates/service.ts` + `GET/PUT /api/skills/email-templates`
- 模板存现有 `TenantSetting(key=email_templates)`，**不新增表**。读 SALES、改 ADMIN（写审计）。

## 输入 / 输出
- GET：返回 templates 数组（缺省给内置默认：dev_letter / follow_up / quotation）。
- PUT：替换 templates（每项 id/name/subject/body）。

## 风险控制
- 模板仅供套用，**不自动发送**；占位变量（{{contact}}/{{product}} 等）由业务员替换。
- 改动写 AuditLog。
