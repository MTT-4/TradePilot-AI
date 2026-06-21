"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { canEdit } from "@/app/_components/hitl-meta";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";

type TrackingLinkItem = {
  id: string;
  slug: string;
  platform: string;
  targetUrl: string;
  resolvedUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string | null;
  botFilterEnabled: boolean;
  createdAt: string;
  campaign: {
    id: string;
    name: string;
  } | null;
  contentItem: {
    id: string;
    title: string;
    locale: string;
    publishStatus: string;
    contentPackId: string;
    contentPackTitle: string;
  };
  stats: {
    clicksTotal: number;
    clicksHuman: number;
    leads: number;
    latestClickAt: string | null;
  };
};

type TrackingLinksResponse = {
  items: TrackingLinkItem[];
};

type TrackingLinkFormState = {
  targetUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  botFilterEnabled: boolean;
};

const EMPTY_FORM: TrackingLinkFormState = {
  targetUrl: "",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmContent: "",
  botFilterEnabled: true,
};

function formatTime(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toFormState(item: TrackingLinkItem): TrackingLinkFormState {
  return {
    targetUrl: item.targetUrl,
    utmSource: item.utmSource,
    utmMedium: item.utmMedium,
    utmCampaign: item.utmCampaign,
    utmContent: item.utmContent ?? "",
    botFilterEnabled: item.botFilterEnabled,
  };
}

function buildResolvedUrlPreview(form: TrackingLinkFormState) {
  try {
    const targetUrl = new URL(form.targetUrl);

    targetUrl.searchParams.set("utm_source", form.utmSource.trim());
    targetUrl.searchParams.set("utm_medium", form.utmMedium.trim());
    targetUrl.searchParams.set("utm_campaign", form.utmCampaign.trim());

    if (form.utmContent.trim()) {
      targetUrl.searchParams.set("utm_content", form.utmContent.trim());
    } else {
      targetUrl.searchParams.delete("utm_content");
    }

    return targetUrl.toString();
  } catch {
    return form.targetUrl;
  }
}

function isDirty(item: TrackingLinkItem | null, form: TrackingLinkFormState) {
  if (!item) {
    return false;
  }

  return (
    item.targetUrl !== form.targetUrl.trim() ||
    item.utmSource !== form.utmSource.trim() ||
    item.utmMedium !== form.utmMedium.trim() ||
    item.utmCampaign !== form.utmCampaign.trim() ||
    (item.utmContent ?? "") !== form.utmContent.trim() ||
    item.botFilterEnabled !== form.botFilterEnabled
  );
}

async function fetchTrackingLinks(tenantId: string) {
  const response = await fetch("/api/tracking-links", {
    headers: {
      "X-Tenant-Id": tenantId,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载追踪链接失败。");
  }

  return (await response.json()) as TrackingLinksResponse;
}

async function patchTrackingLink(
  tenantId: string,
  trackingLinkId: string,
  form: TrackingLinkFormState,
) {
  const response = await fetch(`/api/tracking-links/${trackingLinkId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-Id": tenantId,
    },
    body: JSON.stringify({
      targetUrl: form.targetUrl.trim(),
      utmSource: form.utmSource.trim(),
      utmMedium: form.utmMedium.trim(),
      utmCampaign: form.utmCampaign.trim(),
      utmContent: form.utmContent.trim() || null,
      botFilterEnabled: form.botFilterEnabled,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "保存追踪链接失败。");
  }

  return (await response.json()) as {
    id: string;
    slug: string;
    platform: string;
    targetUrl: string;
    resolvedUrl: string;
    utmSource: string;
    utmMedium: string;
    utmCampaign: string;
    utmContent: string | null;
    botFilterEnabled: boolean;
  };
}

export function TrackingLinksClient() {
  const searchParams = useSearchParams();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [items, setItems] = useState<TrackingLinkItem[]>([]);
  const [selectedTrackingId, setSelectedTrackingId] = useState(
    searchParams.get("trackingLinkId")?.trim() ?? "",
  );
  const [platformFilter, setPlatformFilter] = useState(
    searchParams.get("platform")?.trim().toLowerCase() || "all",
  );
  const [campaignFilter, setCampaignFilter] = useState(
    searchParams.get("campaignId")?.trim() || "all",
  );
  const [contentPackFilter, setContentPackFilter] = useState(
    searchParams.get("contentPackId")?.trim() || "all",
  );
  const [form, setForm] = useState<TrackingLinkFormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedTrackingIdRef = useRef(selectedTrackingId);

  const currentMembership =
    me?.memberships.find((item) => item.tenantId === selectedTenantId) ?? null;
  const canEditCurrentTenant = canEdit(currentMembership?.role);
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (platformFilter !== "all" && item.platform !== platformFilter) {
        return false;
      }
      if (campaignFilter !== "all" && item.campaign?.id !== campaignFilter) {
        return false;
      }
      if (contentPackFilter !== "all" && item.contentItem.contentPackId !== contentPackFilter) {
        return false;
      }

      return true;
    });
  }, [campaignFilter, contentPackFilter, items, platformFilter]);
  const effectiveSelectedTrackingId =
    selectedTrackingId ||
    filteredItems[0]?.id ||
    "";
  const activeItem = useMemo(
    () =>
      filteredItems.find((item) => item.id === effectiveSelectedTrackingId) ??
      filteredItems[0] ??
      null,
    [effectiveSelectedTrackingId, filteredItems],
  );
  const activeForm =
    activeItem && activeItem.id === selectedTrackingId
      ? form
      : activeItem
        ? toFormState(activeItem)
        : EMPTY_FORM;
  const resolvedPreview = useMemo(() => buildResolvedUrlPreview(activeForm), [activeForm]);
  const formDirty = isDirty(activeItem, activeForm);

  useEffect(() => {
    selectedTrackingIdRef.current = selectedTrackingId;
  }, [selectedTrackingId]);

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

    void fetchTrackingLinks(selectedTenantId)
      .then((payload) => {
        if (!active) {
          return;
        }

        const nextSelectedItem =
          payload.items.find((item) => item.id === selectedTrackingIdRef.current) ??
          payload.items[0] ??
          null;

        setError(null);
        setItems(payload.items);
        setSelectedTrackingId(nextSelectedItem?.id ?? "");
        setForm(nextSelectedItem ? toFormState(nextSelectedItem) : EMPTY_FORM);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载追踪链接失败。");
          setItems([]);
          setSelectedTrackingId("");
          setForm(EMPTY_FORM);
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

  function selectItem(item: TrackingLinkItem) {
    setSelectedTrackingId(item.id);
    setForm(toFormState(item));
    setNotice(null);
    setError(null);
  }

  async function saveTrackingLink() {
    if (!selectedTenantId || !activeItem || !canEditCurrentTenant) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const updated = await patchTrackingLink(selectedTenantId, activeItem.id, activeForm);

      setItems((current) =>
        current.map((item) =>
          item.id === activeItem.id
            ? {
                ...item,
                targetUrl: updated.targetUrl,
                resolvedUrl: updated.resolvedUrl,
                utmSource: updated.utmSource,
                utmMedium: updated.utmMedium,
                utmCampaign: updated.utmCampaign,
                utmContent: updated.utmContent,
                botFilterEnabled: updated.botFilterEnabled,
              }
            : item,
        ),
      );
      setForm({
        targetUrl: updated.targetUrl,
        utmSource: updated.utmSource,
        utmMedium: updated.utmMedium,
        utmCampaign: updated.utmCampaign,
        utmContent: updated.utmContent ?? "",
        botFilterEnabled: updated.botFilterEnabled,
      });
      setNotice("追踪链接已保存，后续跳转会使用新的服务端 UTM。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存追踪链接失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="head-row">
        <div>
          <div className="eyebrow">追踪链接</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            slug · UTM · 点击/线索
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            查看每条追踪链接的目标地址、UTM 参数、点击量和转化线索，并按租户角色编辑目标地址与归因参数。
          </div>
        </div>
        {me && me.memberships.length > 0 ? (
          <select
            className="btn ghost sm"
            value={selectedTenantId}
            onChange={(event) => {
              setSelectedTrackingId("");
              setForm(EMPTY_FORM);
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

      {notice ? (
        <div
          className="card"
          style={{
            padding: "12px 16px",
            marginBottom: 18,
            borderColor: "var(--good-soft)",
            background: "var(--good-soft)",
            color: "var(--good)",
            fontSize: 13,
          }}
        >
          {notice}
        </div>
      ) : null}

      <div className="stat-strip" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="stat">
          <div className="v">{items.length}</div>
          <div className="l">追踪链接</div>
        </div>
        <div className="stat">
          <div className="v">{items.reduce((sum, item) => sum + item.stats.clicksHuman, 0)}</div>
          <div className="l">人工点击</div>
        </div>
        <div className="stat">
          <div className="v">{items.reduce((sum, item) => sum + item.stats.leads, 0)}</div>
          <div className="l">关联线索</div>
        </div>
        <div className="stat">
          <div className="v">{items.filter((item) => item.botFilterEnabled).length}</div>
          <div className="l">已启用 Bot 过滤</div>
        </div>
      </div>

      <div className="head-row" style={{ marginTop: 20, marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            className="btn ghost sm"
            value={platformFilter}
            onChange={(event) => setPlatformFilter(event.target.value)}
          >
            <option value="all">全部平台</option>
            {Array.from(new Set(items.map((item) => item.platform))).map((platform) => (
              <option key={platform} value={platform}>
                {platform.toUpperCase()}
              </option>
            ))}
          </select>
          <select
            className="btn ghost sm"
            value={campaignFilter}
            onChange={(event) => setCampaignFilter(event.target.value)}
          >
            <option value="all">全部活动</option>
            {Array.from(
              new Map(
                items
                  .filter((item) => item.campaign)
                  .map((item) => [item.campaign!.id, item.campaign!]),
              ).values(),
            ).map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
          <select
            className="btn ghost sm"
            value={contentPackFilter}
            onChange={(event) => setContentPackFilter(event.target.value)}
          >
            <option value="all">全部内容包</option>
            {Array.from(
              new Map(
                items.map((item) => [
                  item.contentItem.contentPackId,
                  {
                    id: item.contentItem.contentPackId,
                    title: item.contentItem.contentPackTitle,
                  },
                ]),
              ).values(),
            ).map((contentPack) => (
              <option key={contentPack.id} value={contentPack.id}>
                {contentPack.title}
              </option>
            ))}
          </select>
        </div>
        <span className="badge line">{loading ? "加载中…" : `${filteredItems.length} / ${items.length} 条`}</span>
      </div>

      <div className="card" style={{ padding: "6px 18px" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>平台 / slug</th>
              <th>内容</th>
              <th>UTM</th>
              <th>效果</th>
              <th>目标地址</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.id}>
                <td>
                  <span className="badge line">{item.platform.toUpperCase()}</span>
                  <div className="link" style={{ marginTop: 8 }}>{item.slug}</div>
                  <div className="sub" style={{ marginTop: 4 }}>
                    创建于 {formatTime(item.createdAt)}
                  </div>
                </td>
                <td>
                  <b>{item.contentItem.title}</b>
                  <div className="sub" style={{ marginTop: 4 }}>
                    {item.contentItem.locale.toUpperCase()} · {item.contentItem.publishStatus}
                  </div>
                  <div className="sub" style={{ marginTop: 4 }}>
                    内容包：{item.contentItem.contentPackTitle}
                  </div>
                  <div className="sub">
                    活动：{item.campaign?.name ?? "未关联"}
                  </div>
                </td>
                <td>
                  <div className="sub">source: {item.utmSource}</div>
                  <div className="sub">medium: {item.utmMedium}</div>
                  <div className="sub">campaign: {item.utmCampaign}</div>
                  <div className="sub">content: {item.utmContent ?? "—"}</div>
                </td>
                <td>
                  <div className="sub">人工点击：{item.stats.clicksHuman}</div>
                  <div className="sub">总点击：{item.stats.clicksTotal}</div>
                  <div className="sub">关联线索：{item.stats.leads}</div>
                  <div className="sub">最近点击：{formatTime(item.stats.latestClickAt)}</div>
                </td>
                <td>
                  <div className="sub" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {item.targetUrl}
                  </div>
                  <div className="link" style={{ marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {item.resolvedUrl}
                  </div>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn ghost sm"
                      onClick={() => {
                        selectItem(item);
                      }}
                      type="button"
                    >
                      {item.id === selectedTrackingId ? "当前" : canEditCurrentTenant ? "编辑" : "查看"}
                    </button>
                    <Link
                      className="btn ghost sm"
                      href={`/content-packs/${item.contentItem.contentPackId}/chat`}
                    >
                      打开内容包
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {!filteredItems.length ? (
              <tr>
                <td colSpan={6}>
                  <div className="sub" style={{ padding: "12px 0" }}>当前筛选条件下没有追踪链接。</div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="split" style={{ marginTop: 18, gridTemplateColumns: "0.95fr 1.05fr" }}>
        <div className="card" style={{ padding: "14px 18px" }}>
          <div className="head-row" style={{ marginBottom: 10 }}>
            <div>
              <div className="eyebrow">追踪详情</div>
              <h3 style={{ fontSize: 16, marginTop: 4 }}>
                {activeItem ? activeItem.slug : "未选择追踪链接"}
              </h3>
            </div>
            {activeItem ? <span className="badge line">{activeItem.platform.toUpperCase()}</span> : null}
          </div>

          {activeItem ? (
            <>
              <div className="card" style={{ padding: "12px 14px", marginBottom: 12 }}>
                <div className="sub">内容标题</div>
                <div style={{ marginTop: 4, fontWeight: 600 }}>{activeItem.contentItem.title}</div>
                <div className="sub" style={{ marginTop: 6 }}>
                  {activeItem.contentItem.locale.toUpperCase()} · {activeItem.contentItem.publishStatus}
                </div>
              </div>

              <div className="card" style={{ padding: "12px 14px", marginBottom: 12 }}>
                <div className="sub">跳转效果</div>
                <div className="sub" style={{ marginTop: 8 }}>人工点击：{activeItem.stats.clicksHuman}</div>
                <div className="sub">总点击：{activeItem.stats.clicksTotal}</div>
                <div className="sub">关联线索：{activeItem.stats.leads}</div>
                <div className="sub">最近点击：{formatTime(activeItem.stats.latestClickAt)}</div>
              </div>

              <div className="card" style={{ padding: "12px 14px" }}>
                <div className="sub">服务端最终跳转</div>
                <div
                  className="link"
                  style={{
                    marginTop: 8,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    lineHeight: 1.7,
                  }}
                >
                  {resolvedPreview}
                </div>
              </div>
            </>
          ) : (
            <div className="sub">从上方列表选择一条追踪链接查看详情。</div>
          )}
        </div>

        <div className="card set-block" style={{ padding: "14px 18px" }}>
          <div className="head-row" style={{ marginBottom: 10 }}>
            <div>
              <div className="eyebrow">链接管理</div>
              <h3 style={{ fontSize: 16, marginTop: 4 }}>目标地址 / UTM / Bot 过滤</h3>
              <div className="sub" style={{ marginTop: 4 }}>
                {canEditCurrentTenant
                  ? "支持调整目标 URL、UTM 参数和 Bot 过滤开关；slug 与内容关联保持不变。"
                  : "当前角色只有只读权限，不能修改追踪链接。"}
              </div>
            </div>
            <span className="badge line">
              {currentMembership ? currentMembership.role.toUpperCase() : "—"}
            </span>
          </div>

          {activeItem ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field" style={{ gridColumn: "1 / -1", marginBottom: 0 }}>
                  <label htmlFor="tracking-target-url">目标地址</label>
                  <input
                    id="tracking-target-url"
                    value={activeForm.targetUrl}
                    onChange={(event) => {
                      setSelectedTrackingId(activeItem.id);
                      setForm((current) => ({
                        ...(activeItem.id === selectedTrackingId ? current : activeForm),
                        targetUrl: event.target.value,
                      }));
                    }}
                    disabled={!canEditCurrentTenant || saving}
                  />
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="tracking-utm-source">utm_source</label>
                  <input
                    id="tracking-utm-source"
                    value={activeForm.utmSource}
                    onChange={(event) => {
                      setSelectedTrackingId(activeItem.id);
                      setForm((current) => ({
                        ...(activeItem.id === selectedTrackingId ? current : activeForm),
                        utmSource: event.target.value,
                      }));
                    }}
                    disabled={!canEditCurrentTenant || saving}
                  />
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="tracking-utm-medium">utm_medium</label>
                  <input
                    id="tracking-utm-medium"
                    value={activeForm.utmMedium}
                    onChange={(event) => {
                      setSelectedTrackingId(activeItem.id);
                      setForm((current) => ({
                        ...(activeItem.id === selectedTrackingId ? current : activeForm),
                        utmMedium: event.target.value,
                      }));
                    }}
                    disabled={!canEditCurrentTenant || saving}
                  />
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="tracking-utm-campaign">utm_campaign</label>
                  <input
                    id="tracking-utm-campaign"
                    value={activeForm.utmCampaign}
                    onChange={(event) => {
                      setSelectedTrackingId(activeItem.id);
                      setForm((current) => ({
                        ...(activeItem.id === selectedTrackingId ? current : activeForm),
                        utmCampaign: event.target.value,
                      }));
                    }}
                    disabled={!canEditCurrentTenant || saving}
                  />
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="tracking-utm-content">utm_content</label>
                  <input
                    id="tracking-utm-content"
                    value={activeForm.utmContent}
                    onChange={(event) => {
                      setSelectedTrackingId(activeItem.id);
                      setForm((current) => ({
                        ...(activeItem.id === selectedTrackingId ? current : activeForm),
                        utmContent: event.target.value,
                      }));
                    }}
                    disabled={!canEditCurrentTenant || saving}
                    placeholder="可留空"
                  />
                </div>
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 14,
                  color: "var(--ink-2)",
                  fontSize: 13,
                }}
              >
                <input
                  type="checkbox"
                  checked={activeForm.botFilterEnabled}
                  onChange={(event) => {
                    setSelectedTrackingId(activeItem.id);
                    setForm((current) => ({
                      ...(activeItem.id === selectedTrackingId ? current : activeForm),
                      botFilterEnabled: event.target.checked,
                    }));
                  }}
                  disabled={!canEditCurrentTenant || saving}
                />
                启用 Bot User-Agent 过滤
              </label>

              <div className="head-row" style={{ marginTop: 14 }}>
                <div className="sub">
                  {formDirty ? "有未保存修改" : "当前表单与服务端数据一致"}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn ghost sm"
                    type="button"
                    onClick={() => {
                      setSelectedTrackingId(activeItem.id);
                      setForm(toFormState(activeItem));
                      setNotice(null);
                    }}
                    disabled={!canEditCurrentTenant || saving || !formDirty}
                  >
                    重置
                  </button>
                  <button
                    className="btn primary sm"
                    type="button"
                    onClick={() => {
                      void saveTrackingLink();
                    }}
                    disabled={!canEditCurrentTenant || saving || !formDirty}
                  >
                    {saving ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="sub">选择一条追踪链接后显示可编辑字段。</div>
          )}
        </div>
      </div>
    </>
  );
}
