"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";

type NotificationItem = {
  id: string;
  type: string;
  status: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  createdAt: string;
  readAt: string | null;
};

type NotificationsResponse = {
  unreadCount: number;
  items: NotificationItem[];
};

async function fetchNotifications(
  tenantId: string,
  status: "all" | "unread" | "read" | "archived",
) {
  const query = status === "all" ? "" : `?status=${status}`;
  const response = await fetch(`/api/notifications${query}`, {
    headers: {
      "X-Tenant-Id": tenantId,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载通知失败。");
  }

  return (await response.json()) as NotificationsResponse;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatType(type: string) {
  switch (type) {
    case "hitl_pending":
      return "审批待办";
    case "system":
      return "系统通知";
    case "audit":
      return "审计提醒";
    default:
      return type.replaceAll("_", " ");
  }
}

function badgeClass(item: NotificationItem) {
  if (item.type === "hitl_pending") {
    return "manual";
  }

  return item.readAt ? "line" : "local";
}

export function NotificationsClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [status, setStatus] = useState<"all" | "unread" | "read" | "archived">("all");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  async function refreshNotifications(nextStatus = status, tenantId = selectedTenantId) {
    if (!tenantId) {
      return;
    }

    setLoading(true);
    try {
      const payload = await fetchNotifications(tenantId, nextStatus);
      setError(null);
      setItems(payload.items);
      setUnreadCount(payload.unreadCount);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载通知失败。");
    } finally {
      setLoading(false);
    }
  }

  async function handleNotificationAction(
    notificationId: string,
    action: "read" | "archive",
  ) {
    if (!selectedTenantId) {
      return;
    }

    setActioningId(notificationId);
    setError(null);

    try {
      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify({
          action,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "更新通知状态失败。");
      }

      await refreshNotifications();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "更新通知状态失败。");
    } finally {
      setActioningId(null);
    }
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

    void fetchNotifications(selectedTenantId, status)
      .then((payload) => {
        if (!active) {
          return;
        }

        setError(null);
        setItems(payload.items);
        setUnreadCount(payload.unreadCount);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载通知失败。");
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
  }, [selectedTenantId, status]);

  const pendingApprovals = items.filter((item) => item.type === "hitl_pending").length;
  const linkedItems = items.filter((item) => item.linkUrl).length;

  return (
    <>
      <div className="head-row">
        <div>
          <div className="eyebrow">消息与审批</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            通知中心
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            系统通知、HITL 待办与审计提醒汇总到一个入口，不再分散在顶部弹层里。
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
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
        </div>
        <div>
          <div className="rt">未读提醒与待审批任务统一收口</div>
          <div className="rs">`hitl_pending` 会直接带去站点、设计或审批中心，普通通知保留审计与落地链接。</div>
        </div>
        <span className="upd">{loading ? "同步中…" : `${items.length} 条`}</span>
      </div>

      <div className="stat-strip" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat">
          <div className="v">{unreadCount}</div>
          <div className="l">未读总数</div>
        </div>
        <div className="stat">
          <div className="v">{pendingApprovals}</div>
          <div className="l">待审批任务</div>
        </div>
        <div className="stat">
          <div className="v">{linkedItems}</div>
          <div className="l">可跳转事项</div>
        </div>
      </div>

      <div className="head-row" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className={`btn sm ${status === "all" ? "primary" : "ghost"}`}
            onClick={() => setStatus("all")}
          >
            全部
          </button>
          <button
            type="button"
            className={`btn sm ${status === "unread" ? "primary" : "ghost"}`}
            onClick={() => setStatus("unread")}
          >
            未读
          </button>
          <button
            type="button"
            className={`btn sm ${status === "read" ? "primary" : "ghost"}`}
            onClick={() => setStatus("read")}
          >
            已读
          </button>
          <button
            type="button"
            className={`btn sm ${status === "archived" ? "primary" : "ghost"}`}
            onClick={() => setStatus("archived")}
          >
            已忽略
          </button>
        </div>
        <Link className="btn ghost sm" href="/hitl">
          去审批中心
        </Link>
      </div>

      <div className="card set-block">
        {items.map((item) => (
          <div className="row-card" key={item.id}>
            <div className="afi">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
                <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.7 3.86a2 2 0 0 0-3.4 0z" />
              </svg>
            </div>
            <div className="grow">
              <div className="nm">
                {item.title}
                <span>{formatTime(item.createdAt)}</span>
              </div>
              <div className="sub" style={{ marginTop: 4 }}>
                {item.body ?? "点击查看详情"}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <span className={`badge ${badgeClass(item)}`}>{formatType(item.type)}</span>
                <span className={`st ${item.readAt ? "published" : "pending"}`}>
                  {item.readAt ? "已读" : "未读"}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {item.linkUrl ? (
                <Link className="btn ghost sm" href={item.linkUrl}>
                  打开事项
                </Link>
              ) : null}
              {!item.id.startsWith("hitl-") && item.status === "unread" ? (
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={actioningId === item.id}
                  onClick={() => void handleNotificationAction(item.id, "read")}
                >
                  {actioningId === item.id ? "处理中…" : "标记已读"}
                </button>
              ) : null}
              {!item.id.startsWith("hitl-") && item.status !== "archived" ? (
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={actioningId === item.id}
                  onClick={() => void handleNotificationAction(item.id, "archive")}
                >
                  {actioningId === item.id ? "处理中…" : "忽略"}
                </button>
              ) : null}
            </div>
          </div>
        ))}

        {!items.length ? (
          <div className="empty">
            <div className="t">{loading ? "加载中…" : "当前筛选下没有通知"}</div>
            <div className="s">可以切换到“全部”查看系统历史提醒。</div>
          </div>
        ) : null}
      </div>
    </>
  );
}
