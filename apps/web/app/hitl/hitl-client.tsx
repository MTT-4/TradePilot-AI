"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HitlAction } from "@/app/_components/hitl-action";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";
import {
  canApproveTask,
  formatTaskDetail,
  formatTaskType,
  formatTime,
  resolveTaskHref,
  type HitlTaskItem,
} from "@/app/_components/hitl-meta";

type HitlResponse = {
  items: HitlTaskItem[];
};

async function fetchTasks(tenantId: string) {
  const response = await fetch("/api/hitl?status=pending", {
    headers: {
      "X-Tenant-Id": tenantId,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载审批中心失败。");
  }

  return (await response.json()) as HitlResponse;
}

export function HitlClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [tasks, setTasks] = useState<HitlTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentMembership =
    me?.memberships.find((item) => item.tenantId === selectedTenantId) ?? null;

  async function refreshTasks() {
    if (!selectedTenantId) {
      return;
    }

    setLoading(true);
    setError(null);
    const payload = await fetchTasks(selectedTenantId);
    setTasks(payload.items);
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

    void fetchTasks(selectedTenantId)
      .then((payload) => {
        if (active) {
          setError(null);
          setTasks(payload.items);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载审批中心失败。");
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
          <div className="eyebrow">人工把关 · 审批中心</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            站点 · 内容 · 首响统一审批
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            所有对外动作都要你点头才生效，审批后可跳回各模块继续操作。
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

      <div className="stat-strip" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat">
          <div className="v">{tasks.filter((task) => task.type === "site_publish").length}</div>
          <div className="l">站点待批</div>
        </div>
        <div className="stat">
          <div className="v">{tasks.filter((task) => task.type === "content_publish").length}</div>
          <div className="l">内容待批</div>
        </div>
        <div className="stat">
          <div className="v">{tasks.filter((task) => task.type === "reply_send").length}</div>
          <div className="l">首响待批</div>
        </div>
      </div>

      <div className="head-row" style={{ marginBottom: 10 }}>
        <h3 style={{ fontSize: 16 }}>待处理任务</h3>
        <span className="badge manual">{loading ? "加载中…" : `${tasks.length} 待处理`}</span>
      </div>
      <div className="card" style={{ padding: "8px 20px" }}>
        {tasks.map((task) => (
          <div className="hitl-item" key={task.id}>
            <div className="ic local">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M4 4h16v12H5.2L4 18z" />
              </svg>
            </div>
            <div className="grow">
              <div className="t">{formatTaskType(task.type)}</div>
              <div className="m">
                {formatTaskDetail(task)} · {formatTime(task.createdAt)}
              </div>
            </div>
            <Link className="btn ghost sm" href={resolveTaskHref(task)}>
              查看上下文
            </Link>
            {canApproveTask(currentMembership?.role, task.type) ? (
              <HitlAction
                tenantId={selectedTenantId}
                endpoint={`/api/hitl/${task.id}/approve`}
                idleLabel="批准"
                busyLabel="审批中…"
                onError={(message) => setError(message || null)}
                onSuccess={() => refreshTasks()}
              />
            ) : (
              <span className="badge line">无权审批</span>
            )}
          </div>
        ))}
        {!tasks.length ? (
          <div className="empty" style={{ padding: "32px 12px" }}>
            <div className="t">当前没有待处理审批</div>
            <div className="s">智能体产出的对外动作会先进入这里等待你确认。</div>
          </div>
        ) : null}
      </div>

      <div
        className="card"
        style={{
          padding: "14px 18px",
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--local-soft)",
          borderColor: "#cfccf0",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--local-2)"
          strokeWidth={2}
          style={{ width: 18, height: 18, flex: "none" }}
        >
          <path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z" />
        </svg>
        <div style={{ flex: 1, fontSize: 12.5, color: "var(--local-2)" }}>
          客户姓名、电话、询盘正文属隐私数据，<b>只在本地 Qwen 处理，不发往 OpenAI / Google</b>
          。本地引擎不可用时任务会排队等待恢复，绝不切第三方。
        </div>
      </div>
    </>
  );
}
