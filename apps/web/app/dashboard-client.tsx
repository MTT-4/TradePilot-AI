"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { HitlAction } from "@/app/_components/hitl-action";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";
import {
  canApproveTask,
  formatTaskDetail,
  formatTaskType,
  formatTime,
  resolveTaskHref,
  type HitlTaskItem,
} from "@/app/_components/hitl-meta";

type DashboardSummary = {
  loopStats: {
    leadsCount: number;
    opportunitiesCount: number;
    repliesSentCount: number;
  };
  inquiriesCount: number;
  pendingPublish: number;
  pendingHitl: Array<{
    type: string;
    count: number;
  }>;
  replyMedianMinutes: number;
  sourceAttribution: Array<{
    platform: string;
    content: string;
    count: number;
  }>;
};

type NotificationItem = {
  id: string;
  type: string;
  status: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
};

type NotificationsResponse = {
  unreadCount: number;
  items: NotificationItem[];
};

type CrmLead = {
  id: string;
  companyName: string;
  country: string | null;
  sourceAttribution: {
    platform: string | null;
    contentTitle: string | null;
  };
};

type LeadsResponse = {
  items: CrmLead[];
};

type HitlResponse = {
  items: HitlTaskItem[];
};

type WorkspaceData = {
  summary: DashboardSummary;
  notifications: NotificationsResponse;
  hitl: HitlTaskItem[];
  leads: CrmLead[];
};

function countPending(summary: DashboardSummary | null, type: string) {
  return summary?.pendingHitl.find((item) => item.type === type)?.count ?? 0;
}

async function fetchWorkspaceData(params: {
  tenantId: string;
  role?: string;
  range: "day" | "week" | "month";
}) {
  const headers = {
    "X-Tenant-Id": params.tenantId,
  };
  const [summaryRes, notificationsRes, hitlRes, leadsRes] = await Promise.all([
    fetch(`/api/dashboard/summary?range=${params.range}`, { headers }),
    fetch("/api/notifications", { headers }),
    params.role === "viewer" ? Promise.resolve(null) : fetch("/api/hitl?status=pending", { headers }),
    params.role === "viewer" ? Promise.resolve(null) : fetch("/api/crm/leads", { headers }),
  ]);

  if (!summaryRes.ok) {
    const payload = await summaryRes.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载工作台失败。");
  }

  if (!notificationsRes.ok) {
    const payload = await notificationsRes.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载通知失败。");
  }

  if (hitlRes && !hitlRes.ok) {
    const payload = await hitlRes.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载审批队列失败。");
  }

  if (leadsRes && !leadsRes.ok) {
    const payload = await leadsRes.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载 CRM 预览失败。");
  }

  return {
    summary: (await summaryRes.json()) as DashboardSummary,
    notifications: (await notificationsRes.json()) as NotificationsResponse,
    hitl: hitlRes ? ((await hitlRes.json()) as HitlResponse).items : [],
    leads: leadsRes ? ((await leadsRes.json()) as LeadsResponse).items.slice(0, 5) : [],
  } satisfies WorkspaceData;
}

type LoopNode = {
  title: string;
  cx: number;
  cy: number;
  labelX: number;
  labelY: number;
  anchor: "start" | "middle" | "end";
  tone: "teal" | "amber" | "local";
  href: string;
};

const LOOP_NODES: LoopNode[] = [
  { title: "知识库", cx: 160, cy: 40, labelX: 160, labelY: 26, anchor: "middle", tone: "teal", href: "/kb/reviews" },
  { title: "建站", cx: 245, cy: 75, labelX: 270, labelY: 70, anchor: "start", tone: "teal", href: "/sites" },
  { title: "内容", cx: 280, cy: 160, labelX: 293, labelY: 164, anchor: "start", tone: "teal", href: "/design" },
  { title: "发布", cx: 245, cy: 245, labelX: 268, labelY: 256, anchor: "start", tone: "amber", href: "/design" },
  { title: "询盘", cx: 160, cy: 280, labelX: 160, labelY: 302, anchor: "middle", tone: "amber", href: "/crm" },
  { title: "CRM", cx: 75, cy: 245, labelX: 52, labelY: 256, anchor: "end", tone: "teal", href: "/crm" },
  { title: "首响", cx: 40, cy: 160, labelX: 27, labelY: 164, anchor: "end", tone: "local", href: "/hitl" },
  { title: "反哺", cx: 75, cy: 75, labelX: 52, labelY: 70, anchor: "end", tone: "teal", href: "/crm" },
];

const TONE_FILL: Record<LoopNode["tone"], string> = {
  teal: "var(--teal)",
  amber: "var(--amber)",
  local: "var(--local)",
};

export function DashboardClient() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [hitl, setHitl] = useState<HitlTaskItem[]>([]);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [range, setRange] = useState<"day" | "week" | "month">("week");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentMembership =
    me?.memberships.find((item) => item.tenantId === selectedTenantId) ?? null;

  async function refreshWorkspace() {
    if (!selectedTenantId) {
      return;
    }

    setLoading(true);
    setError(null);

    const payload = await fetchWorkspaceData({
      tenantId: selectedTenantId,
      role: currentMembership?.role,
      range,
    });

    setSummary(payload.summary);
    setHitl(payload.hitl);
    setLeads(payload.leads);
    setLoading(false);
  }

  useEffect(() => {
    let active = true;

    async function loadMe() {
      try {
        const payload = await fetchCurrentMe();

        if (!active) {
          return;
        }

        setMe(payload);
        setSelectedTenantId(payload.currentTenant?.tenantId ?? payload.memberships[0]?.tenantId ?? "");
      } catch (loadError) {
        if (loadError instanceof LoginRequiredError) {
          redirectToLogin();
          return;
        }

        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载用户失败。");
          setLoading(false);
        }
      }
    }

    void loadMe();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedTenantId) {
      return;
    }

    let active = true;

    void fetchWorkspaceData({
      tenantId: selectedTenantId,
      role: currentMembership?.role,
      range,
    })
      .then((payload) => {
        if (!active) {
          return;
        }

        setError(null);
        setSummary(payload.summary);
        setHitl(payload.hitl);
        setLeads(payload.leads);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载工作台失败。");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [currentMembership?.role, range, selectedTenantId]);

  const pendingQueue = hitl.slice(0, 4);
  const inquiriesCount = summary?.inquiriesCount ?? 0;
  const pendingPublish = summary?.pendingPublish ?? 0;
  const replyMedian = summary?.replyMedianMinutes ?? 0;
  const totalPendingHitl = (summary?.pendingHitl ?? []).reduce(
    (sum, item) => sum + item.count,
    0,
  );

  return (
    <>
      <div className="head-row">
        <div>
          <div className="eyebrow">闭环 · 实时</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            海外营销工作台
          </h2>
          <div className="loop-hint">
            {loading ? "同步真实数据中…" : "点击任意节点 / 数据进入对应模块"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            className="btn ghost sm"
            value={range}
            onChange={(event) => {
              setLoading(true);
              setRange(event.target.value as "day" | "week" | "month");
            }}
          >
            <option value="day">近 24 小时</option>
            <option value="week">近 7 天</option>
            <option value="month">近 30 天</option>
          </select>
          {me && me.memberships.length > 0 ? (
            <select
              className="btn ghost sm"
              value={selectedTenantId}
              onChange={(event) => {
                setLoading(true);
                setSelectedTenantId(event.target.value);
              }}
            >
              {me.memberships.map((membership) => (
                <option key={membership.tenantId} value={membership.tenantId}>
                  {membership.tenantName}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {error ? (
        <div
          className="card"
          style={{
            padding: "12px 16px",
            marginBottom: 18,
            borderColor: "var(--warn-soft)",
            background: "var(--warn-soft)",
            color: "var(--warn)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="dash-top">
        <div className="card loop-card">
          <div className="eyebrow">闭环 · 实时</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            你的出海获客闭环正在运转
          </h2>
          <div className="loop-hint">点击任意节点 / 数据，进入对应模块</div>
          <div className="loop-wrap">
            <svg className="loop-svg" viewBox="0 0 320 320">
              <circle className="loop-track" cx="160" cy="160" r="120" />
              <circle className="loop-flow" cx="160" cy="160" r="120" />
              <g textAnchor="middle">
                {LOOP_NODES.map((node) => (
                  <g
                    key={node.title}
                    className="lnode"
                    onClick={() => router.push(node.href)}
                  >
                    <circle cx={node.cx} cy={node.cy} r={5} fill={TONE_FILL[node.tone]} />
                    <text
                      className="loop-node"
                      x={node.labelX}
                      y={node.labelY}
                      textAnchor={node.anchor}
                      fill={node.tone === "teal" ? "var(--ink-2)" : TONE_FILL[node.tone]}
                    >
                      {node.title}
                    </text>
                  </g>
                ))}
                <text x="160" y="156" textAnchor="middle">
                  <tspan
                    style={{
                      fontSize: "24px",
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      fill: "var(--teal-dark)",
                    }}
                  >
                    {inquiriesCount}
                  </tspan>
                </text>
                <text
                  x="160"
                  y="176"
                  textAnchor="middle"
                  style={{ fontSize: "11px", fill: "var(--ink-3)" }}
                >
                  本周询盘
                </text>
              </g>
            </svg>
            <div className="loop-legend">
              <div className="lstat" onClick={() => router.push("/crm")}>
                <div>
                  <div className="n amber">{inquiriesCount}</div>
                  <div className="l">本周询盘</div>
                </div>
                <div className="d">
                  CRM
                  <br />
                  <span className="go">查看 →</span>
                </div>
              </div>
              <div className="lstat" onClick={() => router.push("/design")}>
                <div>
                  <div className="n">{pendingPublish}</div>
                  <div className="l">内容已产出 · 待发布</div>
                </div>
                <div className="d">
                  待发
                  <br />
                  <span className="go">查看 →</span>
                </div>
              </div>
              <div className="lstat" onClick={() => router.push("/hitl")}>
                <div>
                  <div className="n">{replyMedian}</div>
                  <div className="l">AI 首响中位耗时（分钟）</div>
                </div>
                <div className="d">
                  本地
                  <br />
                  <span className="go">查看 →</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card hitl-card">
          <div className="head-row" style={{ marginBottom: 8 }}>
            <div>
              <div className="eyebrow">待你确认</div>
              <h3 style={{ fontSize: 16, marginTop: 3 }}>人工把关队列</h3>
            </div>
            <span className="badge manual">{totalPendingHitl} 待处理</span>
          </div>
          <div className="sub" style={{ marginBottom: 6 }}>
            所有对外动作都要你点头才生效
          </div>

          {pendingQueue.map((task) => (
            <div className="hitl-item" key={task.id}>
              <div className="ic local">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M4 4h16v12H5.2L4 18z" />
                </svg>
              </div>
              <div className="grow">
                <div className="t">{formatTaskType(task.type)}</div>
                <div className="m">
                  {formatTaskDetail(task)} · {formatTime(task.createdAt)}
                </div>
              </div>
              {canApproveTask(currentMembership?.role, task.type) ? (
                <HitlAction
                  tenantId={selectedTenantId}
                  endpoint={`/api/hitl/${task.id}/approve`}
                  idleLabel="批准"
                  busyLabel="审批中…"
                  onError={(message) => setError(message || null)}
                  onSuccess={() => refreshWorkspace()}
                />
              ) : (
                <Link className="btn ghost sm" href={resolveTaskHref(task)}>
                  去查看
                </Link>
              )}
            </div>
          ))}

          {pendingQueue.length === 0 ? (
            <div className="empty" style={{ padding: "28px 12px" }}>
              <div className="t">当前没有待确认任务</div>
              <div className="s">智能体产出后会先进入这里等待你点头。</div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="head-row">
        <div>
          <div className="eyebrow">智能体</div>
          <h3 style={{ fontSize: 16, marginTop: 3 }}>四个智能体正在为你工作</h3>
        </div>
      </div>
      <div className="agent-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <Link className="agent" href="/sites">
          <div className="ai">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="4" width="18" height="14" rx="2" />
              <path d="M3 9h18" />
            </svg>
          </div>
          <div className="an">建站专家</div>
          <div className="ad">对话生成多语言落地页 · SEO/GEO</div>
          <div className="as wait">● {countPending(summary, "site_publish")} 项待审批</div>
        </Link>
        <Link className="agent" href="/design">
          <div className="ai">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 3l2.4 5.4L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.6-.6z" />
            </svg>
          </div>
          <div className="an">设计师 / 选题</div>
          <div className="ad">图文 · 视频脚本/分镜 · 内容包</div>
          <div className="as wait">● {countPending(summary, "content_publish")} 项待发布</div>
        </Link>
        <Link className="agent" href="/design">
          <span className="badge manual tag">手动·V1</span>
          <div className="ai">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" />
            </svg>
          </div>
          <div className="an">社媒运营</div>
          <div className="ad">多平台适配 + 发布清单</div>
          <div className="as idle">○ {pendingPublish} 条待发布</div>
        </Link>
        <Link className="agent lo" href="/hitl">
          <span className="badge local tag">本地</span>
          <div className="ai">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M3 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
              <circle cx="10" cy="7" r="3" />
            </svg>
          </div>
          <div className="an">AI 外贸业务员</div>
          <div className="ad">询盘理解 · 多语言首响 · 跟进</div>
          <div className="as wait">● {countPending(summary, "reply_send")} 项待发送</div>
        </Link>
      </div>

      <div className="head-row" style={{ marginTop: 22 }}>
        <div>
          <div className="eyebrow">来源归因</div>
          <h3 style={{ fontSize: 16, marginTop: 3 }}>询盘归因到平台与内容</h3>
        </div>
        <Link className="btn ghost sm" href="/crm">
          查看 CRM
        </Link>
      </div>
      <div className="card" style={{ padding: "10px 18px" }}>
        {(summary?.sourceAttribution ?? []).slice(0, 6).map((item) => (
          <Link
            key={`${item.platform}-${item.content}`}
            className="row-card"
            href="/crm"
          >
            <div className="afi">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" />
              </svg>
            </div>
            <div className="grow">
              <div className="nm">
                {item.platform.toUpperCase()}
                <span>{item.content}</span>
              </div>
              <div className="sub">询盘已归因到具体平台和内容</div>
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--teal-dark)" }}>
              {item.count}
            </div>
          </Link>
        ))}

        {(summary?.sourceAttribution.length ?? 0) === 0 && leads.length > 0
          ? leads.map((lead) => (
              <Link key={lead.id} className="row-card" href="/crm">
                <div className="afi">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M3 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
                    <circle cx="10" cy="7" r="3" />
                  </svg>
                </div>
                <div className="grow">
                  <div className="nm">
                    {lead.companyName}
                    <span>
                      {(lead.sourceAttribution.platform ?? "unknown").toUpperCase()} ·{" "}
                      {lead.sourceAttribution.contentTitle ?? "未绑定内容"}
                    </span>
                  </div>
                  <div className="sub">{lead.country ?? "未知市场"}</div>
                </div>
              </Link>
            ))
          : null}

        {(summary?.sourceAttribution.length ?? 0) === 0 && leads.length === 0 ? (
          <div className="empty" style={{ padding: "32px 12px" }}>
            <div className="t">当前范围内还没有内容归因询盘</div>
            <div className="s">发布带追踪链接的内容后，询盘会自动归因到来源。</div>
          </div>
        ) : null}
      </div>
    </>
  );
}
