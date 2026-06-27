"use client";

import { useEffect, useState } from "react";
import { autofillKindLabel, statusLabel } from "@/app/_lib/labels";
import { HitlAction } from "@/app/_components/hitl-action";
import {
  normalizeSiteLocalesInput,
  siteLocaleHelpText,
  siteLocalePlaceholder,
} from "@/lib/site-locales";
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

type AssetResponse = {
  items: Array<{
    id: string;
    fileName: string;
    kind: string;
  }>;
};

type KnowledgeDocumentsResponse = {
  items: Array<{
    id: string;
    title: string;
    status: string;
    sensitivity: string;
  }>;
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

async function fetchAssets(tenantId: string) {
  const response = await fetch("/api/assets", {
    headers: {
      "X-Tenant-Id": tenantId,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载素材失败。");
  }

  return (await response.json()) as AssetResponse;
}

async function uploadAsset(tenantId: string, file: File) {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("kind", "reference");

  const response = await fetch("/api/assets", {
    method: "POST",
    headers: {
      "X-Tenant-Id": tenantId,
    },
    body: formData,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "上传素材失败。");
  }
}

async function fetchKnowledgeDocuments(tenantId: string) {
  const response = await fetch("/api/kb/documents", {
    headers: {
      "X-Tenant-Id": tenantId,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载知识文档失败。");
  }

  return (await response.json()) as KnowledgeDocumentsResponse;
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
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [assets, setAssets] = useState<AssetResponse["items"]>([]);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<
    KnowledgeDocumentsResponse["items"]
  >([]);
  const [detailTab, setDetailTab] = useState<"approvals" | "versions" | "autofill">(
    "approvals",
  );
  const [createForm, setCreateForm] = useState({
    market: "",
    product: "",
    locales: "zh,en",
    style: "conversion focused",
    cta: "Request a quote",
    assetIds: [] as string[],
    knowledgeDocumentIds: [] as string[],
    referenceBrandKit: true,
  });

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
    if (!selectedTenantId) {
      return;
    }

    let active = true;

    void Promise.all([
      fetchAssets(selectedTenantId),
      fetchKnowledgeDocuments(selectedTenantId),
    ])
      .then(([assetsPayload, documentsPayload]) => {
        if (!active) {
          return;
        }

        setAssets(assetsPayload.items);
        setKnowledgeDocuments(documentsPayload.items);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载引用数据失败。");
        }
      });

    return () => {
      active = false;
    };
  }, [selectedTenantId]);

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

  async function createSite() {
    if (!selectedTenantId) {
      return;
    }
    const locales = normalizeSiteLocalesInput(createForm.locales.split(","));
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/sites/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify({
          brief: {
            market: createForm.market.trim(),
            product: createForm.product.trim(),
            locales: locales.length > 0 ? locales : ["en"],
            style: createForm.style.trim() || "conversion focused",
            cta: createForm.cta.trim() || "Request a quote",
          },
          assetIds: createForm.assetIds,
          knowledgeDocumentIds: createForm.knowledgeDocumentIds,
          referenceBrandKit: createForm.referenceBrandKit,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "新建站点失败。");
      }
      setShowCreate(false);
      await loadSitesAndHitl(selectedTenantId, currentMembership?.role);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "新建站点失败。");
    } finally {
      setCreating(false);
    }
  }

  async function handleAssetUpload(file: File | null) {
    if (!selectedTenantId || !file) {
      return;
    }

    setUploadingAsset(true);
    setError(null);

    try {
      await uploadAsset(selectedTenantId, file);
      const payload = await fetchAssets(selectedTenantId);
      setAssets(payload.items);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传素材失败。");
    } finally {
      setUploadingAsset(false);
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn primary sm"
            disabled={!canEdit(currentMembership?.role)}
            onClick={() => setShowCreate((open) => !open)}
          >
            {showCreate ? "收起" : "新建站点"}
          </button>
          {me && me.memberships.length > 0 ? (
            <select
              className="btn ghost sm"
              value={selectedTenantId}
              onChange={(event) => {
                setCreateForm((current) => ({
                  ...current,
                  assetIds: [],
                  knowledgeDocumentIds: [],
                }));
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

      {showCreate ? (
        <div className="card" style={{ padding: "18px 20px", marginBottom: 18 }}>
          <div className="head-row" style={{ marginBottom: 10 }}>
            <h3 style={{ fontSize: 15 }}>对话生成新站点</h3>
          </div>
          <div className="grid-2" style={{ gap: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>目标市场</label>
              <input
                value={createForm.market}
                onChange={(e) => setCreateForm({ ...createForm, market: e.target.value })}
                placeholder="例如：中东 / MENA"
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>主推产品</label>
              <input
                value={createForm.product}
                onChange={(e) => setCreateForm({ ...createForm, product: e.target.value })}
                placeholder="例如：空压机 XV-75"
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>语种（逗号分隔，可选 {siteLocaleHelpText}）</label>
              <input
                value={createForm.locales}
                onChange={(e) => setCreateForm({ ...createForm, locales: e.target.value })}
                placeholder={siteLocalePlaceholder}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>主行动号召（CTA）</label>
              <input
                value={createForm.cta}
                onChange={(e) => setCreateForm({ ...createForm, cta: e.target.value })}
                placeholder="Request a quote"
              />
            </div>
          </div>
          <div className="pv-grid" style={{ marginTop: 12 }}>
            <div className="pv-card">
              <div className="head-row" style={{ marginBottom: 8 }}>
                <b>引用素材</b>
                <label className="btn ghost sm" style={{ cursor: "pointer" }}>
                  {uploadingAsset ? "上传中…" : "上传素材"}
                  <input
                    type="file"
                    style={{ display: "none" }}
                    disabled={uploadingAsset}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      void handleAssetUpload(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              <div className="pv-stack">
                {assets.length ? (
                  assets.slice(0, 8).map((asset) => (
                    <label key={asset.id} className="row-card" style={{ padding: "10px 12px" }}>
                      <input
                        type="checkbox"
                        checked={createForm.assetIds.includes(asset.id)}
                        onChange={(event) =>
                          setCreateForm((current) => ({
                            ...current,
                            assetIds: event.target.checked
                              ? [...current.assetIds, asset.id]
                              : current.assetIds.filter((id) => id !== asset.id),
                          }))
                        }
                      />
                      <div className="grow" style={{ marginLeft: 10 }}>
                        <div className="nm">
                          {asset.fileName}
                          <span>{asset.kind}</span>
                        </div>
                      </div>
                    </label>
                  ))
                ) : (
                  <div className="sub">可上传产品图、参考站点图、包装图等素材。</div>
                )}
              </div>
            </div>
            <div className="pv-card">
              <div className="head-row" style={{ marginBottom: 8 }}>
                <b>公开知识与品牌包</b>
                <label className="badge line" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={createForm.referenceBrandKit}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        referenceBrandKit: event.target.checked,
                      }))
                    }
                  />
                  引用品牌包
                </label>
              </div>
              <div className="pv-stack">
                {knowledgeDocuments.filter((item) => item.status === "ready").slice(0, 8).map((item) => (
                  <label key={item.id} className="row-card" style={{ padding: "10px 12px" }}>
                    <input
                      type="checkbox"
                      checked={createForm.knowledgeDocumentIds.includes(item.id)}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          knowledgeDocumentIds: event.target.checked
                            ? [...current.knowledgeDocumentIds, item.id]
                            : current.knowledgeDocumentIds.filter((id) => id !== item.id),
                        }))
                      }
                    />
                    <div className="grow" style={{ marginLeft: 10 }}>
                      <div className="nm">
                        {item.title}
                        <span>{item.sensitivity}</span>
                      </div>
                    </div>
                  </label>
                ))}
                {!knowledgeDocuments.filter((item) => item.status === "ready").length ? (
                  <div className="sub">当前没有可引用的 READY 公开知识文档。</div>
                ) : null}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button
              type="button"
              className="btn primary sm"
              disabled={creating || !createForm.market.trim() || !createForm.product.trim()}
              onClick={() => void createSite()}
            >
              {creating ? "生成中…" : "生成站点（进审批队列）"}
            </button>
          </div>
        </div>
      ) : null}

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
              style={{
                cursor: "pointer",
                borderLeft:
                  site.id === selectedSiteId
                    ? "3px solid var(--teal)"
                    : "3px solid transparent",
                background: site.id === selectedSiteId ? "var(--teal-tint)" : undefined,
                borderRadius: 10,
                paddingLeft: 10,
                paddingRight: 10,
              }}
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

          {selectedSite ? (
          <div className="card" style={{ padding: "14px 20px" }}>
            <div className="langtab" style={{ marginLeft: 0, marginBottom: 14, gap: 6, flexWrap: "wrap" }}>
              <b
                className={detailTab === "approvals" ? "on" : ""}
                onClick={() => setDetailTab("approvals")}
              >
                审批队列 {relatedHitl.length}
              </b>
              <b
                className={detailTab === "versions" ? "on" : ""}
                onClick={() => setDetailTab("versions")}
              >
                版本回滚 {detail?.versionHistory.length ?? 0}
              </b>
              <b
                className={detailTab === "autofill" ? "on" : ""}
                onClick={() => setDetailTab("autofill")}
              >
                AI 补全 {detail?.version?.autofillCandidates.length ?? 0}
              </b>
            </div>

            {detailTab === "approvals" ? (
              <div>
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
            ) : null}

            {detailTab === "versions" ? (
              <div>
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
                {!(detail?.versionHistory.length) ? (
                  <div className="sub" style={{ padding: "10px 0" }}>暂无历史版本。</div>
                ) : null}
              </div>
            ) : null}

            {detailTab === "autofill" ? (
            <div>
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
            ) : null}
          </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
