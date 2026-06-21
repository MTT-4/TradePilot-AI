# G5: 管理分析 / 用量 / 审计 / 导出（全部只读 + 新增文件）

按"不改现有架构"原则，G5 全部以**新增文件 + 只读现有表**实现，不修改 dashboard / usage / data-requests
等现有模块（如需并入现有 UI 另行批准）。全部要求 ADMIN 权限。

## Skills（管理分析，只读）
- sales_funnel_analysis：`server/analytics/service.ts#salesFunnel` → `GET /api/skills/analytics?report=funnel`
  线索按状态、询盘/回复总数、机会按阶段。
- product_hotspot_analysis：`#productHotspot` → `?report=hotspot`
  从 Inquiry.rawPayload.analysis 统计被问最多的产品。
- team_performance_analysis：`#teamPerformance` → `?report=team`
  按成员统计线索/回复/活动数；标注"仅供参考，非绩效结论"。

## Tools（企业级，扩展现有数据、不接第三方）
- billing_usage：`server/usage/report.ts` → `GET /api/skills/usage-report`
  基于现有 ModelInvocation 统计调用量/Token/成本。**不接 Stripe。**
- audit_log：`server/audit/query.ts` → `GET /api/skills/audit-log?action=&entityType=&limit=`
  读现有 AuditLog（basic_log 写入的也在内）。
- export：`server/exports/service.ts` → `GET /api/skills/export?type=leads|inquiries|activities`
  导出结构化行；**导出动作写审计日志**（敏感操作可追溯）。

## 已砍（不做）
- account_growth_advisor（定位模糊）、stripe_billing、hubspot_crm（第三方，已砍）。

## 风险控制
- 全部 ADMIN 鉴权 + 租户隔离（tenantId 过滤）。
- 导出写审计；分析指标标注"仅供参考"。
- 全程只读、零外发、不改现有文件。
