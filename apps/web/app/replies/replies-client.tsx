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

type ReplyDetail = {
  reply: {
    id: string;
    status: string;
    route: string;
    draftText: string;
    finalText: string | null;
    citations: unknown[];
    hitlTaskId: string | null;
    createdAt: string;
    updatedAt: string;
    sentAt: string | null;
    inquiry: {
      id: string;
      subject: string | null;
      body: string;
      translatedBody: string | null;
      fromEmail: string | null;
      fromName: string | null;
      sourceType: string;
      createdAt: string;
      lead: {
        id: string;
        companyName: string | null;
        preferredLocale: string | null;
        contactName: string | null;
        contactEmail: string | null;
      };
    };
  };
};

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
  const [detail, setDetail] = useState<ReplyDetail["reply"] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"save" | "reject" | null>(null);

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

  async function loadDetail(replyId: string) {
    if (!selectedTenantId || !replyId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/replies/${replyId}`, {
        headers: { "X-Tenant-Id": selectedTenantId },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "加载草稿详情失败。");
      }
      const payload = (await response.json()) as ReplyDetail;
      setDetail(payload.reply);
      setDraft(payload.reply.draftText ?? "");
    } catch (detailError) {
      setDetail(null);
      setError(detailError instanceof Error ? detailError.message : "加载草稿详情失败。");
    } finally {
      setDetailLoading(false);
    }
  }

  async function reloadList() {
    if (!selectedTenantId) {
      return;
    }
    const items = await fetchReplyTasks(selectedTenantId);
    setTasks(items);
    const nextId = items[0]?.id ?? "";
    setSelectedId(nextId);
    const nextTask = items.find((item) => item.id === nextId) ?? null;
    if (nextTask) {
      void loadDetail(nextTask.entityId);
    } else {
      setDetail(null);
      setDraft("");
    }
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
        const first = items[0] ?? null;
        setSelectedId(first?.id ?? "");
        if (first) {
          void loadDetail(first.entityId);
        }
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
    // loadDetail 依赖 selectedTenantId（已在依赖内）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId]);

  function selectTask(task: HitlTaskItem) {
    setSelectedId(task.id);
    void loadDetail(task.entityId);
  }

  async function saveEdit() {
    if (!detail || !draft.trim()) {
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const response = await fetch(`/api/replies/${detail.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify({ draftText: draft.trim() }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "保存草稿失败。");
      }
      await loadDetail(detail.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存草稿失败。");
    } finally {
      setBusy(null);
    }
  }

  async function rejectDraft() {
    if (!detail) {
      return;
    }
    setBusy("reject");
    setError(null);
    try {
      const response = await fetch(`/api/replies/${detail.id}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "拒绝失败。");
      }
      await reloadList();
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "拒绝失败。");
    } finally {
      setBusy(null);
    }
  }

  const selectedTask = tasks.find((item) => item.id === selectedId) ?? null;
  const inquiry = detail?.inquiry ?? null;

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
                setDetail(null);
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
              style={{
                cursor: "pointer",
                background: task.id === selectedId ? "var(--local-soft)" : undefined,
                borderRadius: 9,
                paddingLeft: 8,
                paddingRight: 8,
              }}
              onClick={() => selectTask(task)}
            >
              <div className="ic local">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M4 4h16v12H5.2L4 18z" />
                </svg>
              </div>
              <div className="grow">
                <div className="t">首响草稿待发送</div>
                <div className="m">{formatTime(task.createdAt)}</div>
              </div>
            </div>
          ))}
          {!loading && tasks.length === 0 ? (
            <div className="empty" style={{ padding: "28px 12px" }}>
              <div className="t">暂无待发送的首响草稿</div>
              <div className="s">在 CRM 询盘处「用 AI 起草首响」后，会在此等待你确认。</div>
            </div>
          ) : null}
        </div>

        <div className="reply-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="card inq">
            <div className="head-row" style={{ marginBottom: 6 }}>
              <h3 style={{ fontSize: 14 }}>
                客户询盘
                {inquiry?.lead.companyName ? ` · ${inquiry.lead.companyName}` : ""}
              </h3>
            </div>
            {detailLoading ? (
              <div className="sub" style={{ padding: "10px 0" }}>加载中…</div>
            ) : inquiry ? (
              <>
                <div className="sub" style={{ marginBottom: 8 }}>
                  {inquiry.lead.contactName ?? inquiry.fromName ?? "客户"} ·{" "}
                  {inquiry.fromEmail ?? inquiry.lead.contactEmail ?? "无邮箱"} ·{" "}
                  {formatTime(inquiry.createdAt)}
                </div>
                <div className="inq-body">{inquiry.body}</div>
                {inquiry.translatedBody ? (
                  <div className="sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
                    （机器译）{inquiry.translatedBody}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="sub" style={{ padding: "10px 0" }}>从左侧选择一条首响任务。</div>
            )}
          </div>

          <div className="card draft">
            <div className="head-row" style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>AI 首响草稿</div>
              <span className="badge local">
                本地 Qwen{detail?.route ? ` · ${detail.route}` : ""}
              </span>
            </div>
            {detail ? (
              <>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="本地 Qwen 起草的首响草稿，可编辑后保存"
                  style={{
                    width: "100%",
                    minHeight: 170,
                    border: "1px solid var(--local-soft)",
                    borderRadius: 11,
                    padding: 14,
                    fontFamily: "inherit",
                    fontSize: 13,
                    lineHeight: 1.6,
                    background: "linear-gradient(180deg,#f8f7fd,#fff)",
                  }}
                />
                {detail.citations.length > 0 ? (
                  <div className="cite">
                    <b>引用知识：</b>
                    {detail.citations
                      .map((citation) =>
                        typeof citation === "string" ? citation : JSON.stringify(citation),
                      )
                      .join(" · ")}
                  </div>
                ) : null}
                <div className="hitl" style={{ marginTop: 14 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v5M12 16h.01" />
                  </svg>
                  <div className="grow">
                    <div className="t">发送需你确认</div>
                    <div className="m">可先编辑保存，确认后发出并记录。</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={busy !== null || !draft.trim() || draft.trim() === detail.draftText}
                    onClick={() => void saveEdit()}
                  >
                    {busy === "save" ? "保存中…" : "保存编辑"}
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={busy !== null}
                    onClick={() => void rejectDraft()}
                  >
                    {busy === "reject" ? "处理中…" : "拒绝"}
                  </button>
                  {selectedTask && canApproveTask(currentMembership?.role, "reply_send") ? (
                    <HitlAction
                      tenantId={selectedTenantId}
                      endpoint={`/api/hitl/${selectedTask.id}/approve`}
                      idleLabel="确认并发送"
                      busyLabel="发送中…"
                      onError={(message) => setError(message || null)}
                      onSuccess={() => reloadList()}
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
