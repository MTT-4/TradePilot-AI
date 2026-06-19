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
    <main className="min-h-screen bg-[linear-gradient(180deg,#faf7ee_0%,#eee4d1_100%)] px-4 py-6 md:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <section className="rounded-[30px] border border-[#ddd3bd] bg-white/92 p-6 shadow-[0_22px_90px_rgba(50,41,22,0.08)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#2c6d56]">
                T6.2 / HITL
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#1f241f] md:text-4xl">
                统一审批中心
              </h1>
              <p className="mt-2 text-sm leading-7 text-[#655f52]">
                站点上线、内容发布、首响发送统一在这里处理，并跳转回各自模块继续操作。
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
            <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">站点待批</div>
            <div className="mt-4 text-4xl font-semibold text-[#1f241f]">
              {tasks.filter((task) => task.type === "site_publish").length}
            </div>
          </div>
          <div className="rounded-[26px] border border-[#ddd3bd] bg-white/90 p-5">
            <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">内容待批</div>
            <div className="mt-4 text-4xl font-semibold text-[#1f241f]">
              {tasks.filter((task) => task.type === "content_publish").length}
            </div>
          </div>
          <div className="rounded-[26px] border border-[#ddd3bd] bg-white/90 p-5">
            <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">首响待批</div>
            <div className="mt-4 text-4xl font-semibold text-[#1f241f]">
              {tasks.filter((task) => task.type === "reply_send").length}
            </div>
          </div>
        </section>

        <section className="rounded-[30px] border border-[#ddd3bd] bg-white/90 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#1f241f]">待处理任务</h2>
            <span className="text-xs text-[#6a6457]">{loading ? "加载中…" : `${tasks.length} 条`}</span>
          </div>
          <div className="space-y-3">
            {tasks.map((task) => (
              <div key={task.id} className="rounded-[24px] border border-[#ece5d3] bg-[#fffdf8] p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <Link href={resolveTaskHref(task)} className="text-lg font-semibold text-[#1f241f]">
                      {formatTaskType(task.type)}
                    </Link>
                    <div className="mt-2 text-sm leading-6 text-[#655f52]">
                      {formatTaskDetail(task)} · {task.entityType} / {task.entityId}
                    </div>
                    <div className="mt-2 text-xs text-[#7b745f]">
                      创建时间：{formatTime(task.createdAt)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Link
                      href={resolveTaskHref(task)}
                      className="rounded-full border border-[#ddd3bd] bg-white px-4 py-2 text-sm text-[#1f241f]"
                    >
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
                      <span className="rounded-full border border-[#ddd3bd] px-4 py-2 text-sm text-[#6a6457]">
                        当前角色无权审批
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {!tasks.length ? (
              <div className="rounded-2xl border border-dashed border-[#ddd3bd] bg-[#faf6eb] px-4 py-5 text-sm text-[#6a6457]">
                当前没有待处理审批。
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
