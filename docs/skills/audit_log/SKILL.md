# Tool: audit_log（审计日志查询）

## 目标
供租户管理员查看本租户内的技能/工具审计记录，只读。

## 实现落点
- `apps/web/server/audit/query.ts`
- `GET /api/skills/audit-log?action=&entityType=&limit=`

## 输入 / 输出
- 输入：可选 `action`、`entityType`、`limit`。
- 输出：按时间倒序返回审计项列表，包含 `action`、`entityType`、`entityId`、`actorUserId`、`metadata`、`createdAt`。

## 风险控制
- 仅 `ADMIN` 及以上角色可调用。
- 路由强制要求 `X-Tenant-Id`，查询走 `tenant-prisma`，不跨租户。
- `limit` 必须是正整数；结果上限 200。
