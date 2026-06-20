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

type ReplyCitation = {
  sourceCitation?: string;
  excerpt?: string;
};

type ReplyDetailResponse = {
  reply: {
    id: string;
    status: string;
    route: string;
    draftText: string;
    finalText: string | null;
    citations: ReplyCitation[];
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

async function fetchReplyDetail(tenantId: string, replyId: string) {
  const response = await fetch(`/api/replies/${replyId}`, {
    headers: { "X-Tenant-Id": tenantId },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载首响详情失败。");
  }

  return (await response.json()) as ReplyDetailResponse;
}

function titleOfTask(task: HitlTaskItem, detail: ReplyDetailResponse["reply"] | null) {
  return (
    readString(task.payload, "company") ??
    detail?.inquiry.lead.companyName ??
    readString(task.payload, "leadName") ??
    detail?.inquiry.fromName ??
    "询盘首响"
  );
}

function previewOfTask(task: HitlTaskItem, detail: ReplyDetailResponse["reply"] | null) {
  return (
    readString(task.payload, "inquiryPreview") ??
    detail?.inquiry.subject ??
    detail?.inquiry.body.slice(0, 120) ??
    "等待审阅的首响草稿"
  );
}

function avatarLabel(detail: ReplyDetailResponse["reply"] | null) {
  const source =
    detail?.inquiry.fromName ??
    detail?.inquiry.lead.contactName ??
    detail?.inquiry.lead.companyName ??
    "客";

  return source.slice(0, 1).toUpperCase();
}

export function RepliesClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [tasks, setTasks] = useState<HitlTaskItem[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [detail, setDetail] = useState<ReplyDetailResponse["reply"] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);

  const currentMembership =
    me?.memberships.find((item) => item.tenantId === selectedTenantId) ?? null;
  const selectedTask = tasks.find((item) => item.id === selectedTaskId) ?? null;
  const activeDetail =
    detail && selectedTask?.entityId === detail.id ? detail : null;
  const canActOnReply =
    !!selectedTask &&
    !!activeDetail &&
    activeDetail.status === "pending_approval" &&
    canApproveTask(currentMembership?.role, "reply_send");

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

  async function reloadTasks(options?: { nextSelectedTaskId?: string }) {
    if (!selectedTenantId) {
      return;
    }

    const items = await fetchReplyTasks(selectedTenantId);
    const preferredTaskId = options?.nextSelectedTaskId ?? selectedTaskId;
    const nextTaskId =
      preferredTaskId && items.some((item) => item.id === preferredTaskId)
        ? preferredTaskId
        : items[0]?.id ?? "";

    setTasks(items);
    setSelectedTaskId(nextTaskId);
    setDetailLoading(Boolean(nextTaskId));
    if (!nextTaskId) {
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
        const nextTaskId = items[0]?.id ?? "";
        setSelectedTaskId(nextTaskId);
        setDetailLoading(Boolean(nextTaskId));
        if (!nextTaskId) {
          setDetail(null);
          setDraft("");
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
  }, [selectedTenantId]);

  useEffect(() => {
    if (!selectedTenantId || !selectedTask?.entityId) {
      return;
    }

    let active = true;

    void fetchReplyDetail(selectedTenantId, selectedTask.entityId)
      .then((payload) => {
        if (!active) {
          return;
        }

        setError(null);
        setDetail(payload.reply);
        setDraft(payload.reply.draftText);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载首响详情失败。");
          setDetail(null);
          setDraft("");
        }
      })
      .finally(() => {
        if (active) {
          setDetailLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedTask?.entityId, selectedTenantId]);

  async function saveDraft() {
    if (!selectedTenantId || !activeDetail || !canActOnReply || !draft.trim()) {
      return;
    }

    setSaveBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/replies/${activeDetail.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify({
          draftText: draft,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "保存草稿失败。");
      }

      const payload = (await response.json()) as ReplyDetailResponse;
      setDetail((current) => ({
        ...payload.reply,
        inquiry: {
          ...payload.reply.inquiry,
          translatedBody:
            payload.reply.inquiry.translatedBody ?? current?.inquiry.translatedBody ?? null,
        },
      }));
      setDraft(payload.reply.draftText);
      await reloadTasks({
        nextSelectedTaskId: selectedTaskId,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存草稿失败。");
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <>
      <div className="head-row">
        <div>
          <div className="eyebrow">AI 首响审批</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            本地 Qwen 起草 · 人工审阅后发送
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            左侧看客户询盘与机器翻译，右侧编辑草稿，再决定拒绝或发送。
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
              setDetailLoading(false);
              setDetail(null);
              setDraft("");
              setSelectedTenantId(event.target.value);
              setSelectedTaskId("");
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

      <div className="split" style={{ gridTemplateColumns: "0.85fr 1.15fr" }}>
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
              onClick={() => {
                setDetailLoading(true);
                setSelectedTaskId(task.id);
              }}
            >
              <div className="ic local">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M4 4h16v12H5.2L4 18z" />
                </svg>
              </div>
              <div className="grow">
                <div className="t">
                  {titleOfTask(task, task.id === selectedTaskId ? detail : null)}
                </div>
                <div className="m">{previewOfTask(task, task.id === selectedTaskId ? detail : null)}</div>
                <div className="m">{formatTime(task.createdAt)}</div>
              </div>
              {task.id === selectedTaskId ? <span className="badge good">当前</span> : null}
            </div>
          ))}
          {!loading && tasks.length === 0 ? (
            <div className="empty" style={{ padding: "28px 12px" }}>
              <div className="t">暂无待发送的首响草稿</div>
              <div className="s">可从 CRM 里的“用 AI 起草首响”按钮进入这条闭环。</div>
            </div>
          ) : null}
        </div>

        <div className="reply-grid">
          <div className="card inq">
              <div className="head-row" style={{ marginBottom: 6 }}>
                <h3 style={{ fontSize: 14 }}>客户询盘</h3>
              {activeDetail ? (
                <span className="badge line">
                  {activeDetail.inquiry.sourceType === "email" ? "邮件询盘" : "表单询盘"}
                </span>
              ) : null}
            </div>
            {detailLoading ? (
              <div className="sub" style={{ padding: "10px 0" }}>加载详情中…</div>
            ) : activeDetail ? (
              <>
                <div className="from">
                  <div className="av">{avatarLabel(activeDetail)}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {activeDetail.inquiry.fromName ??
                        activeDetail.inquiry.lead.contactName ??
                        activeDetail.inquiry.lead.companyName ??
                        "匿名询盘"}
                    </div>
                    <div className="sub" style={{ marginTop: 2 }}>
                      {activeDetail.inquiry.fromEmail ??
                        activeDetail.inquiry.lead.contactEmail ??
                        "未留邮箱"}
                      {" · "}
                      {formatTime(activeDetail.inquiry.createdAt)}
                    </div>
                  </div>
                </div>
                <div className="inq-body">
                  {activeDetail.inquiry.subject ? (
                    <p>
                      <b>主题：</b>
                      {activeDetail.inquiry.subject}
                    </p>
                  ) : null}
                  <p style={{ whiteSpace: "pre-wrap" }}>{activeDetail.inquiry.body}</p>
                </div>
                <div className="cite">
                  <b>机器翻译（中文）</b>
                  <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                    {activeDetail.inquiry.translatedBody ?? "翻译暂不可用，已保留原文。"}
                  </div>
                </div>
              </>
            ) : (
              <div className="sub" style={{ padding: "10px 0" }}>从左侧选择一条首响任务。</div>
            )}
          </div>

          <div className="card draft">
            <div className="head-row" style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>AI 首响草稿</div>
              {activeDetail ? <span className="badge local">{activeDetail.route}</span> : null}
            </div>
            {detailLoading ? (
              <div className="sub" style={{ padding: "10px 0" }}>加载草稿中…</div>
            ) : activeDetail ? (
              <>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="draft-box"
                  style={{
                    width: "100%",
                    minHeight: 180,
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                  placeholder="编辑首响草稿"
                  disabled={!canActOnReply || saveBusy}
                />
                {activeDetail.citations.length > 0 ? (
                  <div className="cite">
                    <b>知识引用</b>
                    <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                      {activeDetail.citations.map((citation, index) => (
                        <div key={`${citation.sourceCitation ?? "cite"}-${index}`}>
                          <div style={{ fontWeight: 600 }}>
                            {citation.sourceCitation ?? `引用 ${index + 1}`}
                          </div>
                          {citation.excerpt ? (
                            <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                              {citation.excerpt}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="hitl" style={{ marginTop: 14 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v5M12 16h.01" />
                  </svg>
                  <div className="grow">
                    <div className="t">发送前需人工确认</div>
                    <div className="m">
                      最近更新 {formatTime(activeDetail.updatedAt)}
                      {activeDetail.sentAt ? ` · 已发送 ${formatTime(activeDetail.sentAt)}` : ""}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={
                      !canActOnReply ||
                      saveBusy ||
                      !draft.trim() ||
                      draft.trim() === activeDetail.draftText
                    }
                    onClick={() => void saveDraft()}
                  >
                    {saveBusy ? "保存中…" : "保存编辑"}
                  </button>
                  {activeDetail.hitlTaskId ? (
                    <HitlAction
                      tenantId={selectedTenantId}
                      endpoint={`/api/replies/${activeDetail.id}/reject`}
                      idleLabel="拒绝发送"
                      busyLabel="拒绝中…"
                      variant="secondary"
                      disabled={!canActOnReply}
                      body={{}}
                      onError={(message) => setError(message || null)}
                      onSuccess={async () => {
                        await reloadTasks();
                        setDetail(null);
                        setDraft("");
                      }}
                    />
                  ) : null}
                  {selectedTask ? (
                    <HitlAction
                      tenantId={selectedTenantId}
                      endpoint={`/api/hitl/${selectedTask.id}/approve`}
                      idleLabel="确认并发送"
                      busyLabel="发送中…"
                      disabled={!canActOnReply}
                      onError={(message) => setError(message || null)}
                      onSuccess={async () => {
                        await reloadTasks();
                        setDetail(null);
                        setDraft("");
                      }}
                    />
                  ) : null}
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
          客户姓名、邮箱、询盘正文属隐私数据，<b>只在本地 Qwen 处理</b>
          。首响草稿允许销售人工编辑，但发送仍需显式确认。
        </div>
      </div>
    </>
  );
}
