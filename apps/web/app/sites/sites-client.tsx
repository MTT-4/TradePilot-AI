"use client";

import { useEffect, useState } from "react";
import { autofillKindLabel, statusLabel } from "@/app/_lib/labels";
import { HitlAction } from "@/app/_components/hitl-action";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";
import { formatTaskType } from "@/app/_components/hitl-meta";

type SiteListItem = {
  id: string;
  name: string;
  slug: string;
  market: string | null;
  product: string | null;
  defaultLocale: string;
  status: "draft" | "published" | "offline";
  versionNumber: number;
  localeCount: number;
  locales: Array<{
    id: string;
    locale: string;
    direction: "ltr" | "rtl";
    urlPath: string;
    publishStatus: "pending" | "published" | "failed" | "offline";
  }>;
  publicUrl: string | null;
  previewUrl: string;
  badges: {
    seo: boolean;
    geo: boolean;
    responsive: boolean;
    ogVk: boolean;
    trackingLinks: boolean;
  };
  pendingAutofillCount: number;
};

type SitesResponse = {
  items: SiteListItem[];
};

type SiteDetail = {
  project: {
    id: string;
    name: string;
    slug: string;
    market: string | null;
    product: string | null;
    style: string | null;
    cta: string | null;
    defaultLocale: string;
    status: "draft" | "published" | "offline";
  };
  locales: Array<{
    id: string;
    locale: string;
    direction: "ltr" | "rtl";
    urlPath: string;
    publishStatus: "pending" | "published" | "failed" | "offline";
    translatedContent: {
      headline: string;
      subheadline: string;
      sections: Array<{ id: string; heading: string; body: string }>;
    };
  }>;
  version: {
    id: string;
    versionNumber: number;
    previewChecks: Array<{
      key: string;
      label: string;
      status: "pass" | "warn";
      detail: string;
    }>;
    autofillCandidates: Array<{
      id: string;
      kind: "product" | "certification" | "blog";
      title: string;
      summary: string;
      body: string;
      sourceCitations: string[];
      status: "draft" | "pending_publish" | "applied";
      updatedAt: string;
    }>;
  } | null;
  versionHistory: Array<{
    id: string;
    versionNumber: number;
    note: string | null;
    createdAt: string;
  }>;
};

type HitlTask = {
  id: string;
  type: string;
  status: string;
  entityType: string;
  entityId: string;
  payload: {
    siteId?: string;
    mode?: "site_publish" | "autofill_candidate";
    candidateId?: string | null;
  };
  createdAt: string;
};

type HitlResponse = {
  items: HitlTask[];
};

function canEdit(role: string | undefined) {
  return role === "owner" || role === "admin" || role === "operator";
}

function canApprove(role: string | undefined) {
  return role === "owner" || role === "admin";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function SitesClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [sites, setSites] = useState<SiteListItem[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [detail, setDetail] = useState<SiteDetail | null>(null);
  const [hitl, setHitl] = useState<HitlTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentMembership =
    me?.memberships.find((item) => item.tenantId === selectedTenantId) ?? null;

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
        }
      }
    }

    void loadMe();

    return () => {
      active = false;
    };
  }, []);

  async function loadSitesAndHitl(tenantId: string, role?: string) {
    const [sitesRes, hitlRes] = await Promise.all([
      fetch("/api/sites", {
        headers: {
          "X-Tenant-Id": tenantId,
        },
      }),
      fetch("/api/hitl?status=pending", {
        headers: {
          "X-Tenant-Id": tenantId,
        },
      }),
    ]);

    if (!sitesRes.ok) {
      const payload = await sitesRes.json().catch(() => null);
      throw new Error(payload?.error?.message ?? "加载站点列表失败。");
    }

    const sitesPayload = (await sitesRes.json()) as SitesResponse;
    setSites(sitesPayload.items);
    setSelectedSiteId((current) => current || sitesPayload.items[0]?.id || "");

    if (role === "viewer" || role === "sales") {
      setHitl([]);
      return;
    }

    if (!hitlRes.ok) {
      const payload = await hitlRes.json().catch(() => null);
      throw new Error(payload?.error?.message ?? "加载审批列表失败。");
    }

    const hitlPayload = (await hitlRes.json()) as HitlResponse;
    setHitl(hitlPayload.items);
  }

  useEffect(() => {
    if (!selectedTenantId) {
      return;
    }

    let active = true;

    const role =
      me?.memberships.find((item) => item.tenantId === selectedTenantId)?.role;
    const timer = window.setTimeout(() => {
      void loadSitesAndHitl(selectedTenantId, role)
        .catch((loadError) => {
          if (active) {
            setError(loadError instanceof Error ? loadError.message : "加载站点列表失败。");
          }
        })
        .finally(() => {
          if (active) {
            setLoading(false);
          }
        });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [me?.memberships, selectedTenantId]);

  useEffect(() => {
    if (!selectedTenantId || !selectedSiteId) {
      return;
    }

    let active = true;

    async function loadDetail() {
      const response = await fetch(`/api/sites/${selectedSiteId}`, {
        headers: {
          "X-Tenant-Id": selectedTenantId,
        },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "加载站点详情失败。");
      }

      const payload = (await response.json()) as SiteDetail;

      if (active) {
        setDetail(payload);
      }
    }

    void loadDetail().catch((loadError) => {
      if (active) {
        setError(loadError instanceof Error ? loadError.message : "加载站点详情失败。");
      }
    });

    return () => {
      active = false;
    };
  }, [selectedTenantId, selectedSiteId]);

  async function refreshCurrent() {
    if (!selectedTenantId) {
      return;
    }

    await loadSitesAndHitl(selectedTenantId, currentMembership?.role);

    if (selectedSiteId) {
      const response = await fetch(`/api/sites/${selectedSiteId}`, {
        headers: {
          "X-Tenant-Id": selectedTenantId,
        },
      });

      if (response.ok) {
        setDetail((await response.json()) as SiteDetail);
      }
    }
  }

  async function postJson(url: string, body: unknown, busy: string) {
    if (!selectedTenantId) {
      return null;
    }

    setBusyKey(busy);
    setError(null);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "操作失败。");
      }

      const payload = await response.json().catch(() => null);
      await refreshCurrent();
      return payload;
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "操作失败。");
      return null;
    } finally {
      setBusyKey(null);
    }
  }

  const selectedSite = sites.find((item) => item.id === selectedSiteId) ?? null;
  const relatedHitl = hitl.filter(
    (item) =>
      item.payload.siteId === selectedSiteId ||
      item.entityId === selectedSiteId ||
      item.entityId.startsWith(`${selectedSiteId}:`),
  );

  return (
    <>
      <div className="head-row">
        <div>
          <div className="eyebrow">站点管理</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            站点 · 版本 · 上下线
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            草稿不能直接对外，发布需经 HITL 审批通过后才会开放公开页。
          </div>
        </div>
        {me && me.memberships.length > 0 ? (
          <select
            className="btn ghost sm"
            value={selectedTenantId}
            onChange={(event) => setSelectedTenantId(event.target.value)}
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

      <div className="split" style={{ gridTemplateColumns: "0.9fr 1.1fr" }}>
        <div className="card" style={{ padding: "8px 20px" }}>
          {sites.map((site) => (
            <div
              className="row-card"
              key={site.id}
              style={{ cursor: "pointer" }}
              onClick={() => setSelectedSiteId(site.id)}
            >
              <div className="grow">
                <div className="nm">
                  {site.name}
                  <span>
                    {site.locales.map((item) => item.locale.toUpperCase()).join(" ")} · v
                    {site.versionNumber}
                  </span>
                </div>
                <div className="sub" style={{ marginTop: 3 }}>
                  {site.publicUrl ?? site.previewUrl}
                </div>
                {site.pendingAutofillCount > 0 ? (
                  <div className="sub" style={{ marginTop: 2, color: "var(--teal)" }}>
                    {site.pendingAutofillCount} 条自动补全候选待处理
                  </div>
                ) : null}
              </div>
              <span className={`st ${site.status}`}>{statusLabel(site.status)}</span>
              {site.id === selectedSiteId ? <span className="badge good">当前</span> : null}
            </div>
          ))}
          {!sites.length ? (
            <div className="empty" style={{ padding: "32px 12px" }}>
              <div className="t">{loading ? "加载中…" : "当前租户还没有站点"}</div>
              <div className="s">在「AI 建站」里对话生成第一个站点。</div>
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card" style={{ padding: "18px 20px" }}>
            <div className="head-row" style={{ marginBottom: 10 }}>
              <div>
                <div className="eyebrow">站点详情</div>
                <h3 style={{ fontSize: 16, marginTop: 3 }}>{selectedSite?.name ?? "未选择站点"}</h3>
                <div className="sub" style={{ marginTop: 2 }}>
                  {selectedSite?.product ?? "-"} · {selectedSite?.market ?? "-"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {selectedSite ? (
                  <a className="btn ghost sm" href={`/sites/${selectedSite.id}/chat`}>
                    对话编辑
                  </a>
                ) : null}
                {selectedSite?.publicUrl ? (
                  <a className="btn ghost sm" href={selectedSite.publicUrl} target="_blank" rel="noreferrer">
                    打开线上页
                  </a>
                ) : null}
              </div>
            </div>

            {selectedSite ? (
              <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                  <HitlAction
                    tenantId={selectedTenantId}
                    endpoint={`/api/sites/${selectedSite.id}/publish-request`}
                    idleLabel="发起上线审批"
                    busyLabel="提交中…"
                    disabled={!canEdit(currentMembership?.role)}
                    onError={(message) => setError(message || null)}
                    onSuccess={() => refreshCurrent()}
                  />
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={!canEdit(currentMembership?.role) || busyKey === "offline"}
                    onClick={() => void postJson(`/api/sites/${selectedSite.id}/status`, { status: "offline" }, "offline")}
                  >
                    立即下线
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={!canEdit(currentMembership?.role) || busyKey === "autofill-generate"}
                    onClick={() => void postJson(`/api/sites/${selectedSite.id}/autofill`, { action: "generate" }, "autofill-generate")}
                  >
                    {busyKey === "autofill-generate" ? "生成中…" : "生成自动补全候选"}
                  </button>
                </div>

                <div className="stat-strip" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 0 }}>
                  <div className="stat">
                    <div className="v" style={{ fontSize: 16 }}>{statusLabel(selectedSite.status)}</div>
                    <div className="l">状态</div>
                  </div>
                  <div className="stat">
                    <div className="v">v{selectedSite.versionNumber}</div>
                    <div className="l">当前版本</div>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <div className="card" style={{ padding: "18px 20px" }}>
            <div className="head-row" style={{ marginBottom: 8 }}>
              <h3 style={{ fontSize: 15 }}>审批队列</h3>
              <span className="badge manual">{relatedHitl.length} 条</span>
            </div>
            {relatedHitl.map((task) => (
              <div className="hitl-item" key={task.id}>
                <div className="ic teal">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="4" width="18" height="14" rx="2" />
                  </svg>
                </div>
                <div className="grow">
                  <div className="t">{formatTaskType(task.type)}</div>
                  <div className="m">
                    {task.payload.mode === "autofill_candidate" ? "自动补全确认上线" : "站点上线"} ·{" "}
                    {formatTime(task.createdAt)}
                  </div>
                </div>
                {canApprove(currentMembership?.role) ? (
                  <HitlAction
                    tenantId={selectedTenantId}
                    endpoint={`/api/hitl/${task.id}/approve`}
                    idleLabel="批准"
                    busyLabel="审批中…"
                    onError={(message) => setError(message || null)}
                    onSuccess={() => refreshCurrent()}
                  />
                ) : (
                  <span className="badge line">等待管理员</span>
                )}
              </div>
            ))}
            {!relatedHitl.length ? (
              <div className="sub" style={{ padding: "10px 0" }}>当前站点没有待审批的发布任务。</div>
            ) : null}
          </div>

          <div className="card" style={{ padding: "18px 20px" }}>
            <div className="head-row" style={{ marginBottom: 8 }}>
              <h3 style={{ fontSize: 15 }}>版本回滚</h3>
              <span className="badge line">{detail?.versionHistory.length ?? 0} 个版本</span>
            </div>
            {detail?.versionHistory.map((version) => (
              <div className="row-card" key={version.id}>
                <div className="grow">
                  <div className="nm">v{version.versionNumber}</div>
                  <div className="sub" style={{ marginTop: 2 }}>
                    {version.note ?? "无备注"} · {formatTime(version.createdAt)}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={!selectedSiteId || !canEdit(currentMembership?.role) || busyKey === `rollback-${version.id}`}
                  onClick={() => void postJson(`/api/sites/${selectedSiteId}/rollback`, { versionId: version.id }, `rollback-${version.id}`)}
                >
                  {busyKey === `rollback-${version.id}` ? "回滚中…" : "回滚到此版本"}
                </button>
              </div>
            ))}
          </div>

          <div className="card fixes">
            <div className="head-row" style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth={2} style={{ width: 18, height: 18 }}>
                  <path d="M12 3l2.4 5.4L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.6-.6z" />
                </svg>
                <h3 style={{ fontSize: 15 }}>AI 按知识库自动补全内容</h3>
              </div>
              <span className="badge manual">{detail?.version?.autofillCandidates.length ?? 0} 条</span>
            </div>
            <div className="sub" style={{ marginBottom: 8 }}>
              新产品 / 认证 / 博客由 AI 依知识库生成草稿，每条要你确认或调整后上线。
            </div>
            {detail?.version?.autofillCandidates.map((candidate) => (
              <div
                key={candidate.id}
                style={{ borderTop: "1px solid var(--line-2)", paddingTop: 12, marginTop: 12 }}
              >
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 8 }}>
                  <span className="badge line">{autofillKindLabel(candidate.kind)}</span>
                  <span className={`st ${candidate.status === "applied" ? "published" : "pending"}`}>
                    {statusLabel(candidate.status)}
                  </span>
                </div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{candidate.title}</div>
                <div className="inq-body" style={{ marginTop: 8 }}>{candidate.summary}</div>
                <textarea
                  defaultValue={candidate.body}
                  onBlur={(event) => {
                    if (event.target.value !== candidate.body) {
                      void postJson(
                        `/api/sites/${selectedSiteId}/autofill`,
                        {
                          action: "update",
                          candidateId: candidate.id,
                          body: event.target.value,
                        },
                        `candidate-${candidate.id}`,
                      );
                    }
                  }}
                  style={{
                    width: "100%",
                    minHeight: 96,
                    marginTop: 10,
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    padding: "10px 13px",
                    fontFamily: "inherit",
                    fontSize: 13,
                    lineHeight: 1.6,
                    background: "var(--surface-2)",
                  }}
                />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {candidate.sourceCitations.map((citation) => (
                    <span className="badge line" key={citation}>
                      {citation}
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn primary sm"
                    disabled={!canEdit(currentMembership?.role) || busyKey === `confirm-${candidate.id}`}
                    onClick={() => void postJson(`/api/sites/${selectedSiteId}/autofill`, { action: "confirm", candidateId: candidate.id }, `confirm-${candidate.id}`)}
                  >
                    {busyKey === `confirm-${candidate.id}` ? "提交中…" : "确认上线(HITL)"}
                  </button>
                </div>
              </div>
            ))}
            {!detail?.version?.autofillCandidates.length ? (
              <div className="sub" style={{ padding: "10px 0" }}>
                还没有自动补全候选，先点击「生成自动补全候选」。
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
