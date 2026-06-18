"use client";

import { useEffect, useState } from "react";

type Membership = {
  tenantId: string;
  role: string;
  status: string;
  tenantName: string;
  tenantSlug: string;
  defaultLocale: string;
};

type MeResponse = {
  user: {
    id: string;
    email: string;
    name: string;
    twoFactorEnabled: boolean;
  };
  memberships: Membership[];
  currentTenant: Membership | null;
};

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

  useEffect(() => {
    let active = true;

    async function loadMe() {
      try {
        const response = await fetch("/api/me");

        if (!response.ok) {
          throw new Error("请先登录并完成 2FA。");
        }

        const payload = (await response.json()) as MeResponse;

        if (!active) {
          return;
        }

        setMe(payload);
        setSelectedTenantId(payload.currentTenant?.tenantId ?? payload.memberships[0]?.tenantId ?? "");
      } catch (loadError) {
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

    return () => {
      active = false;
    };
  }, [selectedTenantId, statusFilter]);

  const currentTenant = me?.memberships.find(
    (membership) => membership.tenantId === selectedTenantId,
  ) ?? null;

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
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-8 md:px-10">
      <section className="overflow-hidden rounded-[32px] border border-border bg-surface-strong shadow-[0_20px_80px_rgba(31,36,31,0.08)]">
        <div className="grid gap-8 p-8 md:grid-cols-[1.2fr_0.8fr] md:p-10">
          <div className="space-y-5">
            <p className="font-mono text-sm uppercase tracking-[0.24em] text-accent">
              T1.5 Knowledge Review
            </p>
            <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
                知识审核页
              </h1>
              <p className="max-w-3xl text-base leading-7 text-muted">
                审核 AI 提炼出的知识卡片，标记可公开或仅内部，必要时直接修正文本并保留溯源。
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="rounded-full bg-accent px-4 py-2 font-mono text-white">
                /kb/reviews
              </span>
              <span className="rounded-full border border-border bg-white/70 px-4 py-2">
                /api/kb/reviews
              </span>
              <span className="rounded-full border border-border bg-white/70 px-4 py-2">
                /api/kb/reviews/:id
              </span>
            </div>
          </div>

          <div className="rounded-[28px] border border-border bg-[#1f241f] p-6 text-[#f5f2e8]">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-[#c9ebe6]">
                Tenant Context
              </span>
              <span className="rounded-full bg-[#29443f] px-3 py-1 font-mono text-xs">
                Operator+
              </span>
            </div>
            <div className="space-y-4 text-sm text-[#d7d1c4]">
              <div>
                <p className="text-[#f5f2e8]">当前租户</p>
                <p>{currentTenant?.tenantName ?? "未选择租户"}</p>
              </div>
              <div>
                <p className="text-[#f5f2e8]">角色</p>
                <p>{currentTenant?.role ?? "未登录"}</p>
              </div>
              <div>
                <p className="text-[#f5f2e8]">审核说明</p>
                <p>无依据时不放行；敏感内容仅内部；修正后仍保留来源引用。</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-[1fr_auto_auto]">
        <div className="rounded-[24px] border border-border bg-surface p-4">
          <label className="mb-2 block text-sm font-medium text-muted">租户</label>
          <select
            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none"
            value={selectedTenantId}
            onChange={(event) => setSelectedTenantId(event.target.value)}
          >
            {me?.memberships.map((membership) => (
              <option key={membership.tenantId} value={membership.tenantId}>
                {membership.tenantName} · {membership.role}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-[24px] border border-border bg-surface p-4">
          <label className="mb-2 block text-sm font-medium text-muted">审核状态</label>
          <select
            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none"
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

        <div className="rounded-[24px] border border-border bg-surface p-4 text-sm text-muted">
          <p className="mb-2 font-medium text-foreground">权限提示</p>
          <p>
            {roleAllowsReview(currentTenant?.role)
              ? "当前角色可以审核与修正。"
              : "当前角色只可查看，不可提交审核动作。"}
          </p>
        </div>
      </section>

      {reviews ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {summaryCards.map((card) => (
            <article
              key={card.key}
              className="rounded-[24px] border border-border bg-surface px-5 py-6"
            >
              <p className="mb-2 text-sm text-muted">{card.label}</p>
              <p className="text-3xl font-semibold tracking-tight">
                {reviews.summary[card.key]}
              </p>
            </article>
          ))}
        </section>
      ) : null}

      {error ? (
        <section className="rounded-[24px] border border-[#d27d62] bg-[#fff3ed] px-5 py-4 text-sm text-[#9a4024]">
          {error}
        </section>
      ) : null}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold">审核卡片</h2>
            <p className="text-sm text-muted">
              确认、修正、标敏感级，所有动作都保留溯源。
            </p>
          </div>
          {loading ? (
            <span className="rounded-full border border-border bg-white/70 px-4 py-2 font-mono text-xs uppercase tracking-[0.2em] text-muted">
              Loading
            </span>
          ) : null}
        </div>

        {!loading && reviews?.items.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-border bg-surface px-8 py-12 text-center">
            <p className="text-xl font-medium">当前没有符合条件的审核卡片</p>
            <p className="mt-3 text-sm leading-7 text-muted">
              先上传产品手册、报价单或 FAQ 文档，系统会自动生成待审核知识卡片。
            </p>
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          {reviews?.items.map((item) => {
            const draft = drafts[item.id] ?? {
              correctedText: item.correctedText ?? item.answer,
              sensitivity: item.sensitivity,
            };
            const canSubmit =
              roleAllowsReview(currentTenant?.role) && submittingReviewId !== item.id;

            return (
              <article
                key={item.id}
                className="rounded-[28px] border border-border bg-surface p-6 shadow-[0_12px_40px_rgba(31,36,31,0.06)]"
              >
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-accent-soft px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-accent">
                        {item.status}
                      </span>
                      <span className="rounded-full border border-border bg-white px-3 py-1 font-mono text-xs uppercase tracking-[0.18em]">
                        {item.sensitivity}
                      </span>
                      <span className="rounded-full border border-border bg-white px-3 py-1 text-xs">
                        {item.document.locale}
                      </span>
                    </div>
                    <h3 className="text-xl font-semibold">{item.document.title}</h3>
                    <p className="text-sm text-muted">
                      {item.question} · {item.document.sourceType}
                    </p>
                  </div>

                  <div className="text-right text-xs text-muted">
                    <p>{formatDate(item.updatedAt)}</p>
                    <p>{item.reviewedBy?.name ?? item.reviewedBy?.email ?? "待审核"}</p>
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="rounded-[24px] border border-border bg-white/80 p-4">
                    <p className="mb-2 text-xs font-mono uppercase tracking-[0.18em] text-muted">
                      原始提炼
                    </p>
                    <p className="text-sm leading-7 text-foreground">{item.rawAnswer}</p>
                  </div>

                  <div className="rounded-[24px] border border-border bg-[#f8f5ee] p-4">
                    <p className="mb-2 text-xs font-mono uppercase tracking-[0.18em] text-muted">
                      来源溯源
                    </p>
                    <p className="text-sm leading-7 text-foreground">
                      {item.sourceCitation ?? item.document.sourceLabel ?? "未提供来源引用"}
                    </p>
                    {item.chunk ? (
                      <p className="mt-2 text-xs text-muted">
                        chunk #{item.chunk.chunkIndex + 1}
                      </p>
                    ) : null}
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-xs font-mono uppercase tracking-[0.18em] text-muted">
                      修正文案
                    </span>
                    <textarea
                      className="min-h-36 w-full rounded-[22px] border border-border bg-white px-4 py-3 text-sm leading-7 outline-none"
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
                    />
                  </label>

                  <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                    <label className="block">
                      <span className="mb-2 block text-xs font-mono uppercase tracking-[0.18em] text-muted">
                        敏感级
                      </span>
                      <select
                        className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm outline-none"
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
                    </label>

                    <button
                      type="button"
                      className="rounded-2xl border border-border bg-white px-5 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!canSubmit}
                      onClick={() =>
                        void submitReview({
                          reviewId: item.id,
                          action: "correct",
                        })
                      }
                    >
                      {submittingReviewId === item.id ? "提交中..." : "修正保存"}
                    </button>

                    <button
                      type="button"
                      className="rounded-2xl bg-accent px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!canSubmit}
                      onClick={() =>
                        void submitReview({
                          reviewId: item.id,
                          action: "approve",
                        })
                      }
                    >
                      {submittingReviewId === item.id ? "提交中..." : "标记已核准"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
