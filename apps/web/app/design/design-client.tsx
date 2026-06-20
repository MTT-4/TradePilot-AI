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
  contentPackId: string;
  contentPackTitle: string;
  publishRequestPending: boolean;
  editUrl: string;
};

type DesignResponse = {
  items: DesignItem[];
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

export function DesignClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [items, setItems] = useState<DesignItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    topic: "",
    market: "",
    locales: "en,ar,ru",
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

    void fetchQueue(selectedTenantId)
      .then((payload) => {
        if (active) {
          setError(null);
          setItems(payload.items);
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
                onChange={(e) => setCreateForm({ ...createForm, market: e.target.value })}
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
