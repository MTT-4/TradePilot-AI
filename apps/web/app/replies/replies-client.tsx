"use client";

import { useEffect, useState } from "react";
import { HitlAction } from "@/app/_components/hitl-action";
import {
  canApproveTask,
  formatTime,
  type HitlTaskItem,
} from "@/app/_components/hitl-meta";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";

type HitlResponse = {
  items: HitlTaskItem[];
};

function readString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

async function fetchReplyTasks(tenantId: string) {
  const response = await fetch("/api/hitl?status=pending", {
    headers: { "X-Tenant-Id": tenantId },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载首响队列失败。");
  }
  const payload = (await response.json()) as HitlResponse;
  return payload.items.filter((item) => item.type === "reply_send");
}

export function RepliesClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [tasks, setTasks] = useState<HitlTaskItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

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
        setSelectedTenantId(
          payload.currentTenant?.tenantId ?? payload.memberships[0]?.tenantId ?? "",
        );
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

  async function reload() {
    if (!selectedTenantId) {
      return;
    }
    const items = await fetchReplyTasks(selectedTenantId);
    setTasks(items);
    setSelectedId((current) => current || items[0]?.id || "");
  }

  useEffect(() => {
    if (!selectedTenantId) {
      return;
    }
    let active = true;
    void fetchReplyTasks(selectedTenantId)
      .then((items) => {
        if (!active) {
          return;
        }
        setError(null);
        setTasks(items);
        setSelectedId((current) => current || items[0]?.id || "");
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载首响队列失败。");
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

  function draftOf(task: HitlTaskItem | null) {
    if (!task) {
      return "";
    }
    return (
      readString(task.payload, "draftText") ??
      readString(task.payload, "draftBody") ??
      readString(task.payload, "replyDraft") ??
      ""
    );
  }

  function selectTask(taskId: string) {
    setSelectedId(taskId);
    setDraft(draftOf(tasks.find((item) => item.id === taskId) ?? null));
  }

  const selectedTask = tasks.find((item) => item.id === selectedId) ?? null;
  const payload = selectedTask?.payload ?? {};
  const inquiryText =
    readString(payload, "inquiryText") ??
    readString(payload, "inquiryBody") ??
    readString(payload, "inquiryPreview");

  return (
    <>
      <div className="head-row">
        <div>
          <div className="eyebrow">AI 首响审批</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            本地 Qwen 起草 · 你审后再发
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            客户隐私只在本地 Qwen 处理，绝不发往 OpenAI / Google。
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="badge local">
            <span className="dot local" />
            隐私不出门
          </span>
          {me && me.memberships.length > 0 ? (
            <select
              className="btn ghost sm"
              value={selectedTenantId}
              onChange={(event) => {
                setLoading(true);
                setSelectedTenantId(event.target.value);
                setSelectedId("");
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

      <div className="split" style={{ gridTemplateColumns: "0.8fr 1.2fr" }}>
        <div className="card" style={{ padding: "8px 18px" }}>
          <div className="head-row" style={{ marginBottom: 6, paddingTop: 10 }}>
            <h3 style={{ fontSize: 15 }}>待发送首响</h3>
            <span className="badge manual">{loading ? "…" : tasks.length}</span>
          </div>
          {tasks.map((task) => (
            <div
              className="hitl-item"
              key={task.id}
              style={{ cursor: "pointer" }}
              onClick={() => selectTask(task.id)}
            >
              <div className="ic local">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M4 4h16v12H5.2L4 18z" />
                </svg>
              </div>
              <div className="grow">
                <div className="t">
                  {readString(task.payload, "company") ??
                    readString(task.payload, "leadName") ??
                    "询盘首响"}
                </div>
                <div className="m">{formatTime(task.createdAt)}</div>
              </div>
              {task.id === selectedId ? <span className="badge good">当前</span> : null}
            </div>
          ))}
          {!loading && tasks.length === 0 ? (
            <div className="empty" style={{ padding: "28px 12px" }}>
              <div className="t">暂无待发送的首响草稿</div>
              <div className="s">新询盘进入后，本地 Qwen 会起草首响在此等待你确认。</div>
            </div>
          ) : null}
        </div>

        <div className="reply-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="card inq">
            <div className="head-row" style={{ marginBottom: 6 }}>
              <h3 style={{ fontSize: 14 }}>客户询盘</h3>
            </div>
            {selectedTask ? (
              <div className="inq-body">
                {inquiryText ?? "询盘正文详情接口待补（见 HANDOVER 4.4：GET /api/replies/[id]）。"}
              </div>
            ) : (
              <div className="sub" style={{ padding: "10px 0" }}>从左侧选择一条首响任务。</div>
            )}
          </div>

          <div className="card draft">
            <div className="head-row" style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>AI 首响草稿</div>
              <span className="badge local">本地 Qwen</span>
            </div>
            {selectedTask ? (
              <>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="草稿正文（编辑保存接口待补：PATCH /api/replies/[id]）"
                  style={{
                    width: "100%",
                    minHeight: 160,
                    border: "1px solid var(--local-soft)",
                    borderRadius: 11,
                    padding: 14,
                    fontFamily: "inherit",
                    fontSize: 13,
                    lineHeight: 1.6,
                    background: "linear-gradient(180deg,#f8f7fd,#fff)",
                  }}
                />
                <div className="hitl" style={{ marginTop: 14 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v5M12 16h.01" />
                  </svg>
                  <div className="grow">
                    <div className="t">发送需你确认</div>
                    <div className="m">编辑保存接口待补；当前可直接确认并发送原草稿。</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                  <button type="button" className="btn ghost sm" disabled title="编辑保存接口待补（HANDOVER 4.4）">
                    保存编辑
                  </button>
                  {canApproveTask(currentMembership?.role, "reply_send") ? (
                    <HitlAction
                      tenantId={selectedTenantId}
                      endpoint={`/api/hitl/${selectedTask.id}/approve`}
                      idleLabel="确认并发送"
                      busyLabel="发送中…"
                      onError={(message) => setError(message || null)}
                      onSuccess={() => reload()}
                    />
                  ) : (
                    <span className="badge line">无权发送</span>
                  )}
                </div>
              </>
            ) : (
              <div className="sub" style={{ padding: "10px 0" }}>选择任务后显示草稿。</div>
            )}
          </div>
        </div>
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
          客户姓名、电话、询盘正文属隐私数据，<b>只在本地 Qwen 处理</b>
          。本地引擎不可用时任务排队等待恢复，绝不切第三方。
        </div>
      </div>
    </>
  );
}
