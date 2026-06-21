# Tool: export（数据导出）

## 目标
导出租户内的 leads、inquiries、activities 为结构化 JSON 行，供本地下载或后续人工处理。

## 实现落点
- `apps/web/server/exports/service.ts`
- `GET /api/skills/export?type=leads|inquiries|activities&limit=`

## 输入 / 输出
- 输入：`type` 必填，`limit` 可选。
- 输出：`type`、`count`、`rows`。

## 风险控制
- 仅 `ADMIN` 及以上角色可调用。
- 读取与审计都走租户上下文；导出后强制写一条 `data_exported` 审计日志。
- `limit` 必须是正整数；结果上限 5000。
