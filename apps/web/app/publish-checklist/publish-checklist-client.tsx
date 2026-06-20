"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { statusLabel } from "@/app/_lib/labels";
import {
  canApproveTask,
  formatTaskDetail,
  formatTaskType,
  formatTime,
  resolveTaskHref,
} from "@/app/_components/hitl-meta";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";

type SiteListItem = {
  id: string;
  name: string;
  slug: string;
  market: string | null;
  product: string | null;
  defaultLocale: string;
  status: "draft" | "published" | "offline";
  localeCount: number;
  publicUrl: string | null;
  previewUrl: string;
  pendingAutofillCount: number;
  locales: Array<{
    id: string;
    locale: string;
    publishStatus: "pending" | "published" | "failed" | "offline";
  }>;
};

type SitesResponse = {
  items: SiteListItem[];
};

type DesignItem = {
  id: string;
  title: string;
  platform: string;
  mediaType: string;
  publishStatus: string;
  contentPackId: string;
  contentPackTitle: string;
  publishRequestPending: boolean;
  editUrl: string;
};

type DesignResponse = {
  items: DesignItem[];
};

type HitlTask = {
  id: string;
  type: string;
  status: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type HitlResponse = {
  items: HitlTask[];
};

async function fetchChecklist(tenantId: string) {
  const headers = {
    "X-Tenant-Id": tenantId,
  };
  const [sitesRes, designRes, hitlRes] = await Promise.all([
    fetch("/api/sites", { headers }),
    fetch("/api/design/queue", { headers }),
    fetch("/api/hitl?status=pending", { headers }),
  ]);

  if (!sitesRes.ok || !designRes.ok || !hitlRes.ok) {
    const failingResponse = [sitesRes, designRes, hitlRes].find((response) => !response.ok);
    const payload = await failingResponse?.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载发布清单失败。");
  }

  return {
    sites: (await sitesRes.json()) as SitesResponse,
    design: (await designRes.json()) as DesignResponse,
    hitl: (await hitlRes.json()) as HitlResponse,
  };
}

function platformLabel(platform: string) {
  return platform.toUpperCase().replaceAll("_", " ");
}

export function PublishChecklistClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [sites, setSites] = useState<SiteListItem[]>([]);
  const [designItems, setDesignItems] = useState<DesignItem[]>([]);
  const [tasks, setTasks] = useState<HitlTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    void fetchChecklist(selectedTenantId)
      .then((payload) => {
        if (!active) {
          return;
        }

        setError(null);
        setSites(payload.sites.items);
        setDesignItems(payload.design.items);
        setTasks(payload.hitl.items);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载发布清单失败。");
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
  }, [selectedTenantId]);

  const currentRole =
    me?.memberships.find((membership) => membership.tenantId === selectedTenantId)?.role;

  const siteTaskIds = useMemo(() => {
    const pending = new Set<string>();
    for (const task of tasks) {
      if (task.type !== "site_publish") {
        continue;
      }
      const siteId =
        typeof task.payload.siteId === "string" ? task.payload.siteId : task.entityId;
      if (siteId) {
        pending.add(siteId);
      }
    }
    return pending;
  }, [tasks]);

  const contentTaskIds = useMemo(() => {
    const pending = new Set<string>();
    for (const task of tasks) {
      if (task.type === "content_publish") {
        pending.add(task.entityId);
      }
    }
    return pending;
  }, [tasks]);

  const siteWaiting = sites.filter(
    (site) =>
      site.status !== "published" ||
      site.locales.some((locale) => locale.publishStatus !== "published") ||
      site.pendingAutofillCount > 0 ||
      siteTaskIds.has(site.id),
  );
  const contentWaiting = designItems.filter(
    (item) =>
      item.publishStatus !== "published" ||
      item.publishRequestPending ||
      contentTaskIds.has(item.id),
  );
  const pendingTasks = tasks.filter(
    (task) => task.type === "site_publish" || task.type === "content_publish",
  );

  return (
    <>
      <div className="head-row">
        <div>
          <div className="eyebrow">上线前检查</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            发布清单
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            把站点上线、内容发布、人工审批三条线放到同一个面里，减少来回切页确认。
          </div>
        </div>
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

      <div className="rules">
        <div className="ric">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </div>
        <div>
          <div className="rt">发布前检查项集中展示</div>
          <div className="rs">站点是否具备上线条件、内容是否已发起审批、审批是否卡在待处理，一次看清。</div>
        </div>
        <span className="upd">{loading ? "整理中…" : `${pendingTasks.length} 项审批`}</span>
      </div>

      <div className="stat-strip" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat">
          <div className="v">{siteWaiting.length}</div>
          <div className="l">待上线站点</div>
        </div>
        <div className="stat">
          <div className="v">{contentWaiting.length}</div>
          <div className="l">待发布内容</div>
        </div>
        <div className="stat">
          <div className="v">{pendingTasks.length}</div>
          <div className="l">待人工审批</div>
        </div>
      </div>

      <div className="card set-block" style={{ marginBottom: 16 }}>
        <div className="head-row" style={{ marginBottom: 10 }}>
          <div>
            <h3>站点上线前</h3>
            <div className="sub">检查 locale 发布状态、自动补全待确认项，以及是否已经发起上线审批。</div>
          </div>
          <Link className="btn ghost sm" href="/sites">
            去站点页
          </Link>
        </div>
        {siteWaiting.map((site) => (
          <div className="row-card" key={site.id}>
            <div className="afi">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9h18" />
              </svg>
            </div>
            <div className="grow">
              <div className="nm">
                {site.name}
                <span>{site.market ?? site.defaultLocale.toUpperCase()}</span>
              </div>
              <div className="sub" style={{ marginTop: 4 }}>
                {site.product ?? "未填写产品线"} · {site.localeCount} 个语种 ·
                {site.pendingAutofillCount > 0
                  ? ` ${site.pendingAutofillCount} 条自动补全待确认`
                  : " 无额外自动补全阻塞"}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <span className={`st ${site.status === "published" ? "published" : "pending"}`}>
                  {statusLabel(site.status)}
                </span>
                {site.locales.some((locale) => locale.publishStatus !== "published") ? (
                  <span className="badge manual">存在未发布 locale</span>
                ) : null}
                {siteTaskIds.has(site.id) ? <span className="badge local">上线审批中</span> : null}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {site.publicUrl ? (
                <Link className="btn ghost sm" href={site.publicUrl}>
                  查看线上页
                </Link>
              ) : null}
              <Link className="btn ghost sm" href={site.previewUrl}>
                打开站点工作区
              </Link>
            </div>
          </div>
        ))}
        {!siteWaiting.length ? (
          <div className="empty">
            <div className="t">{loading ? "加载中…" : "当前没有待上线站点"}</div>
            <div className="s">站点发布链路目前是清空状态。</div>
          </div>
        ) : null}
      </div>

      <div className="card set-block" style={{ marginBottom: 16 }}>
        <div className="head-row" style={{ marginBottom: 10 }}>
          <div>
            <h3>内容发布前</h3>
            <div className="sub">聚合各平台内容的待发布状态、审批状态与回到内容包编辑器的入口。</div>
          </div>
          <Link className="btn ghost sm" href="/design">
            去内容页
          </Link>
        </div>
        {contentWaiting.map((item) => (
          <div className="row-card" key={item.id}>
            <div className="afi">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 3l2.4 5.4L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.6-.6z" />
              </svg>
            </div>
            <div className="grow">
              <div className="nm">
                {item.title}
                <span>{platformLabel(item.platform)} · {item.mediaType}</span>
              </div>
              <div className="sub" style={{ marginTop: 4 }}>
                {item.contentPackTitle}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <span className={`st ${item.publishStatus}`}>{statusLabel(item.publishStatus)}</span>
                {item.publishRequestPending || contentTaskIds.has(item.id) ? (
                  <span className="badge local">发布审批中</span>
                ) : null}
              </div>
            </div>
            <Link className="btn ghost sm" href={item.editUrl}>
              打开内容包
            </Link>
          </div>
        ))}
        {!contentWaiting.length ? (
          <div className="empty">
            <div className="t">{loading ? "加载中…" : "当前没有待发布内容"}</div>
            <div className="s">内容发布链路目前是清空状态。</div>
          </div>
        ) : null}
      </div>

      <div className="card set-block">
        <div className="head-row" style={{ marginBottom: 10 }}>
          <div>
            <h3>审批池</h3>
            <div className="sub">这里聚合站点与内容的待审批任务，并标明当前角色是否有批准权限。</div>
          </div>
          <Link className="btn ghost sm" href="/hitl">
            打开审批中心
          </Link>
        </div>
        {pendingTasks.map((task) => (
          <div className="row-card" key={task.id}>
            <div className="afi">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z" />
                <path d="M9.5 12.5 11 14l4-4" />
              </svg>
            </div>
            <div className="grow">
              <div className="nm">
                {formatTaskType(task.type)}
                <span>{formatTime(task.createdAt)}</span>
              </div>
              <div className="sub" style={{ marginTop: 4 }}>
                {formatTaskDetail(task)}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <span className="badge manual">{task.entityType}</span>
                <span className={`st ${canApproveTask(currentRole, task.type) ? "approved" : "pending"}`}>
                  {canApproveTask(currentRole, task.type) ? "当前可审批" : "当前仅可查看"}
                </span>
              </div>
            </div>
            <Link className="btn ghost sm" href={resolveTaskHref(task)}>
              打开事项
            </Link>
          </div>
        ))}
        {!pendingTasks.length ? (
          <div className="empty">
            <div className="t">{loading ? "加载中…" : "当前没有待审批发布事项"}</div>
            <div className="s">上线与发布链路都处于清空状态。</div>
          </div>
        ) : null}
      </div>
    </>
  );
}
