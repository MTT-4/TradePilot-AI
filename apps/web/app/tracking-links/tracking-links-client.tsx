"use client";

import { useEffect, useState } from "react";
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
  contentItem: {
    id: string;
    title: string;
    locale: string;
    publishStatus: string;
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

export function TrackingLinksClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [items, setItems] = useState<TrackingLinkItem[]>([]);
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

    void fetchTrackingLinks(selectedTenantId)
      .then((payload) => {
        if (!active) {
          return;
        }

        setError(null);
        setItems(payload.items);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载追踪链接失败。");
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

  return (
    <>
      <div className="head-row">
        <div>
          <div className="eyebrow">追踪链接</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            slug · UTM · 点击/线索
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            只读查看每条追踪链接的目标地址、UTM 参数、点击量和转化线索。
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
        <h3 style={{ fontSize: 16 }}>最近 50 条追踪链接</h3>
        <span className="badge line">{loading ? "加载中…" : `${items.length} 条`}</span>
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
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
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
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={5}>
                  <div className="sub" style={{ padding: "12px 0" }}>当前没有追踪链接。</div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
