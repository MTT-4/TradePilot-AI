"use client";

import { useEffect, useState } from "react";
import { roleLabel, sensitivityLabel, statusLabel } from "@/app/_lib/labels";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";

type ReviewItem = {
  id: string;
  question: string;
  answer: string;
  rawAnswer: string;
  correctedText: string | null;
  sourceCitation: string | null;
  sensitivity: "public" | "internal_only";
  status: "pending" | "approved" | "corrected";
  createdAt: string;
  updatedAt: string;
  document: {
    id: string;
    title: string;
    locale: string;
    sourceLabel: string | null;
    sourceType: string;
  };
  chunk: {
    id: string;
    chunkIndex: number;
    text: string;
  } | null;
  reviewedBy: {
    id: string;
    name: string | null;
    email: string;
  } | null;
};

type ReviewsResponse = {
  summary: {
    documentsCount: number;
    cardsCount: number;
    approvedCount: number;
    languagesCount: number;
    internalOnlyCount: number;
  };
  items: ReviewItem[];
};

type KnowledgeDocument = {
  id: string;
  title: string;
  sourceType: string;
  status: string;
  sensitivity: "public" | "internal_only";
  locale: string;
};

type KnowledgeSearchHit = {
  id: string;
  text: string;
  sourceCitation: string | null;
  sensitivity: string;
  score: number;
};

const summaryCards = [
  {
    key: "documentsCount",
    label: "文档数",
  },
  {
    key: "cardsCount",
    label: "知识卡片",
  },
  {
    key: "approvedCount",
    label: "已核准",
  },
  {
    key: "languagesCount",
    label: "语言数",
  },
  {
    key: "internalOnlyCount",
    label: "仅内部",
  },
] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function roleAllowsReview(role: string | undefined) {
  return role === "owner" || role === "admin" || role === "operator";
}

export function ReviewsClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [reviews, setReviews] = useState<ReviewsResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "corrected">("pending");
  const [loading, setLoading] = useState(true);
  const [submittingReviewId, setSubmittingReviewId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { correctedText: string; sensitivity: "public" | "internal_only" }>>({});
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [retryBusyId, setRetryBusyId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<KnowledgeSearchHit[] | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

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

        if (!active) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "加载当前用户失败。");
        setLoading(false);
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

    async function loadReviews() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/kb/reviews?status=${statusFilter}`, {
          headers: {
            "X-Tenant-Id": selectedTenantId,
          },
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error?.message ?? "加载审核卡片失败。");
        }

        const payload = (await response.json()) as ReviewsResponse;

        if (!active) {
          return;
        }

        setReviews(payload);
        setDrafts((current) => {
          const next = { ...current };

          for (const item of payload.items) {
            next[item.id] ??= {
              correctedText: item.correctedText ?? item.answer,
              sensitivity: item.sensitivity,
            };
          }

          return next;
        });
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "加载审核卡片失败。");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadReviews();
    void loadDocuments();

    return () => {
      active = false;
    };
    // loadDocuments 仅依赖 selectedTenantId（已在依赖内），无需重复声明
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId, statusFilter]);

  const currentTenant = me?.memberships.find(
    (membership) => membership.tenantId === selectedTenantId,
  ) ?? null;

  async function loadDocuments() {
    if (!selectedTenantId) {
      return;
    }
    try {
      const response = await fetch("/api/kb/documents", {
        headers: { "X-Tenant-Id": selectedTenantId },
      });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { items: KnowledgeDocument[] };
      setDocuments(payload.items ?? []);
    } catch {
      // 文档列表加载失败不阻塞审核区
    }
  }

  async function handleUpload(file: File) {
    if (!selectedTenantId || !file) {
      return;
    }
    setUploadBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/kb/documents", {
        method: "POST",
        headers: { "X-Tenant-Id": selectedTenantId },
        body: formData,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "上传失败。");
      }
      await loadDocuments();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传失败。");
    } finally {
      setUploadBusy(false);
    }
  }

  async function retryDocument(documentId: string) {
    if (!selectedTenantId) {
      return;
    }
    setRetryBusyId(documentId);
    setError(null);
    try {
      const response = await fetch(`/api/kb/documents/${documentId}/retry`, {
        method: "POST",
        headers: { "X-Tenant-Id": selectedTenantId },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "重试失败。");
      }
      await loadDocuments();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "重试失败。");
    } finally {
      setRetryBusyId(null);
    }
  }

  async function runSearch() {
    if (!selectedTenantId || !searchQuery.trim()) {
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const response = await fetch("/api/kb/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify({ query: searchQuery.trim() }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "检索失败。");
      }
      const payload = (await response.json()) as {
        items: KnowledgeSearchHit[];
        message: string | null;
      };
      setSearchResults(payload.items ?? []);
      setSearchMessage(payload.message ?? null);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "检索失败。");
    } finally {
      setSearching(false);
    }
  }

  async function submitReview(params: {
    reviewId: string;
    action: "approve" | "correct";
  }) {
    if (!selectedTenantId) {
      return;
    }

    const draft = drafts[params.reviewId];
    setSubmittingReviewId(params.reviewId);
    setError(null);

    try {
      const response = await fetch(`/api/kb/reviews/${params.reviewId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify({
          action: params.action,
          correctedText:
            params.action === "correct" ? draft?.correctedText ?? "" : undefined,
          sensitivity: draft?.sensitivity,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "提交审核失败。");
      }

      const refreshed = await fetch(`/api/kb/reviews?status=${statusFilter}`, {
        headers: {
          "X-Tenant-Id": selectedTenantId,
        },
      });

      if (!refreshed.ok) {
        throw new Error("刷新审核卡片失败。");
      }

      setReviews((await refreshed.json()) as ReviewsResponse);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交审核失败。");
    } finally {
      setSubmittingReviewId(null);
    }
  }

  return (
    <>
      <div className="head-row">
        <div>
          <div className="eyebrow">知识库 · 审核</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            公司知识 · AI 一切内容的事实来源
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            {roleAllowsReview(currentTenant?.role)
              ? "确认 AI 提炼是否准确，标可公开 / 仅内部，可溯源"
              : "当前角色只可查看，不可提交审核动作"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {me && me.memberships.length > 0 ? (
            <select
              className="btn ghost sm"
              value={selectedTenantId}
              onChange={(event) => setSelectedTenantId(event.target.value)}
            >
              {me.memberships.map((membership) => (
                <option key={membership.tenantId} value={membership.tenantId}>
                  {membership.tenantName} · {roleLabel(membership.role)}
                </option>
              ))}
            </select>
          ) : null}
          <select
            className="btn ghost sm"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as "pending" | "approved" | "corrected")
            }
          >
            <option value="pending">待审核</option>
            <option value="approved">已核准</option>
            <option value="corrected">已修正</option>
          </select>
        </div>
      </div>

      {reviews ? (
        <div className="stat-strip" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
          {summaryCards.map((card) => (
            <div className="stat" key={card.key}>
              <div className="v">{reviews.summary[card.key]}</div>
              <div className="l">{card.label}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid-2" style={{ gridTemplateColumns: "1.4fr 1fr", marginBottom: 18 }}>
        <div className="card" style={{ padding: 18 }}>
          <label
            className="drop"
            style={{ cursor: uploadBusy ? "wait" : "pointer", display: "block" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 16V4M8 8l4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            <div className="t">
              {uploadBusy ? "上传中…" : "把产品手册 / 报价单 / 认证 / 案例拖进来或点击选择"}
            </div>
            <div className="s">支持 PDF / Word / Excel · 自动解析切块 · 本地向量化</div>
            <input
              type="file"
              style={{ display: "none" }}
              disabled={uploadBusy || !roleAllowsReview(currentTenant?.role)}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void handleUpload(file);
                }
                event.target.value = "";
              }}
            />
          </label>

          <h4 style={{ fontSize: 14, margin: "16px 0 8px" }}>已入库文档</h4>
          {documents.map((document) => (
            <div className="row-card" key={document.id}>
              <div className="afi">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M14 3v5h5M7 3h7l5 5v13H7z" />
                </svg>
              </div>
              <div className="grow">
                <div className="nm">
                  {document.title}
                  <span>
                    {document.locale.toUpperCase()} ·{" "}
                    {sensitivityLabel(document.sensitivity)}
                  </span>
                </div>
              </div>
              <span className={`st ${document.status}`}>{statusLabel(document.status)}</span>
              {document.status === "failed" ? (
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={retryBusyId === document.id}
                  onClick={() => void retryDocument(document.id)}
                >
                  {retryBusyId === document.id ? "重试中…" : "重试"}
                </button>
              ) : null}
            </div>
          ))}
          {documents.length === 0 ? (
            <div className="sub" style={{ padding: "10px 0" }}>还没有文档，先上传资料。</div>
          ) : null}
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h4 style={{ fontSize: 14, marginBottom: 8 }}>知识库检索（仅公开）</h4>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void runSearch();
                }
              }}
              placeholder="输入问题，检索可公开知识"
              style={{
                flex: 1,
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: "10px 13px",
                fontSize: 13,
                background: "var(--surface-2)",
              }}
            />
            <button
              type="button"
              className="btn primary sm"
              disabled={searching || !searchQuery.trim()}
              onClick={() => void runSearch()}
            >
              {searching ? "检索中…" : "检索"}
            </button>
          </div>
          {searchMessage ? (
            <div className="sub" style={{ marginTop: 10 }}>{searchMessage}</div>
          ) : null}
          <div style={{ marginTop: 10 }}>
            {(searchResults ?? []).map((hit) => (
              <div
                key={hit.id}
                style={{ borderTop: "1px solid var(--line-2)", paddingTop: 10, marginTop: 10 }}
              >
                <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>{hit.text}</div>
                <div className="sub" style={{ marginTop: 4 }}>
                  {hit.sourceCitation ?? "无引用"} · 相关度 {hit.score}
                </div>
              </div>
            ))}
            {searchResults && searchResults.length === 0 && !searchMessage ? (
              <div className="sub" style={{ marginTop: 10 }}>未检索到可公开的匹配内容。</div>
            ) : null}
          </div>
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

      <div className="head-row" style={{ marginBottom: 10 }}>
        <div>
          <div className="eyebrow">待审核知识卡片</div>
          <h3 style={{ fontSize: 16, marginTop: 3 }}>确认 AI 提炼 · 修正 · 标敏感级</h3>
        </div>
        {loading ? <span className="badge line">加载中…</span> : null}
      </div>

      {!loading && reviews?.items.length === 0 ? (
        <div className="card empty">
          <div className="t">当前没有符合条件的审核卡片</div>
          <div className="s">
            先上传产品手册、报价单或 FAQ 文档，系统会自动生成待审核知识卡片。
          </div>
        </div>
      ) : null}

      <div className="grid-2">
        {reviews?.items.map((item) => {
          const draft = drafts[item.id] ?? {
            correctedText: item.correctedText ?? item.answer,
            sensitivity: item.sensitivity,
          };
          const canSubmit =
            roleAllowsReview(currentTenant?.role) && submittingReviewId !== item.id;

          return (
            <div className="card" style={{ padding: 18 }} key={item.id}>
              <div className="head-row" style={{ marginBottom: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 6 }}>
                    <span className={`st ${item.status}`}>{statusLabel(item.status)}</span>
                    <span
                      className={`badge ${item.sensitivity === "internal_only" ? "local" : "line"}`}
                    >
                      {item.sensitivity === "internal_only" ? "仅内部" : "可公开"}
                    </span>
                    <span className="badge line">{item.document.locale}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{item.document.title}</div>
                  <div className="sub" style={{ marginTop: 3 }}>
                    {item.question} · {item.document.sourceType}
                  </div>
                </div>
                <div className="sub" style={{ textAlign: "right", flex: "none" }}>
                  <div>{formatDate(item.updatedAt)}</div>
                  <div>{item.reviewedBy?.name ?? item.reviewedBy?.email ?? "待审核"}</div>
                </div>
              </div>

              <div className="inq-body" style={{ marginBottom: 10 }}>
                <div className="sub" style={{ marginBottom: 4 }}>原始提炼</div>
                {item.rawAnswer}
              </div>

              <div
                className="inq-body"
                style={{ marginBottom: 10, background: "var(--teal-tint)", borderColor: "var(--teal-soft)" }}
              >
                <div className="sub" style={{ marginBottom: 4 }}>来源溯源</div>
                {item.sourceCitation ?? item.document.sourceLabel ?? "未提供来源引用"}
                {item.chunk ? (
                  <div className="sub" style={{ marginTop: 6 }}>chunk #{item.chunk.chunkIndex + 1}</div>
                ) : null}
              </div>

              <div className="field" style={{ marginBottom: 10 }}>
                <label>修正文案</label>
                <textarea
                  value={draft.correctedText}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [item.id]: {
                        ...draft,
                        correctedText: event.target.value,
                      },
                    }))
                  }
                  style={{
                    width: "100%",
                    minHeight: 110,
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    padding: "10px 13px",
                    fontFamily: "inherit",
                    fontSize: 13,
                    lineHeight: 1.6,
                    background: "var(--surface-2)",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <select
                  className="btn ghost sm"
                  value={draft.sensitivity}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [item.id]: {
                        ...draft,
                        sensitivity: event.target.value as "public" | "internal_only",
                      },
                    }))
                  }
                >
                  <option value="public">可公开</option>
                  <option value="internal_only">仅内部</option>
                </select>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={!canSubmit}
                    onClick={() => void submitReview({ reviewId: item.id, action: "correct" })}
                  >
                    {submittingReviewId === item.id ? "提交中…" : "修正保存"}
                  </button>
                  <button
                    type="button"
                    className="btn primary sm"
                    disabled={!canSubmit}
                    onClick={() => void submitReview({ reviewId: item.id, action: "approve" })}
                  >
                    {submittingReviewId === item.id ? "提交中…" : "核准"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
