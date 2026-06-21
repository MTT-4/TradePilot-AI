# Skill: follow_up_scheduler（跟进节奏建议）+ Tool: follow_up_task

## 目标
据线索/询盘生成第 1/3/7/14/30 天的可编辑跟进计划；可选落地为跟进任务。全本地，不自动发送。

## 实现落点
- `apps/web/server/follow-up/scheduler.ts`（generateFollowUpPlan）+ `app/api/skills/follow-up`。
- 任务落地复用现有 `CrmActivity(type=follow_up)`，最近到期日写入 `Lead.followUpDueAt`，**不新增表**。

## 输入 / 输出
见 `input_schema.json` / `output_schema.json`。

## 风险控制
- 默认 `persist=false`，只出计划草案；`persist=true` 才建 CrmActivity 任务。
- 全部为"计划/可编辑"状态，**不自动发送**，避免骚扰客户。
- 写任务复用 createCrmActivity，含 SALES 归属校验与租户隔离。
