"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { statusLabel } from "@/app/_lib/labels";
import { HitlAction } from "@/app/_components/hitl-action";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";
import { canEdit } from "@/app/_components/hitl-meta";

type DesignItem = {
  id: string;
  title: string;
  platform: string;
  mediaType: string;
  publishStatus: string;
  plannedAt: string | null;
  contentPackId: string;
  contentPackTitle: string;
  publishRequestPending: boolean;
  editUrl: string;
};

type DesignResponse = {
  items: DesignItem[];
};

type AssetResponse = {
  items: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    kind: string;
    createdAt: string;
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

type PromotionTimingResponse = {
  countryName: string;
  inferredCountry: string;
  timezone: string;
  recommendedWindows: Array<{
    label: string;
    reason: string;
  }>;
  nextRecommendedAt: string | null;
  nextRecommendedWindow: string | null;
  nextRecommendedReason: string | null;
};

async function fetchQueue(tenantId: string) {
  const response = await fetch("/api/design/queue", {
    headers: {
      "X-Tenant-Id": tenantId,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载设计队列失败。");
  }

  return (await response.json()) as DesignResponse;
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

async function fetchPromotionTiming(tenantId: string, market: string) {
  const response = await fetch(
    `/api/scheduling/promotion-timing?market=${encodeURIComponent(market)}`,
    {
      headers: {
        "X-Tenant-Id": tenantId,
      },
    },
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载推广时间建议失败。");
  }

  return (await response.json()) as PromotionTimingResponse;
}

function formatTime(value: string | null) {
  if (!value) {
    return "未排期";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DesignClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [items, setItems] = useState<DesignItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [assets, setAssets] = useState<AssetResponse["items"]>([]);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<
    KnowledgeDocumentsResponse["items"]
  >([]);
  const [timingAdvice, setTimingAdvice] = useState<PromotionTimingResponse | null>(null);
  const [createForm, setCreateForm] = useState({
    topic: "",
    market: "",
    locales: "en,ar,ru",
    assetIds: [] as string[],
    knowledgeDocumentIds: [] as string[],
    referenceBrandKit: true,
  });

  const currentMembership =
    me?.memberships.find((item) => item.tenantId === selectedTenantId) ?? null;

  function canEditRole(role: string | undefined) {
    return role === "owner" || role === "admin" || role === "operator";
  }

  async function createPack() {
    if (!selectedTenantId) {
      return;
    }
    const locales = createForm.locales
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/content-packs/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify({
          topic: createForm.topic.trim(),
          market: createForm.market.trim() || undefined,
          locales: locales.length > 0 ? locales : ["en"],
          assetIds: createForm.assetIds,
          knowledgeDocumentIds: createForm.knowledgeDocumentIds,
          referenceBrandKit: createForm.referenceBrandKit,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "新建内容包失败。");
      }
      setShowCreate(false);
      await refreshQueue();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "新建内容包失败。");
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

  async function refreshQueue() {
    if (!selectedTenantId) {
      return;
    }

    setLoading(true);
    setError(null);
    const payload = await fetchQueue(selectedTenantId);
    setItems(payload.items);
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

    void Promise.all([
      fetchQueue(selectedTenantId),
      fetchAssets(selectedTenantId),
      fetchKnowledgeDocuments(selectedTenantId),
    ])
      .then(([queuePayload, assetsPayload, documentsPayload]) => {
        if (active) {
          setError(null);
          setItems(queuePayload.items);
          setAssets(assetsPayload.items);
          setKnowledgeDocuments(documentsPayload.items);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载设计队列失败。");
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

  useEffect(() => {
    if (!selectedTenantId || !createForm.market.trim()) {
      return;
    }

    let active = true;

    void fetchPromotionTiming(selectedTenantId, createForm.market.trim())
      .then((payload) => {
        if (active) {
          setTimingAdvice(payload);
        }
      })
      .catch(() => {
        if (active) {
          setTimingAdvice(null);
        }
      });

    return () => {
      active = false;
    };
  }, [createForm.market, selectedTenantId]);

  const pendingCount = items.filter((item) => item.publishRequestPending).length;

  return (
    <>
      <div className="head-row">
        <div>
          <div className="eyebrow">AI 设计 / 内容包</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            一个选题 · 多平台达标成品
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            内容不再直接改成已发，先发起审批请求，再由 HITL 统一确认。
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn primary sm"
            disabled={!canEditRole(currentMembership?.role)}
            onClick={() => setShowCreate((open) => !open)}
          >
            {showCreate ? "收起" : "新建内容包"}
          </button>
          {me && me.memberships.length > 0 ? (
            <select
              className="btn ghost sm"
              value={selectedTenantId}
              onChange={(event) => {
                setLoading(true);
                setTimingAdvice(null);
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
            <h3 style={{ fontSize: 15 }}>发起新内容包（一个选题 → 多平台）</h3>
          </div>
          <div className="grid-2" style={{ gap: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>选题</label>
              <input
                value={createForm.topic}
                onChange={(e) => setCreateForm({ ...createForm, topic: e.target.value })}
                placeholder="例如：空压机省 30% 电费"
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>目标市场（可选）</label>
              <input
                value={createForm.market}
                onChange={(e) => {
                  setTimingAdvice(null);
                  setCreateForm({ ...createForm, market: e.target.value });
                }}
                placeholder="例如：中东"
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>语种（逗号分隔，可选 en/ar/ru/fr/de/pt）</label>
              <input
                value={createForm.locales}
                onChange={(e) => setCreateForm({ ...createForm, locales: e.target.value })}
                placeholder="en,ar,ru"
              />
            </div>
          </div>
          {timingAdvice ? (
            <div className="card" style={{ padding: "12px 14px", marginTop: 12 }}>
              <div className="head-row" style={{ marginBottom: 6 }}>
                <b>推荐推广时间</b>
                <span className="badge line">
                  {timingAdvice.countryName} · {timingAdvice.inferredCountry}
                </span>
              </div>
              <div className="sub">
                下一个推荐时段：{timingAdvice.nextRecommendedWindow ?? "暂无"}。
                {timingAdvice.nextRecommendedReason ? ` ${timingAdvice.nextRecommendedReason}` : ""}
              </div>
            </div>
          ) : null}
          <div className="pv-grid" style={{ marginTop: 12 }}>
            <div className="pv-card">
              <div className="head-row" style={{ marginBottom: 8 }}>
                <b>素材引用</b>
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
                  <div className="sub">还没有素材，可先上传产品图、包装图、参考海报。</div>
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
                  <div className="sub">当前没有可引用的 READY 知识文档。</div>
                ) : null}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button
              type="button"
              className="btn primary sm"
              disabled={creating || !createForm.topic.trim()}
              onClick={() => void createPack()}
            >
              {creating ? "生成中…" : "生成内容包"}
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

      <div className="rules">
        <div className="ric">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
            <circle cx="12" cy="12" r="4" />
          </svg>
        </div>
        <div>
          <div className="rt">已按各平台最新规则适配 · 发布前需 HITL 审批</div>
          <div className="rs">尺寸 / 时长 / 文案 / 标签逐项对齐；视频平台出脚本 + 分镜 + 封面（成片→V1.5）</div>
        </div>
        <span className="upd">{loading ? "加载中…" : `${items.length} 条`}</span>
      </div>

      <div className="stat-strip" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat">
          <div className="v">{items.length}</div>
          <div className="l">全部内容</div>
        </div>
        <Link className="stat" href="/hitl" style={{ display: "block" }}>
          <div className="v">{pendingCount}</div>
          <div className="l">审批中 →</div>
        </Link>
        <Link className="stat" href="/publish-checklist" style={{ display: "block" }}>
          <div className="v">{items.filter((item) => item.publishStatus === "pending").length}</div>
          <div className="l">待发布 →</div>
        </Link>
      </div>

      <div className="pack-grid">
        {items.map((item) => (
          <div className="pk" key={item.id}>
            <div className="pk-top" style={{ background: platformGradient(item.platform) }}>
              <span className="ratio">{item.mediaType}</span>
              <span className="plat">{item.platform.toUpperCase()}</span>
              <span className="kind">{item.title}</span>
            </div>
            <div className="pk-body">
              <div className="pk-spec">{item.contentPackTitle}</div>
              <div className="sub" style={{ marginBottom: 8 }}>
                推荐排期：{formatTime(item.plannedAt)}
              </div>
              <div style={{ marginBottom: 8 }}>
                <span className={`st ${item.publishStatus}`}>{statusLabel(item.publishStatus)}</span>
                {item.publishRequestPending ? (
                  <span className="badge local" style={{ marginLeft: 6 }}>审批中</span>
                ) : null}
              </div>
              <div className="pk-link" style={{ borderTop: "none", paddingTop: 0, marginTop: 0 }}>
                <Link className="link" href={item.editUrl}>
                  打开内容包
                </Link>
                <Link
                  className="link"
                  href={`/tracking-links?contentPackId=${item.contentPackId}&platform=${item.platform}`}
                >
                  追踪链接
                </Link>
                <span style={{ marginLeft: "auto" }}>
                  {item.publishStatus === "published" ? (
                    <span className="badge good">已发布</span>
                  ) : item.publishRequestPending ? (
                    <Link className="btn ghost sm" href="/hitl">
                      去审批中心
                    </Link>
                  ) : (
                    <HitlAction
                      tenantId={selectedTenantId}
                      endpoint={`/api/content-items/${item.id}/publish-request`}
                      idleLabel="发起发布审批"
                      busyLabel="提交中…"
                      disabled={!canEdit(currentMembership?.role)}
                      onError={(message) => setError(message || null)}
                      onSuccess={() => refreshQueue()}
                    />
                  )}
                </span>
              </div>
            </div>
          </div>
        ))}
        {!items.length ? (
          <div className="card empty" style={{ gridColumn: "1 / -1" }}>
            <div className="t">{loading ? "加载中…" : "当前没有内容数据"}</div>
            <div className="s">在「AI 设计」里对话生成第一个内容包。</div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function platformGradient(platform: string) {
  const key = platform.toLowerCase();
  const map: Record<string, string> = {
    linkedin: "linear-gradient(140deg,#0A66C2,#08498C)",
    facebook: "linear-gradient(140deg,#1877F2,#0F5BD1)",
    instagram: "linear-gradient(140deg,#C13584,#F77737)",
    reels: "linear-gradient(140deg,#5851DB,#E1306C)",
    tiktok: "linear-gradient(140deg,#111,#00C2B8)",
    youtube: "linear-gradient(140deg,#FF0000,#B80000)",
    shorts: "linear-gradient(140deg,#FF4D4D,#CC0000)",
    vk: "linear-gradient(140deg,#0077FF,#0048B3)",
    rutube: "linear-gradient(140deg,#23173F,#000)",
  };

  for (const name of Object.keys(map)) {
    if (key.includes(name)) {
      return map[name];
    }
  }

  return "linear-gradient(140deg,#0C5C56,#072F2B)";
}
