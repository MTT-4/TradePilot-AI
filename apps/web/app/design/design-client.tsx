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

  const currentMembership =
    me?.memberships.find((item) => item.tenantId === selectedTenantId) ?? null;

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
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbf8f0_0%,#efe5d2_100%)] px-4 py-6 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="rounded-[30px] border border-[#ddd3bd] bg-white/92 p-6 shadow-[0_22px_90px_rgba(50,41,22,0.08)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#2c6d56]">
                T6.1 / Design
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#1f241f] md:text-4xl">
                内容发布队列
              </h1>
              <p className="mt-2 text-sm leading-7 text-[#655f52]">
                内容不再直接改成已发，先发起审批请求，再由 HITL 统一确认。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/"
                className="rounded-full border border-[#ddd3bd] bg-white px-4 py-2 text-sm text-[#1f241f]"
              >
                返回工作台
              </Link>
              <select
                className="rounded-full border border-[#ddd3bd] bg-white px-4 py-2 text-sm"
                value={selectedTenantId}
                onChange={(event) => {
                  setLoading(true);
                  setSelectedTenantId(event.target.value);
                }}
              >
                {me?.memberships.map((membership) => (
                  <option key={membership.tenantId} value={membership.tenantId}>
                    {membership.tenantName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {error ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-[26px] border border-[#ddd3bd] bg-white/90 p-5">
            <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">全部内容</div>
            <div className="mt-4 text-4xl font-semibold text-[#1f241f]">{items.length}</div>
          </div>
          <div className="rounded-[26px] border border-[#ddd3bd] bg-white/90 p-5">
            <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">审批中</div>
            <div className="mt-4 text-4xl font-semibold text-[#1f241f]">{pendingCount}</div>
          </div>
          <div className="rounded-[26px] border border-[#ddd3bd] bg-white/90 p-5">
            <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">待发布</div>
            <div className="mt-4 text-4xl font-semibold text-[#1f241f]">
              {items.filter((item) => item.publishStatus === "pending").length}
            </div>
          </div>
        </section>

        <section className="rounded-[30px] border border-[#ddd3bd] bg-white/90 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#1f241f]">内容卡片</h2>
            <span className="text-xs text-[#6a6457]">{loading ? "加载中…" : `${items.length} 条`}</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {items.map((item) => (
              <article key={item.id} className="rounded-[24px] border border-[#ece5d3] bg-[#fffdf8] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">
                      {item.platform.toUpperCase()} · {item.mediaType}
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-[#1f241f]">{item.title}</h2>
                    <div className="mt-2 text-sm text-[#655f52]">
                      {item.contentPackTitle} · 状态 {item.publishStatus}
                    </div>
                  </div>
                  {item.publishRequestPending ? (
                    <span className="rounded-full bg-[#f1f8f3] px-3 py-1 text-xs text-[#2c6d56]">
                      审批中
                    </span>
                  ) : null}
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    href={item.editUrl}
                    className="rounded-full border border-[#ddd3bd] bg-white px-4 py-2 text-sm text-[#1f241f]"
                  >
                    打开内容包
                  </Link>
                  {item.publishStatus === "published" ? (
                    <span className="rounded-full border border-[#ddd3bd] px-4 py-2 text-sm text-[#6a6457]">
                      已发布
                    </span>
                  ) : item.publishRequestPending ? (
                    <Link
                      href="/hitl"
                      className="rounded-full border border-[#ddd3bd] bg-white px-4 py-2 text-sm text-[#1f241f]"
                    >
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
                </div>
              </article>
            ))}
            {!items.length ? (
              <div className="rounded-2xl border border-dashed border-[#ddd3bd] bg-[#faf6eb] px-4 py-5 text-sm text-[#6a6457]">
                当前没有内容数据。
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
