# Tool: usage_report（AI 用量报告）

## 目标
统计租户内模型调用量、token 用量和成本，供管理员查看本地模型/网关使用情况。

## 实现落点
- `apps/web/server/usage/report.ts`
- `GET /api/skills/usage-report`

## 输入 / 输出
- 输入：无业务参数。
- 输出：总调用数、输入/输出 token、总成本，以及按 route / task 的聚合统计。

## 风险控制
- 仅 `ADMIN` 及以上角色可调用。
- 统计来源仅限本租户 `ModelInvocation`，查询走 `tenant-prisma`。
- 不接第三方计费系统，不改现有 billing/usage 模块。
