"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HitlAction } from "@/app/_components/hitl-action";
import {
  canApproveTask,
  formatTaskDetail,
  formatTaskType,
  formatTime,
  resolveTaskHref,
  type HitlTaskItem,
} from "@/app/_components/hitl-meta";

type Membership = {
  tenantId: string;
  role: string;
  status: string;
  tenantName: string;
  tenantSlug: string;
  defaultLocale: string;
};

type MeResponse = {
  memberships: Membership[];
  currentTenant: Membership | null;
};

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

export function DashboardClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [notifications, setNotifications] = useState<NotificationsResponse | null>(null);
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
    setNotifications(payload.notifications);
    setHitl(payload.hitl);
    setLeads(payload.leads);
    setLoading(false);
  }

  useEffect(() => {
    let active = true;

    async function loadMe() {
      try {
        const response = await fetch("/api/me");

        if (!response.ok) {
          throw new Error("请先登录并完成 2FA。");
        }

        const payload = (await response.json()) as MeResponse;

        if (!active) {
          return;
        }

        setMe(payload);
        setSelectedTenantId(payload.currentTenant?.tenantId ?? payload.memberships[0]?.tenantId ?? "");
      } catch (loadError) {
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
        setNotifications(payload.notifications);
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

  const loopNodes = [
    {
      title: "询盘",
      value: summary?.inquiriesCount ?? 0,
      detail: "新询盘进入 CRM",
      href: "/crm",
    },
    {
      title: "线索",
      value: summary?.loopStats.leadsCount ?? 0,
      detail: "线索归因到内容与来源",
      href: "/crm",
    },
    {
      title: "商机",
      value: summary?.loopStats.opportunitiesCount ?? 0,
      detail: "销售推进到商机阶段",
      href: "/crm",
    },
    {
      title: "首响",
      value: summary?.loopStats.repliesSentCount ?? 0,
      detail: "AI 草稿经 HITL 后发送",
      href: "/hitl",
    },
  ];

  const pendingQueue = hitl.slice(0, 6);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(35,96,75,0.18),_transparent_28%),linear-gradient(180deg,#fbf7ef_0%,#efe6d3_100%)] px-4 py-6 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="rounded-[30px] border border-[#ddd3bd] bg-white/92 p-6 shadow-[0_24px_100px_rgba(50,41,22,0.08)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#2c6d56]">
                Workspace / T6.1
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#1f241f] md:text-5xl">
                海外营销工作台
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[#655f52]">
                询盘、内容、审批、首响已接到真实数据。所有数字、闭环节点和智能体卡片都可以直接下钻到对应模块。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-full border border-[#ddd3bd] bg-[#fffaf0] px-4 py-2 text-sm text-[#1f241f]">
                铃铛 {notifications?.unreadCount ?? 0}
              </div>
              <select
                className="rounded-full border border-[#ddd3bd] bg-white px-4 py-2 text-sm"
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
              <select
                className="rounded-full border border-[#ddd3bd] bg-white px-4 py-2 text-sm"
                value={selectedTenantId}
                onChange={(event) => {
                  setLoading(true);
                  setSelectedTenantId(event.target.value);
                }}
              >
                {me?.memberships.map((membership) => (
                  <option key={membership.tenantId} value={membership.tenantId}>
                    {membership.tenantName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {error ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </section>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1f241f]">业务闭环</h2>
              <span className="text-xs text-[#6a6457]">
                {loading ? "同步中…" : "点击节点下钻"}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              {loopNodes.map((node, index) => (
                <Link
                  key={node.title}
                  href={node.href}
                  className="group rounded-[24px] border border-[#ece5d3] bg-[#fffdf8] p-4 transition hover:border-[#2c6d56] hover:bg-[#f3f8f3]"
                >
                  <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">
                    Step 0{index + 1}
                  </div>
                  <div className="mt-4 text-3xl font-semibold text-[#1f241f]">
                    {node.value}
                  </div>
                  <div className="mt-2 text-base font-medium text-[#1f241f]">
                    {node.title}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[#655f52]">
                    {node.detail}
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1f241f]">通知中心</h2>
              <Link className="text-sm text-[#2c6d56]" href="/hitl">
                进入 HITL
              </Link>
            </div>
            <div className="space-y-3">
              {notifications?.items.slice(0, 5).map((item) => (
                <Link
                  key={item.id}
                  href={item.linkUrl ?? "/hitl"}
                  className="block rounded-2xl border border-[#ece5d3] bg-[#fffdf8] p-4 transition hover:border-[#2c6d56]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-[#1f241f]">{item.title}</div>
                    <span className="text-xs text-[#6a6457]">{formatTime(item.createdAt)}</span>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[#655f52]">
                    {item.body ?? "点击查看详情"}
                  </div>
                </Link>
              ))}
              {!notifications?.items.length ? (
                <div className="rounded-2xl border border-dashed border-[#ddd3bd] bg-[#faf6eb] px-4 py-5 text-sm text-[#6a6457]">
                  暂无通知。
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Link
            href="/crm"
            className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-5 transition hover:border-[#2c6d56]"
          >
            <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">本周询盘</div>
            <div className="mt-4 text-4xl font-semibold text-[#1f241f]">
              {summary?.inquiriesCount ?? 0}
            </div>
            <div className="mt-2 text-sm text-[#655f52]">点击进入 CRM 查看询盘与归因。</div>
          </Link>
          <Link
            href="/design"
            className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-5 transition hover:border-[#2c6d56]"
          >
            <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">内容待发</div>
            <div className="mt-4 text-4xl font-semibold text-[#1f241f]">
              {summary?.pendingPublish ?? 0}
            </div>
            <div className="mt-2 text-sm text-[#655f52]">点击进入设计队列发起或查看发布审批。</div>
          </Link>
          <Link
            href="/hitl"
            className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-5 transition hover:border-[#2c6d56]"
          >
            <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">首响中位耗时</div>
            <div className="mt-4 text-4xl font-semibold text-[#1f241f]">
              {summary?.replyMedianMinutes ?? 0}
              <span className="ml-1 text-lg text-[#6a6457]">分钟</span>
            </div>
            <div className="mt-2 text-sm text-[#655f52]">点击进入审批中心查看待发送首响。</div>
          </Link>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
          <Link
            href="/sites"
            className="rounded-[28px] border border-[#ddd3bd] bg-[#1f241f] p-5 text-[#f7f3ea] transition hover:translate-y-[-2px]"
          >
            <div className="text-xs uppercase tracking-[0.22em] text-[#c9ebe6]">Site Agent</div>
            <div className="mt-4 text-2xl font-semibold">
              {countPending(summary, "site_publish")} 条站点审批
            </div>
            <div className="mt-2 text-sm leading-6 text-[#ddd3bd]">
              站点上线和补全内容确认都从这里落地。
            </div>
          </Link>
          <Link
            href="/design"
            className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-5 transition hover:border-[#2c6d56]"
          >
            <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">Content Agent</div>
            <div className="mt-4 text-2xl font-semibold text-[#1f241f]">
              {countPending(summary, "content_publish")} 条内容审批
            </div>
            <div className="mt-2 text-sm leading-6 text-[#655f52]">
              内容包发布改为先审批，再进入已发状态。
            </div>
          </Link>
          <Link
            href="/hitl"
            className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-5 transition hover:border-[#2c6d56]"
          >
            <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">Reply Agent</div>
            <div className="mt-4 text-2xl font-semibold text-[#1f241f]">
              {countPending(summary, "reply_send")} 条首响审批
            </div>
            <div className="mt-2 text-sm leading-6 text-[#655f52]">
              询盘首响统一经过 HITL 批准后发送。
            </div>
          </Link>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_0.95fr]">
          <div className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1f241f]">待确认队列</h2>
              <Link className="text-sm text-[#2c6d56]" href="/hitl">
                查看全部
              </Link>
            </div>
            <div className="space-y-3">
              {pendingQueue.map((task) => (
                <div key={task.id} className="rounded-2xl border border-[#ece5d3] bg-[#fffdf8] p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <Link href={resolveTaskHref(task)} className="font-medium text-[#1f241f]">
                        {formatTaskType(task.type)}
                      </Link>
                      <div className="mt-1 text-sm text-[#655f52]">
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
                      <Link
                        href={resolveTaskHref(task)}
                        className="rounded-full border border-[#ddd3bd] px-4 py-2 text-sm text-[#1f241f]"
                      >
                        去查看
                      </Link>
                    )}
                  </div>
                </div>
              ))}
              {!pendingQueue.length ? (
                <div className="rounded-2xl border border-dashed border-[#ddd3bd] bg-[#faf6eb] px-4 py-5 text-sm text-[#6a6457]">
                  当前没有待确认任务。
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1f241f]">来源归因</h2>
              <Link className="text-sm text-[#2c6d56]" href="/crm">
                查看 CRM
              </Link>
            </div>
            <div className="space-y-3">
              {summary?.sourceAttribution.slice(0, 6).map((item) => (
                <Link
                  key={`${item.platform}-${item.content}`}
                  href="/crm"
                  className="flex items-center justify-between gap-4 rounded-2xl border border-[#ece5d3] bg-[#fffdf8] p-4 transition hover:border-[#2c6d56]"
                >
                  <div>
                    <div className="font-medium text-[#1f241f]">
                      {item.platform.toUpperCase()} · {item.content}
                    </div>
                    <div className="mt-1 text-sm text-[#655f52]">询盘已归因到具体平台和内容。</div>
                  </div>
                  <div className="text-2xl font-semibold text-[#1f241f]">{item.count}</div>
                </Link>
              ))}
              {!summary?.sourceAttribution.length && leads.length > 0
                ? leads.map((lead) => (
                    <Link
                      key={lead.id}
                      href="/crm"
                      className="block rounded-2xl border border-[#ece5d3] bg-[#fffdf8] p-4 transition hover:border-[#2c6d56]"
                    >
                      <div className="font-medium text-[#1f241f]">{lead.companyName}</div>
                      <div className="mt-1 text-sm text-[#655f52]">
                        {(lead.sourceAttribution.platform ?? "unknown").toUpperCase()} ·{" "}
                        {lead.sourceAttribution.contentTitle ?? "未绑定内容"}
                      </div>
                    </Link>
                  ))
                : null}
              {!summary?.sourceAttribution.length && !leads.length ? (
                <div className="rounded-2xl border border-dashed border-[#ddd3bd] bg-[#faf6eb] px-4 py-5 text-sm text-[#6a6457]">
                  当前范围内还没有内容归因询盘。
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
