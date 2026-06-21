# TradePilot AI · Skill + Tool 落地执行计划（对齐代码库现状版）

版本：V2.0（基于真实仓库现状重写 V1.1）
用途：给 Codex / 开发 Agent 直接执行
适用仓库：`tradepilot-ai-local-server`（Next.js App Router + TS + Tailwind v4 + Prisma/PostgreSQL，npm workspaces）

> 为什么重写：你上传的 V1.1 文档把项目当成「几乎空白、从 P0 搭基础」来规划。但当前仓库实际上已经把
> V1.1 里 P1/P2 的大部分能力、以及 P5 的多租户/权限地基都实现了，只是命名是「T 系列任务」而不是
> 「skills/ + tools/ 目录」。所以本文档做两件事：①把 V1.1 的 19 个 Skill / 33 个 Tool 逐项映射到
> 仓库里已有的模块（复用 / 补充 / 新建）；②按"还差什么"重排分期，给出可直接喂给 Codex 的指令块。

---

## 0. 先回答你最关心的问题：这个怎么用其他大模型

仓库已经内置了「模型网关 + 模型策略」，换大模型**不需要改业务代码**，三种方式：

1. **第三方对话模型（DeepSeek / 通义千问 / Moonspace / 月之暗面 / 本地 vLLM 等，OpenAI 兼容协议）**
   改 `.env` 三个值即可（见 `.env.example`）：
   ```bash
   OPENAI_BASE_URL=https://api.deepseek.com/v1   # 换成目标服务的兼容端点
   OPENAI_API_KEY=sk-xxxx                         # 目标服务密钥
   OPENAI_MODEL=deepseek-chat                      # 目标模型名
   ```
2. **本地隐私模型（Qwen / bge-m3，走 llama.cpp / vLLM）**
   改 `LOCAL_QWEN_BASE_URL` / `LOCAL_QWEN_MODEL` / `LOCAL_BGE_*`。
   **隐私红线（AGENTS.md 铁律 3）：客户姓名、电话、询盘正文只能走本地 Qwen，绝不发往 OpenAI / Google。**
3. **运行时按任务切换**：网关代码在 `apps/web/server/model-gateway/`，策略在
   `apps/web/server/settings/service.ts`，前端入口 `app/api/settings/model-policy` 与
   `app/api/settings/local-models`。要按「任务类型」路由到不同模型，改模型策略即可，业务 Skill 不用动。

> 结论：换模型 = 改 `.env` 或改「模型策略」设置，不要在各个 Skill 里硬编码模型名。

---

## 1. 平台现状速览（Codex 必须遵守）

技术栈与约定：

- 单仓 monorepo：业务全在 `apps/web`（`@tradepilot/web`），公共包在 `packages/*`。
- 业务逻辑：`apps/web/server/<domain>/service.ts`；HTTP 入口：`apps/web/app/api/<domain>/route.ts`。
- 数据访问统一走多租户封装 `apps/web/server/db/tenant-prisma.ts`，新增模型必须带 `tenantId` 注入与校验。
- 模型调用统一走 `apps/web/server/model-gateway/`，不要在业务里直接 fetch 模型 API。
- UI 复用 `apps/web/app/globals.css` 组件类与 `app/_components/app-shell.tsx`，不套整页背景、不硬编码颜色。
- HITL（人工确认）审批流已存在：`app/api/hitl`、`server/dashboard`，所有"自动动作"必须经它。
- Node 22；命令用 `npm run lint && npm run typecheck && npm run test`（**不是只跑 build**）。

### 1.1 已存在的领域模块（对照 V1.1 的"待开发"，实际多数已具备）

| 仓库模块 | 路径 | 覆盖了 V1.1 的什么 |
|---|---|---|
| 知识库 KB | `server/kb/`（parser/chunker/sensitivity/search/reviews）+ `app/api/kb` | file_upload / document_parse / product_knowledge / vector_search / knowledge_reference |
| 线索 Leads | `server/leads/`（scoring/rate-limit）+ `app/api/public/leads`、`app/api/crm/inquiries` | inquiry_detection / customer_scoring / inquiry_save |
| 回复 Replies | `server/replies/` + `app/api/replies/draft` | first_response_draft / draft_reply_tool |
| CRM | `server/crm/` + `app/api/crm/{leads,opportunities,activities}` | crm_auto_entry / crm_light_tool |
| 入站邮件 | `server/inbound-email/` + `app/api/webhooks/inbound-email` | gmail_inbox_tool 的国产化雏形（webhook 入站） |
| 模型网关 | `server/model-gateway/` + `app/api/settings/model-policy` | 多模型路由 / multilingual 的底座 |
| 追踪 Tracking | `server/tracking/` + `app/api/tracking-links` | basic_log / posthog 类埋点雏形 |
| 内容/建站 | `server/content-packs/`、`server/sites/` | AI 建站与营销内容（V1.1 未覆盖，属平台已有特色） |
| 调度 | `server/scheduling/promotion-timing.ts` | follow_up_scheduler 的时间策略底座 |
| 多租户/权限/2FA | `server/db/tenant-prisma.ts`、`server/auth/{rbac,totp,access}` | P5 的 tenant_isolation / permission / 2FA |
| 数据请求/审计 | `server/data-requests/` | P5 的 audit_log / export 雏形 |
| 任务队列 | `server/jobs/`（worker/redis）| 异步落地（解析、嵌入、监控）的执行器 |

---

## 2. Skill 全清单 · 现状对照与落点（19 个）

状态：✅已实现可复用　🟡部分/需补充　⬜缺失需新建

| # | Skill | 现状 | 落点（复用/补充/新建） | 关键动作 |
|---|---|---|---|---|
| 1 | inquiry_detection 询盘识别 | 🟡 | `server/leads/scoring.ts` 已有意图/关键词/国家信号 | 补全结构化 Schema 输出（V1.1 §4.2.1 字段），抽成 `server/leads/inquiry-detection.ts` |
| 2 | knowledge_reference 知识库引用 | ✅ | `server/kb/service.ts` `hybridSearchKnowledgeChunks` | 复用；补"缺失信息提醒+来源高亮"输出字段 |
| 3 | first_response_draft 首封回复 | ✅ | `server/replies/service.ts`（已串 KB 检索+网关） | 复用；按 §4.2.3 增加"需确认问题/不确定点/下一步" |
| 4 | quotation_assistant AI 报价 | ⬜ | 新建 `server/quotation/service.ts` + `app/api/quotation` | FOB/CIF/EXW、阶梯价、报价有效期，必须"需人工确认"经 HITL |
| 5 | customer_scoring 客户评分 | 🟡 | `server/leads/scoring.ts`（`LeadScore`） | 补"评分原因"输出，不只给分数 |
| 6 | follow_up_scheduler 跟进节奏 | 🟡 | `server/scheduling/` + `server/jobs/` | 新增 1/3/7/14/30 天跟进计划生成器，产出可编辑任务 |
| 7 | multilingual_localization 多语言 | 🟡 | 网关已可调翻译/生成 | 抽成专用 Skill，避免机翻腔；接 `model-gateway` |
| 8 | crm_auto_entry CRM 入库 | ✅ | `server/crm/service.ts` | 复用；补从询盘/邮件自动结构化入库 |
| 9 | order_delivery_communication 订单交期 | ⬜ | 新建 `server/orders/service.ts` | PI/付款/生产/发货/售后沟通模板，禁止 AI 承诺交期 |
| 10 | market_intelligence 市场情报 | ⬜ | 新建 `server/intelligence/service.ts` | 输出必带来源字段+置信度；仅供参考 |
| 11 | exhibition_lead 展会获客 | ⬜ | 新建 `server/intelligence/exhibition.ts` | 展前/中/后跟进模板 |
| 12 | compliance_risk 合规风险 | ⬜ | 新建 `server/compliance/service.ts` | CE/RoHS/FCC/FDA；输出必带"需专业机构确认" |
| 13 | lead_generation 线索生成 | ⬜ | 新建 `server/intelligence/lead-gen.ts` | 目标客户画像；禁止自动群发 |
| 14 | competitor_analysis 竞品分析 | ⬜ | 新建 `server/intelligence/competitor.ts` | 竞品卖点/价格/定位，mock 数据起步 |
| 15 | sales_funnel_analysis 销售漏斗 | 🟡 | `server/dashboard/service.ts` 已有汇总 | 扩展为漏斗转化分析 |
| 16 | product_hotspot_analysis 产品热度 | ⬜ | 新建，复用 KB+询盘统计 | 哪些产品被问最多、资料缺口 |
| 17 | team_performance_analysis 绩效 | ⬜ | 新建，复用 replies/crm 时间戳 | 回复速度/跟进次数/成交机会 |
| 18 | strategy_admin_assistant 策略后台 | ⬜ | 新建 `app/settings` 扩展 | 调报价/评分/跟进规则 |
| 19 | account_growth_advisor 增长建议 | ⬜ | 新建 `server/intelligence/growth.ts` | 基于数据给市场/产品/客户建议 |

---

## 3. Tool 全清单 · 现状对照与落点（33 个）

| # | Tool | 现状 | 落点 | 关键动作 |
|---|---|---|---|---|
| 1 | file_upload_tool | ✅ | `app/api/files`、`server/storage/object-store.ts` | 复用 S3/MinIO 上传 |
| 2 | document_parse_tool | ✅ | `server/kb/parser.ts` | 复用；OCR 后续预留 |
| 3 | product_knowledge_tool | ✅ | `server/kb/service.ts` + `app/api/kb/documents` | 复用 |
| 4 | vector_search_tool | ✅ | `server/kb/`（hybrid search）+ `app/api/kb/search` | 复用；确认 pgvector/嵌入接通 |
| 5 | inquiry_save_tool | ✅ | `server/leads/`、`app/api/crm/inquiries` | 复用 |
| 6 | draft_reply_tool | ✅ | `app/api/replies/draft` | 复用 |
| 7 | basic_log_tool | 🟡 | `server/tracking/` + `server/jobs/` | 补统一日志门面，预留 Langfuse/Sentry |
| 8 | quotation_rule_tool | ⬜ | 新建 `server/quotation/rules.ts` | 利润率/价格区间/MOQ/币种/模板 |
| 9 | currency_rate_tool | ⬜ | 新建，mock 起步 | 汇率，后续接真实源 |
| 10 | crm_light_tool | ✅ | `server/crm/service.ts` | 复用 |
| 11 | follow_up_task_tool | 🟡 | `server/jobs/` + 新增任务模型 | 生成待办/提醒 |
| 12 | email_template_tool | ⬜ | 新建 `server/templates/service.ts` | 开发信/跟进信/报价信模板 |
| 13 | gmail_inbox_tool | 🟡 | 已有 `inbound-email` webhook | 加 Gmail 适配器，只读+草稿，不自动发 |
| 14 | whatsapp_message_tool | ⬜ | 新建适配器 | 只导入+建议，人工发 |
| 15 | n8n_workflow_tool | ⬜ | 新建 webhook 预留 | 不强制真实部署 |
| 16 | langfuse_trace_tool | ⬜ | 新建，挂到 model-gateway | 记录 prompt/输出/来源 |
| 17 | sentry_error_tool | ⬜ | 新建，前端+API 错误 | 环境变量配置 |
| 18 | posthog_analytics_tool | 🟡 | 已有 tracking 雏形 | 补关键事件埋点 |
| 19 | email_delivery_tool | ⬜ | 新建 Resend/Mailgun 适配 | 仅草稿发送测试，不群发 |
| 20 | hunter_lead_tool | ⬜ | 新建适配器，mock | 邮箱查找验证 |
| 21 | apollo_enrichment_tool | ⬜ | 新建适配器，mock | 客户资料补全 |
| 22 | importyeti_research_tool | ⬜ | 新建适配器，mock | 美国进口记录 |
| 23 | similarweb_research_tool | ⬜ | 新建适配器，mock | 网站/流量分析 |
| 24 | customs_data_tool | ⬜ | 新建预留 | 海关数据 |
| 25 | hs_code_tool | ⬜ | 新建 | HS Code 候选 |
| 26 | certification_rule_tool | ⬜ | 新建 `server/compliance/rules.ts` | CE/RoHS/FCC/FDA 规则库 |
| 27 | stripe_billing_tool | ⬜ | 新建，mock；webhook 校验 | 会员订阅 |
| 28 | hubspot_crm_tool | ⬜ | 新建，mock；失败重试 | CRM 深度同步 |
| 29 | permission_tool | ✅ | `server/auth/rbac.ts`、`access.ts` | 复用 owner/admin/sales/viewer |
| 30 | tenant_isolation_tool | ✅ | `server/db/tenant-prisma.ts` | 复用 |
| 31 | billing_usage_tool | 🟡 | `app/api/usage` | 扩展用量计费 |
| 32 | audit_log_tool | 🟡 | `server/data-requests/` | 扩展为统一审计日志 |
| 33 | export_tool | 🟡 | `app/api/content-packs/[id]/export` 有先例 | 扩展为客户/询盘/报价导出 |

---

## 4. 重排后的分期（按"还差什么"，不是从零）

V1.1 的 P0/P1 在本仓库基本已完成，因此分期改为以下五个"补缺"阶段（Gap 阶段）。**严格一次只做一个阶段。**

> **精简结论已采纳（见 `docs/skills/技能与工具_精简决策表.md`）。** 范围按下表收敛：
> 砍掉 9 个平台已有的重复 Tool、3 个窄/模糊 Skill（lead_generation、exhibition_lead、account_growth_advisor）；
> 合并 2 个（multilingual_localization→first_response_draft；sales_funnel_analysis→dashboard）；
> **全部 13 个第三方连接器整体砍掉、移出路线图**（gmail/whatsapp/n8n/langfuse/sentry/posthog/
> email_delivery/hunter/apollo/importyeti/similarweb/stripe/hubspot）；只做本地、不外发的项。
> 另：凡需改动现有文件的增强（customer_scoring、first_response_draft）列为"需批准"，默认不动现有架构。

| 阶段 | 目标 | 要做（精简后） | 不做（砍） |
|---|---|---|---|
| G1 本地闭环 | 询盘识别→知识引用→CRM 归档（纯新增文件） | inquiry_detection、knowledge_reference、crm_auto_entry（✅已完成） | customer_scoring/first_response_draft 增强=需批准 |
| G2 销售增强 | 报价、跟进、模板（全本地） | quotation_assistant、follow_up_scheduler；Tool：quotation_rule、currency_rate、follow_up_task、email_template | multilingual 合并进回复；不接外部 |
| G3 订单沟通 | 订单/交期话术（本地） | order_delivery_communication | Gmail/WhatsApp/n8n/Langfuse/Sentry/PostHog/email_delivery 全部砍 |
| G4 合规（本地） | 合规清单与认证规则（本地） | compliance_risk；Tool：hs_code、certification_rule | hunter/apollo/importyeti/similarweb 砍；lead_generation/exhibition 砍；market/competitor 无源搁置 |
| G5 企业级（扩展现有） | 计费/审计/导出（扩展不新建） | 扩展 usage、data-requests、export | stripe/hubspot 砍；account_growth_advisor 砍；漏斗并入 dashboard |

每阶段统一约束：只新增文件、不改现有架构（需改现有文件的单独批准）；**不接任何第三方外部服务、不外发数据**；价格/交期/认证/合规结论必须经 HITL；不破坏现有登录、控制台、KB、建站、上传。

---

## 5. Codex 可执行指令块

> 用法：在仓库根目录依次执行。每个阶段先把任务写进 `docs/codex_tasks/`，再 `codex` 执行，最后跑校验。

### 5.1 G1 — 闭环补全

```bash
cd ~/ai-projects/tradepilot-ai
mkdir -p docs/codex_tasks

cat > docs/codex_tasks/G1_loop_completion.md <<'EOF'
# G1：本地询盘闭环（纯新增文件，不改现有架构）

背景：仓库已实现 KB、leads、replies、crm、model-gateway。只新增文件、复用现有服务，禁止修改现有文件。

已完成（本仓库已落地，typecheck/eslint 通过，未改任何现有文件）：
- inquiry_detection：server/leads/inquiry-detection.ts + app/api/skills/inquiry-detection。
  结构化结果存 Inquiry.rawPayload.analysis；sensitivity=INTERNAL_ONLY 强制本地 Qwen。
- knowledge_reference：server/kb/knowledge-reference.ts + 路由。复用 hybridSearchKnowledgeChunks，补缺失提醒。
- crm_auto_entry：server/crm/crm-auto-entry.ts + 路由。复用 createCrmActivity，回填 Lead、写跟进 note。

需批准后才做（会改现有文件，默认不动）：
- customer_scoring 增强：改 leads/scoring.ts（现状已是规则打分 + Lead.scoreReason 单字符串，够用）。
- first_response_draft 增强：改 replies/service.ts，把分析字段写进 Reply.citations.meta。

契约文档见 docs/skills/（已按真实 schema 校正）。
完成后运行：npm run lint && npm run typecheck（test 需本地 DB + seed）。
EOF

codex "$(cat docs/codex_tasks/G1_loop_completion.md)"
```

### 5.2 G2 — 销售增强

```bash
cd ~/ai-projects/tradepilot-ai
cat > docs/codex_tasks/G2_sales_enhancement.md <<'EOF'
# G2：报价 / 跟进 / 模板（全本地，新增文件优先）

前提：G1 已完成。范围已精简：多语言不单列、合并进回复生成；不接任何外部服务。

要做：
1. 新建 server/quotation/{service.ts,rules.ts} 与 app/api/skills/quotation/route.ts：
   报价助手 + 报价规则（FOB/CIF/EXW、MOQ、阶梯价、样品价、报价有效期、币种）。
   报价只生成"建议"，必须标"需人工确认"并经现有 HITL，禁止 AI 自动承诺价格。
2. 新建 follow_up_scheduler（新文件）：复用 server/scheduling 与 server/jobs，生成第 1/3/7/14/30 天
   可编辑跟进任务，不自动发送。配 follow_up_task（待办/提醒）。
3. 新建 server/templates/service.ts（email_template）：开发信/跟进信/报价信模板。
4. 新建 currency_rate：mock 起步，环境变量预留真实汇率源。
5. 优先新增文件、复用现有 UI 组件类与 app-shell，不重做 UI。

不做（已精简）：
- multilingual_localization 不单列（语言本地化并入 first_response_draft，需批准时再做）。
- customer_scoring 沿用现有规则打分，不重写。

完成后：npm run lint && npm run typecheck。输出：新增文件、mock 清单、HITL 接入点。
EOF

codex "$(cat docs/codex_tasks/G2_sales_enhancement.md)"
```

### 5.3 G3 — 订单沟通（本地）；渠道连接器全部缓做

```bash
cd ~/ai-projects/tradepilot-ai
cat > docs/codex_tasks/G3_order_communication.md <<'EOF'
# G3：订单与交期沟通（本地，新增文件）

前提：G1、G2 稳定。范围已精简：本阶段只做本地的订单沟通话术；所有第三方渠道已砍。

要做：
1. 新建 order_delivery_communication（新文件）：PI/付款提醒/生产进度/发货/售后/补货沟通话术，
   走 model-gateway 本地路由，禁止 AI 承诺交期，输出可编辑草稿、不自动发。

已砍（移出路线图，不做）：
- gmail_inbox、whatsapp_message、n8n_workflow、langfuse_trace、sentry_error、
  posthog_analytics、email_delivery。如未来确需，再单独立项重新评估。

完成后：npm run lint && npm run typecheck。
EOF

codex "$(cat docs/codex_tasks/G3_order_communication.md)"
```

### 5.4 G4 — 合规（本地）；情报/线索砍或缓

```bash
cd ~/ai-projects/tradepilot-ai
cat > docs/codex_tasks/G4_compliance_local.md <<'EOF'
# G4：合规与认证规则（本地，新增文件）

前提：G1-G3 稳定。范围已精简。

要做：
1. 新建 server/compliance/{service.ts,rules.ts}（compliance_risk + certification_rule）：
   CE/RoHS/FCC/FDA 清单与风险提示，本地规则库，输出必须带"需人工确认 / 需专业机构确认"，不作法律意见。
2. 新建 hs_code（本地规则/候选）：HS Code 候选与出口分类辅助。

砍掉（移出路线图，不做）：
- lead_generation（群发/ToS 雷区）、exhibition_lead（场景窄）。
- 第三方数据源 hunter/apollo/importyeti/similarweb 及 customs_data 全部砍（禁止转售/再分发）。
- market_intelligence、competitor_analysis 失去数据源，搁置（如未来要做须先有合规自有数据）。

完成后：npm run lint && npm run typecheck。
EOF

codex "$(cat docs/codex_tasks/G4_compliance_local.md)"
```

### 5.5 G5 — 商业化与企业级

```bash
cd ~/ai-projects/tradepilot-ai
cat > docs/codex_tasks/G5_enterprise_extend.md <<'EOF'
# G5：扩展现有的计费/审计/导出 + 本地管理分析

前提：G1-G4 稳定。多租户隔离(tenant-prisma)、RBAC、2FA、usage、data-requests 已存在，复用不要重建。

要做（扩展现有，不新建一套）：
1. 扩展 billing_usage（基于现有 app/api/usage 与 ModelInvocation）：AI 次数/存储/坐席计量。
2. 扩展 audit_log（基于现有 server/data-requests）：导出/敏感操作写审计；DataRequest 覆盖 rawPayload。
3. 扩展 export（参考现有 content-packs export）：客户/询盘/报价/跟进/知识库导出，导出写审计。
4. 本地管理分析 Skill（复用 dashboard/crm/replies 数据，全本地、低风险）：
   product_hotspot_analysis、team_performance_analysis、strategy_admin_assistant。
   sales_funnel_analysis 直接并入现有 dashboard，不单列。

砍掉（移出路线图，不做）：
- account_growth_advisor（定位模糊）。
- stripe_billing、hubspot_crm 全部砍（第三方外部服务；计费如需先用本地用量计量起步，不接 Stripe）。

完成后：npm run lint && npm run typecheck。输出：权限矩阵、上线前检查清单。
EOF

codex "$(cat docs/codex_tasks/G5_enterprise_extend.md)"
```

---

## 6. 全阶段统一规则（对齐 AGENTS.md 铁律）

1. 一次只执行一个阶段，先写 `docs/codex_tasks/` 任务文件再 `codex` 执行。
2. 校验命令用 `npm run lint && npm run typecheck && npm run test`，不要只跑 `build`；可用 `npm run check` 一把过。
3. 数据访问走 `server/db/tenant-prisma.ts`，新增模型带 `tenantId`。
4. 模型调用走 `server/model-gateway/`，不在业务里直连模型 API；换模型改 `.env` 或模型策略。
5. **隐私红线**：客户姓名/电话/询盘正文只走本地 Qwen，绝不发 OpenAI/Google。
6. 外部 API 第一版必须 mock fallback；API Key 一律环境变量，禁止硬编码。
7. 价格/交期/认证/合规结论 + 任何自动发送，必须经 HITL 人工确认。
8. UI 复用 `globals.css` 组件类与 `app-shell.tsx`，不套整页背景、不硬编码颜色、不动原有数据获取与权限逻辑。
9. AI 输出统一标注：引用来源、不确定点、下一步建议。
10. 每阶段结束输出：修改文件清单、测试结果、mock 清单、剩余阻塞点。

---

## 7. 每阶段收尾命令

```bash
cd ~/ai-projects/tradepilot-ai
npm run check          # lint + typecheck + test 一次跑完
git status

# 通过则提交
git add . && git commit -m "feat: Gx skills/tools phase" && git push

# 失败则记录日志交给 Codex 修复
npm run check 2>&1 | tee check-error.log
```

---

## 8. 一句话结论

仓库已经跑通了 V1.1 设想的 P1 询盘闭环和 P5 多租户地基，**当前真正要做的不是"从零搭 skills/tools"，而是
①把已有闭环的 Skill 输出补成标准契约（G1）→ ②加报价/跟进/多语言（G2）→ ③接渠道与监控（G3）→
④情报与合规（G4）→ ⑤商业化（G5）**。换大模型只需改 `.env` 或模型策略，业务代码零改动。
