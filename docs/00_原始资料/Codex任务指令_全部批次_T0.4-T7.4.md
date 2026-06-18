# Codex 任务指令 · 全部批次（M0 收尾 → M7）

> **接续《Codex 任务指令 · 第一批 T0.1–T0.3》。** 第一批的"通用规则 + 全局红线"对本文件全部任务同样生效（技术栈不变、不提交密钥、不超范围、不偏离契约、交 PR 附红线自检表、涉密钥/对外/隐私改动标注待审）。
> **一次只发一个任务。** 每个任务完成 → Claude 对照"验收/红线"审 → 创始人确认 → 合并 → 下一个。
> **里程碑闸门：** 每个里程碑的功能测试(F)+相关红线测试(R) 全绿，才进下一里程碑。
> **共同上下文：** `/docs` 下《Schema 契约》《API 契约》《UI 数据契约》《E2E 骨架》《开发任务清单》。
> **贯穿红线（每个业务任务都适用）：** 所有 tenant-scoped 读写必须经 T0.3 的 `getTenantPrisma(ctx)`，禁止裸查；对外动作必须经 HITL；含隐私/仅内部数据只走本地 Qwen/bge-m3。

---

# 第二批 · M0 收尾

## T0.4 · 鉴权 + 2FA + RBAC 骨架 [关键审核]
- **做：** Auth.js 邮箱密码登录（密码加盐哈希）+ 强制 2FA（TOTP 绑定/校验）+ 会话；实现《API 契约》§1 的 auth/me/tenants/members 端点；RBAC 角色（owner/admin/operator/sales/viewer）中间件，按《API 契约》§9 鉴权矩阵在端点层校验最小角色。
- **验收：** 注册→绑 2FA→登录需验证码；`/api/me` 返回 memberships+role；低权限角色调高权限端点→403；改成员角色写 audit_log。
- **红线：** 密码不得明文/弱哈希；2FA 不可绕过；角色校验在服务端，前端隐藏按钮不算授权。

## T0.5 · 模型网关 + 按敏感度路由 [关键审核 · 隐私红线]
- **做：** 统一接口 `LLM.invoke / Translate / Embed`，底层可插拔；**按数据敏感度路由**：公开营销→OpenAI；含 PII/仅内部→本地 Qwen；翻译→Google(glossary)；向量→本地 bge-m3。每次调用写 `model_invocations`（route/contains_pii/tokens/cost/latency）并按量记 `credit_ledger`（用量/扣费）。本地端点地址走环境变量。**DataClassifier 必须本地运行**（规则 + 本地模型），分类阶段绝不把内容发往第三方（防分类即泄密）。
- **验收：** 实现并通过 E2E **R2.1–R2.5**：仅内部内容不出现在 OpenAI/Google 出站请求；含 PII 任务 route=local_qwen；**本地不可用→503 排队，绝不 fallback 到第三方**；contains_pii=true ⇒ route∈local_*；**R2.5 分类阶段零第三方调用**。
- **红线：** 隐私路由不得有任何 fallback 到 OpenAI/Google 的分支；密钥仅服务端、按租户配额；**DataClassifier 必须本地运行、默认从严，分类阶段零第三方调用**；所有调用须写 `model_invocations` 与 `credit_ledger`。

## T0.6 · 追踪链接服务（闭环主线）
- **做：** 生成 `tracking_links`（slug/campaign/content_item/platform/target_url/utm）；`GET /t/:slug` 公开 302 跳转并写 `click_event`；来源解析 API。
- **验收：** 通过 E2E **R3.1–R3.2**：点击写 click_event；**篡改 URL 的 UTM 时以服务端 tracking_link/campaign 为准**。
- **红线：** 归因服务端权威，不信任前端 UTM。

## T0.7 · 任务队列 + 对象存储
- **做：** BullMQ+Redis worker 框架（job 类型见 Schema JobType）；`GET /api/jobs/:id` 进度查询；MinIO/S3 上传下载封装；job 支持 attempts/重试/idempotency_key。
- **验收：** 提交一个示例 job 能 queued→running→succeeded 并可轮询进度；重复 idempotency_key 不重复执行。
- **红线：** job 失败要可重试、可观测，不静默吞错。

## T0.8 · 应用外壳（AppShell）
- **做：** 套高保真原型样式实现侧栏导航 + 顶栏 + 通知中心骨架 + 租户切换器；接 `/api/me` 做 RBAC 按钮可见性；空壳路由到 5 个模块占位页。
- **验收：** 登录后进工作台壳；viewer 看不到发布/发送类入口；多租户用户可切换租户。
- **红线：** 不实现业务逻辑，仅外壳与导航。

## T0.12 · E2E 红线测试骨架落地
- **做：** 按《E2E 骨架》搭 Playwright + 集成测试框架；落地 **R1–R5 红线用例** + seed 脚本 + mock 本地模型端点（含"本地不可用"开关）；接入 CI（PR 必跑 R1–R5）。
- **验收：** R1–R5 全绿并在 CI 阻断不合格 PR。
- **红线：** 红线用例不得 skip/标记跳过。

---

# 第三批 · M1 知识库

## T1.1 · 上传与解析
- **做：** `POST /api/kb/documents`（文件/URL）→ 写 files + knowledge_documents → 投 parse job；PDF/Word/Excel 文本提取、URL 抓取；状态机 uploaded→parsing。
- **验收：** 上传后生成 document+job，状态推进可见；解析失败可重试。
- **红线：** 经 getTenantPrisma；大文件异步，不阻塞请求。

## T1.2 · 切块 + 敏感分级
- **做：** 解析文本切块（保留表格/参数结构）写 knowledge_chunks；打元数据（product/market/language）与 `sensitivity`(public/internal_only)；提供默认分级建议（报价/合同/内部→internal_only）。
- **验收：** chunk 带正确 tenant_id/sensitivity/metadata。

## T1.3 · bge-m3 向量化入库 [关键审核]
- **做：** chunk → 本地 bge-m3（模型网关 Embed）生成 vector(1024) → 写 pgvector，**namespace 按 tenant 隔离**；异步 + 进度。
- **验收：** E2E **R1.3**：B 检索不到 A 的 chunk；状态 embedding→ready。
- **红线：** 向量化只走本地 bge-m3；按租户隔离。

## T1.4 · 检索接口 + 抗幻觉护栏
- **做：** `POST /api/kb/search` 语义+关键词混合检索，按 tenant+过滤；`allowInternalOnly` 仅本地 Qwen 路径可用；**无依据时返回空并提示补充，不编造**。
- **验收：** 检索按租户/敏感级正确过滤；空结果不强行生成事实。
- **红线：** internal_only 内容不得进入发往第三方的 prompt（配合 T0.5）。

## T1.5 · 知识审核页
- **做：** `/api/kb/reviews` + 审核 UI（卡片确认/修正/标已核准/标敏感级/溯源），按《UI 数据契约》§3。
- **验收：** 可标已核准/仅内部/可公开并溯源；概况统计正确。

---

# 第四批 · M2 建站智能体

## T2.1 · 对话式生成
- **做：** `POST /api/sites/generate`（半结构化 brief）→ 检索**仅 public 知识**→模板填充生成站点草稿；`/sites/:id/chat` 对话改。
- **验收：** E2E **F-M2** 起步：brief→站点草稿；生成只引用 public 知识。
- **红线：** 建站内容不得引用 internal_only 知识。

## T2.2 · 多语言 + URL 结构
- **做：** OpenAI 出源语 + Google 翻译(glossary 锁型号/品牌)；site_locales 每语种独立 url_path + hreflang；**阿语 direction=rtl**。
- **验收：** 生成 EN/AR/RU；ar 为 rtl；URL 带语种后缀。

## T2.3 · SEO/GEO 注入
- **做：** 自动注入 TDK、JSON-LD、顶部快答块、FAQ、robots 放行 AI bot、关键内容 SSR、**OG/VK 社媒分享卡**。
- **验收：** 预览体检显示 SEO/GEO/移动端/表单检查结果（UI 契约 §4）。

## T2.4 · 站点管理台 + HITL 发布
- **做：** site_projects 列表/上下线/版本快照回滚/预览；发布走 `publish-request`→hitl_task。响应式渲染。
- **验收：** E2E **R4.1–R4.2**：未审批不上线；approve 后才上线并写 audit_log；可回滚版本。
- **红线：** 无静默上线路径。

## T2.5 · AI 按知识库自动补全内容
- **做：** `/sites/:id/autofill` 由知识库生成新产品/认证/博客**草稿候选**，每条"确认上线(HITL)/调整"。
- **验收：** 候选生成；每条需人工确认才上线、可编辑。
- **红线：** 自动补全不得自动对外，必须经确认。

---

# 第五批 · M3 设计 / 内容包

## T3.1 · 人+AI 设计对话窗口
- **做：** `/content-packs/:id/chat` 选题建议(取知识库+市场)+逐平台调整文案/语气/规格/时间，实时改；UI 按契约 §6 左聊右内容包。
- **验收：** 选题→生成→对话逐平台改后右侧更新。

## T3.2 · 图文生成
- **做：** 文生图/图生图/抠图换背景 + 品牌资料包；输出平台适配图、封面图、文案、标签。
- **验收：** 图文 item 可用并套品牌 VI。

## T3.3 · 视频平台脚本与分镜（V1.0 必做）
- **做：** 为 Reels/TikTok/Shorts/VK Клипы/RuTube 输出**脚本、分镜建议、封面图、标题、文案、标签、规格校验**；content_items.media_type=`video_script`。
- **验收：** 视频平台 item 含脚本/分镜/封面，**不含成片**。

## T3.4 · V1.0 范围约束（不做成片）[纪律红线]
- **做：** 显式确保**不生成短视频成片、不做 TTS、不做自动字幕**；涉视频平台只产脚本/分镜/封面/规格。
- **红线：** 不得把成片/TTS/字幕（V1.5）提前塞进 V1.0。

## T3.5 · 平台规则库 + GPT 校正 + 内容包 + 清单
- **做：** 9 平台规则做成可配置 `platform_rules`；GPT 按最新规则给建议并自动校正（文案长度/标签/本地化/时长/比例/封面/钩子）；**每个 content_item 预埋 tracking_link**；发布清单（负责人/计划时间/状态/追踪链接/标记已发绑 content_item_id）+ 导出(csv/md/zip)。
- **验收：** E2E **F-M3**：选题→9 平台达标 item→GPT 校正生效→每条有追踪链接→清单可导出；标记已发绑 content_item_id 且可撤回。

---

# 第六批 · M4 询盘 → CRM

## T4.1 · 表单归集 + 来源归因
- **做：** `POST /api/public/leads/form`（限流+幂等）→ lead；用 trackingSlug 解析来源(platform→content→tracking_link)；去重。
- **验收：** E2E **R3.3**：click→表单→lead→inquiry 链路不断、来源可回溯。
- **红线：** 来源服务端权威；幂等防重复 lead。

## T4.2 · 入站邮件归集
- **做：** `POST /api/webhooks/inbound-email`（验签+Idempotency-Key）→ inbound_emails→关联/创建 lead；去重 dedupe_hash；垃圾过滤。
- **验收：** E2E **R5.1–R5.2**：重投只产 1 条；垃圾标 spam 不进池。
- **红线：** webhook 验签 + 幂等。

## T4.3 · 最小 CRM + 管道
- **做：** contacts/leads/inquiries/opportunities/crm_activities；线索池(来源归因/打分/状态)、商机管道(拖拽 stage)、到期提醒；sales 仅见自己线索。
- **验收：** E2E **F-M4**：两来源→去重→管道改 stage；RBAC：sales 越权看他人线索→403。

---

# 第七批 · M5 首响 / 打分 / 看板

## T5.1 · AI 首响草稿（本地 Qwen）[关键审核 · 隐私红线]
- **做：** `POST /api/replies/draft`（inquiryId）→**本地 Qwen** 取知识库生成多语言草稿+引用；状态机 draft→pending_approval→sent/rejected；发送走 HITL `reply_send`。
- **验收：** E2E **R2.2–R2.3 + R4**：草稿仅 local_qwen；本地不可用→排队不 fallback；未审批不发送；发送写 audit_log。
- **红线：** 首响绝不走第三方；绝不静默发送。

## T5.2 · 规则式线索打分
- **做：** A/B/C 规则引擎（国家/采购量关键词/是否留电话/询盘具体度），可配置、可解释，写 score_reason。
- **验收：** 线索有 score + 可展开看"为什么是 A 级"。

## T5.3 · 工作台/看板数据
- **做：** `GET /api/dashboard/summary`：闭环统计 + 待处理 HITL + 来源分布(platform→content→询盘数)；按 range。
- **验收：** E2E **F-M5**：新询盘→本地起草→人工发；看板正确显示来源归因。

---

# 第八批 · M6 控制台整合

## T6.1 · 工作台闭环 + 可下钻
- **做：** 闭环图 + 三统计 + 智能体卡 + 待确认队列接真实数据；节点/数字/卡片点击下钻到对应模块（UI 契约 §2）。
- **验收：** 所有可点元素正确跳转且数据真实。

## T6.2 · 通知中心 + HITL 统一入口
- **做：** `/api/notifications` + 铃铛；待处理询盘/待审批(网站/内容/首响)统一入口；`<HitlAction>` 组件全站复用。
- **验收：** 通知点击直达；三类对外动作走同一审批组件。

## T6.4 · 四角色实战验收
- **做：** 跑《E2E 骨架》§3 的 18 步完整闭环剧本（前端/后端/用户/运营视角）。
- **验收：** 18 步断言全部通过，方算 V1.0 闭环通过。

---

# 第九批 · M7 硬化与上线

## T7.1 · RBAC 完整化 [关键审核]
- **做：** 角色 × 操作细粒度授权落全；代运营场景跨租户切换 + 操作留痕；审批权限可配。
- **验收：** 各角色越权操作全被拦截并审计；跨租户切换有留痕。
- **红线：** 授权服务端强制。

## T7.2 · 安全硬化 [关键审核]
- **做：** TLS、敏感字段加密、全量审计日志、第三方密钥集中保管+异常熔断、限流、备份/DR（pg+对象存储）、GDPR/PIPL 导出/删除(data_requests)。
- **验收：** 审计覆盖对外动作/权限变更/删数据；密钥不在库；备份可恢复演练通过。
- **红线：** 任何敏感操作可审计、可回溯。

## T7.3 · 本地模型迁移
- **做：** Qwen/bge-m3 从 Mac 迁到自有云 GPU/服务器，**仅改模型网关端点配置**；保持隐私路由不变。
- **验收：** 切端点后 R2 隐私测试仍全绿；无代码改动即完成迁移。
- **红线：** 不得迁成第三方 AI 接口（须自控环境）。

## T7.4 · 端到端验收 + 人工安全审查
- **做：** 全量跑 R1–R5 + F-M1~M5 + 18 步剧本；压测租户隔离与隐私路由。
- **验收：** 全绿。
- **红线（上线前必须）：** **接入任何真实客户数据前，完成至少一次人工安全审查/渗透测试**，重点租户隔离、隐私路由、鉴权、密钥。

---

## 审核与推进总则
- 顺序：M0 收尾 → M1 → M2/M3（可并行）→ M4 → M5 → M6 → M7。
- 每个 [关键审核] / 红线任务，Claude 审核时逐条核对红线，不满足即退回，**红线测试不得 skip**。
- 每个里程碑跑一遍精简版闭环剧本，别只等 M6。
- 上线前的人工安全审查是硬门槛，代理"功能跑通"不等于"可托管他人数据"。
