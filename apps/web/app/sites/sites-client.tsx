"use client";

import { useEffect, useState } from "react";
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
    <main className="min-h-screen bg-[linear-gradient(180deg,#faf8f1_0%,#efe9d8_100%)] px-4 py-6 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-6 shadow-[0_20px_90px_rgba(50,41,22,0.08)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#2c6d56]">
                Site Management
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#1f241f] md:text-4xl">
                站点管理 + HITL 发布
              </h1>
              <p className="mt-2 text-sm leading-7 text-[#5f594c]">
                草稿不能直接对外。发布必须先建 `HITL` 任务，审批通过后才会开放 `/site/:slug/:locale`。
              </p>
            </div>
            <select
              className="rounded-2xl border border-[#ddd3bd] bg-white px-4 py-2 text-sm"
              value={selectedTenantId}
              onChange={(event) => setSelectedTenantId(event.target.value)}
            >
              {me?.memberships.map((membership) => (
                <option key={membership.tenantId} value={membership.tenantId}>
                  {membership.tenantName}
                </option>
              ))}
            </select>
          </div>
        </section>

        {error ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </section>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-5 shadow-[0_18px_70px_rgba(50,41,22,0.08)]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1f241f]">站点列表</h2>
              <span className="text-xs text-[#6a6457]">{sites.length} 个站点</span>
            </div>
            <div className="space-y-3">
              {sites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  className={`w-full rounded-[24px] border p-4 text-left transition ${
                    site.id === selectedSiteId
                      ? "border-[#1f6a52] bg-[#f1f8f3]"
                      : "border-[#ece5d3] bg-[#fffdf8]"
                  }`}
                  onClick={() => setSelectedSiteId(site.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-base font-semibold text-[#1f241f]">{site.name}</div>
                      <div className="mt-1 text-sm text-[#655f52]">
                        {site.product ?? "Site"} · v{site.versionNumber} · {site.locales.map((item) => item.locale.toUpperCase()).join(" ")}
                      </div>
                    </div>
                    <span className="rounded-full border border-[#ddd3bd] bg-white px-3 py-1 text-xs uppercase text-[#5d584c]">
                      {site.status}
                    </span>
                  </div>
                  <div className="mt-3 text-xs text-[#756f61]">
                    {site.publicUrl ?? site.previewUrl}
                  </div>
                  {site.pendingAutofillCount > 0 ? (
                    <div className="mt-2 text-xs text-[#2c6d56]">
                      {site.pendingAutofillCount} 条自动补全候选待处理
                    </div>
                  ) : null}
                </button>
              ))}
              {!sites.length ? (
                <div className="rounded-3xl border border-dashed border-[#ddd3bd] bg-[#faf6eb] px-4 py-6 text-sm text-[#6a6457]">
                  {loading ? "加载中…" : "当前租户还没有站点。"}
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-5 shadow-[0_18px_70px_rgba(50,41,22,0.08)]">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-[#1f241f]">
                    {selectedSite?.name ?? "站点详情"}
                  </h2>
                  <p className="mt-1 text-sm text-[#655f52]">
                    {selectedSite?.product ?? "-"} · {selectedSite?.market ?? "-"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={selectedSite ? `/sites/${selectedSite.id}/chat` : "#"}
                    className="rounded-full border border-[#ddd3bd] bg-white px-4 py-2 text-sm text-[#1f241f]"
                  >
                    对话编辑
                  </a>
                  {selectedSite?.publicUrl ? (
                    <a
                      href={selectedSite.publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-[#ddd3bd] bg-white px-4 py-2 text-sm text-[#1f241f]"
                    >
                      打开线上页
                    </a>
                  ) : null}
                </div>
              </div>

              {selectedSite ? (
                <>
                  <div className="mt-5 flex flex-wrap gap-2">
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
                      className="rounded-full border border-[#ddd3bd] bg-white px-4 py-2 text-sm text-[#1f241f] disabled:opacity-50"
                      disabled={!canEdit(currentMembership?.role) || busyKey === "offline"}
                      onClick={() => void postJson(`/api/sites/${selectedSite.id}/status`, { status: "offline" }, "offline")}
                    >
                      立即下线
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-[#ddd3bd] bg-white px-4 py-2 text-sm text-[#1f241f] disabled:opacity-50"
                      disabled={!canEdit(currentMembership?.role) || busyKey === "autofill-generate"}
                      onClick={() => void postJson(`/api/sites/${selectedSite.id}/autofill`, { action: "generate" }, "autofill-generate")}
                    >
                      {busyKey === "autofill-generate" ? "生成中…" : "生成自动补全候选"}
                    </button>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-[#ece5d3] bg-[#fffdf8] p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-[#6a6457]">状态</div>
                      <div className="mt-2 text-lg font-semibold text-[#1f241f]">
                        {selectedSite.status}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[#ece5d3] bg-[#fffdf8] p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-[#6a6457]">版本</div>
                      <div className="mt-2 text-lg font-semibold text-[#1f241f]">
                        v{selectedSite.versionNumber}
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </section>

            <section className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-5 shadow-[0_18px_70px_rgba(50,41,22,0.08)]">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#1f241f]">审批队列</h2>
                <span className="text-xs text-[#6a6457]">{relatedHitl.length} 条</span>
              </div>
              <div className="mt-4 space-y-3">
                {relatedHitl.map((task) => (
                  <div key={task.id} className="rounded-2xl border border-[#ece5d3] bg-[#fffdf8] p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="font-medium text-[#1f241f]">{formatTaskType(task.type)}</div>
                        <div className="mt-1 text-xs text-[#6a6457]">
                          {task.payload.mode === "autofill_candidate" ? "自动补全确认上线" : "站点上线"} · {formatTime(task.createdAt)}
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
                        <span className="rounded-full border border-[#ddd3bd] px-3 py-1 text-xs text-[#6a6457]">
                          等待管理员
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {!relatedHitl.length ? (
                  <div className="rounded-2xl border border-dashed border-[#ddd3bd] bg-[#faf6eb] px-4 py-5 text-sm text-[#6a6457]">
                    当前站点没有待审批的发布任务。
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-5 shadow-[0_18px_70px_rgba(50,41,22,0.08)]">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#1f241f]">版本回滚</h2>
                <span className="text-xs text-[#6a6457]">{detail?.versionHistory.length ?? 0} 个版本</span>
              </div>
              <div className="mt-4 space-y-3">
                {detail?.versionHistory.map((version) => (
                  <div key={version.id} className="flex items-center justify-between gap-4 rounded-2xl border border-[#ece5d3] bg-[#fffdf8] p-4">
                    <div>
                      <div className="font-medium text-[#1f241f]">v{version.versionNumber}</div>
                      <div className="mt-1 text-xs text-[#6a6457]">
                        {version.note ?? "无备注"} · {formatTime(version.createdAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-[#ddd3bd] bg-white px-4 py-2 text-sm text-[#1f241f] disabled:opacity-50"
                      disabled={!selectedSiteId || !canEdit(currentMembership?.role) || busyKey === `rollback-${version.id}`}
                      onClick={() => void postJson(`/api/sites/${selectedSiteId}/rollback`, { versionId: version.id }, `rollback-${version.id}`)}
                    >
                      {busyKey === `rollback-${version.id}` ? "回滚中…" : "回滚到此版本"}
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-5 shadow-[0_18px_70px_rgba(50,41,22,0.08)]">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#1f241f]">AI 自动补全候选</h2>
                <span className="text-xs text-[#6a6457]">
                  {detail?.version?.autofillCandidates.length ?? 0} 条
                </span>
              </div>
              <div className="mt-4 space-y-4">
                {detail?.version?.autofillCandidates.map((candidate) => (
                  <div key={candidate.id} className="rounded-[24px] border border-[#ece5d3] bg-[#fffdf8] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-[#dce7e1] bg-[#f1f8f3] px-3 py-1 text-xs text-[#2c6d56]">
                        {candidate.kind}
                      </span>
                      <span className="rounded-full border border-[#ddd3bd] px-3 py-1 text-xs text-[#6a6457]">
                        {candidate.status}
                      </span>
                    </div>
                    <input
                      className="mt-4 w-full rounded-2xl border border-[#ddd3bd] px-4 py-3 text-sm outline-none"
                      value={candidate.title}
                      readOnly
                    />
                    <div className="mt-3 rounded-2xl bg-[#faf6eb] px-4 py-3 text-sm leading-7 text-[#5d584c]">
                      {candidate.summary}
                    </div>
                    <textarea
                      className="mt-3 min-h-32 w-full rounded-2xl border border-[#ddd3bd] px-4 py-3 text-sm leading-7 outline-none"
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
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      {candidate.sourceCitations.map((citation) => (
                        <span key={citation} className="rounded-full border border-[#dce7e1] bg-[#f1f8f3] px-3 py-1 text-xs text-[#2c6d56]">
                          {citation}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-full bg-[#1f6a52] px-4 py-2 text-sm text-white disabled:bg-[#8cae9f]"
                        disabled={!canEdit(currentMembership?.role) || busyKey === `confirm-${candidate.id}`}
                        onClick={() => void postJson(`/api/sites/${selectedSiteId}/autofill`, { action: "confirm", candidateId: candidate.id }, `confirm-${candidate.id}`)}
                      >
                        {busyKey === `confirm-${candidate.id}` ? "提交中…" : "确认上线(HITL)"}
                      </button>
                    </div>
                  </div>
                ))}
                {!detail?.version?.autofillCandidates.length ? (
                  <div className="rounded-2xl border border-dashed border-[#ddd3bd] bg-[#faf6eb] px-4 py-5 text-sm text-[#6a6457]">
                    还没有自动补全候选，先点击“生成自动补全候选”。
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
