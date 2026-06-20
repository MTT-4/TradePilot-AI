"use client";

import { useEffect, useRef, useState } from "react";
import { statusLabel } from "@/app/_lib/labels";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";

type JobItem = {
  id: string;
  type: string;
  status: string;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  requestedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

type JobsResponse = {
  items: JobItem[];
};

type JobDetailResponse = {
  status: string;
  progress: number;
  error: string | null;
  type: string;
  attempts: number;
  maxAttempts: number;
  output: Record<string, unknown> | null;
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatJobType(value: string) {
  switch (value) {
    case "parse_document":
      return "文档解析";
    case "embed_document":
      return "文档向量化";
    case "generate_site":
      return "站点生成";
    case "translate_site":
      return "站点翻译";
    case "generate_content_pack":
      return "内容包生成";
    case "generate_reply":
      return "首响生成";
    case "import_inbound_email":
      return "邮件导入";
    default:
      return value;
  }
}

function previewJobPayload(value: Record<string, unknown> | null) {
  if (!value || Object.keys(value).length === 0) {
    return "无附加参数";
  }

  return JSON.stringify(value, null, 2);
}

async function fetchJobs(
  tenantId: string,
  filters: { status: string; type: string },
) {
  const params = new URLSearchParams();
  if (filters.status !== "all") {
    params.set("status", filters.status);
  }
  if (filters.type !== "all") {
    params.set("type", filters.type);
  }
  params.set("limit", "50");

  const response = await fetch(`/api/jobs?${params.toString()}`, {
    headers: {
      "X-Tenant-Id": tenantId,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载任务失败。");
  }

  return (await response.json()) as JobsResponse;
}

async function fetchJobDetail(tenantId: string, jobId: string) {
  const response = await fetch(`/api/jobs/${jobId}`, {
    headers: {
      "X-Tenant-Id": tenantId,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载任务详情失败。");
  }

  return (await response.json()) as JobDetailResponse;
}

export function JobsClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedJobDetail, setSelectedJobDetail] = useState<JobDetailResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedJobIdRef = useRef(selectedJobId);

  useEffect(() => {
    selectedJobIdRef.current = selectedJobId;
  }, [selectedJobId]);

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

    void fetchJobs(selectedTenantId, {
      status: statusFilter,
      type: typeFilter,
    })
      .then((payload) => {
        if (!active) {
          return;
        }

        setError(null);
        setJobs(payload.items);
        const nextJobId =
          selectedJobIdRef.current &&
          payload.items.some((item) => item.id === selectedJobIdRef.current)
            ? selectedJobIdRef.current
            : payload.items[0]?.id ?? "";
        setSelectedJobId(nextJobId);
        setSelectedJobDetail(null);
        setDetailLoading(Boolean(nextJobId));
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载任务失败。");
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
  }, [selectedTenantId, statusFilter, typeFilter]);

  useEffect(() => {
    if (!selectedTenantId || !selectedJobId) {
      return;
    }

    let active = true;

    void fetchJobDetail(selectedTenantId, selectedJobId)
      .then((payload) => {
        if (!active) {
          return;
        }

        setError(null);
        setSelectedJobDetail(payload);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载任务详情失败。");
          setSelectedJobDetail(null);
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
  }, [selectedJobId, selectedTenantId]);

  const selectedJob =
    jobs.find((item) => item.id === selectedJobId) ?? null;

  return (
    <>
      <div className="head-row">
        <div>
          <div className="eyebrow">任务监控</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            队列 · 重试 · 结果回看
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            只读查看后台任务执行状态，优先定位卡住、失败和反复重试的任务。
          </div>
        </div>
        {me && me.memberships.length > 0 ? (
          <select
            className="btn ghost sm"
            value={selectedTenantId}
            onChange={(event) => {
              setLoading(true);
              setSelectedJobId("");
              setSelectedJobDetail(null);
              setDetailLoading(false);
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
          <div className="v">{jobs.length}</div>
          <div className="l">当前列表任务</div>
        </div>
        <div className="stat">
          <div className="v">{jobs.filter((item) => item.status === "running").length}</div>
          <div className="l">运行中</div>
        </div>
        <div className="stat">
          <div className="v">{jobs.filter((item) => item.status === "failed").length}</div>
          <div className="l">失败</div>
        </div>
        <div className="stat">
          <div className="v">{jobs.filter((item) => item.status === "retrying").length}</div>
          <div className="l">重试中</div>
        </div>
      </div>

      <div className="head-row" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            className="btn ghost sm"
            value={statusFilter}
            onChange={(event) => {
              setLoading(true);
              setStatusFilter(event.target.value);
            }}
          >
            <option value="all">全部状态</option>
            <option value="queued">排队中</option>
            <option value="running">运行中</option>
            <option value="retrying">重试中</option>
            <option value="succeeded">已完成</option>
            <option value="failed">失败</option>
          </select>
          <select
            className="btn ghost sm"
            value={typeFilter}
            onChange={(event) => {
              setLoading(true);
              setTypeFilter(event.target.value);
            }}
          >
            <option value="all">全部类型</option>
            <option value="generate_site">站点生成</option>
            <option value="generate_content_pack">内容包生成</option>
            <option value="generate_reply">首响生成</option>
            <option value="parse_document">文档解析</option>
            <option value="embed_document">文档向量化</option>
            <option value="translate_site">站点翻译</option>
            <option value="import_inbound_email">邮件导入</option>
          </select>
        </div>
        <span className="badge line">最新 50 条</span>
      </div>

      <div className="split" style={{ gridTemplateColumns: "0.95fr 1.05fr" }}>
        <div className="card" style={{ padding: "8px 18px" }}>
          <div className="head-row" style={{ marginBottom: 6, paddingTop: 10 }}>
            <h3 style={{ fontSize: 15 }}>任务队列</h3>
            <span className="badge manual">{loading ? "…" : jobs.length}</span>
          </div>

          {jobs.map((job) => (
            <div
              className="row-card"
              key={job.id}
              style={{
                margin: "0 0 10px",
                cursor: "pointer",
                borderColor: job.id === selectedJobId ? "var(--teal)" : undefined,
              }}
              onClick={() => {
                setDetailLoading(true);
                setSelectedJobId(job.id);
              }}
            >
              <div className="grow">
                <div className="nm">
                  {formatJobType(job.type)}
                  <span>{formatTime(job.createdAt)}</span>
                </div>
                <div className="sub" style={{ marginTop: 4 }}>
                  {statusLabel(job.status)} · {job.progress}% · {job.attempts}/{job.maxAttempts} 次
                </div>
                <div className="jobbar" style={{ marginTop: 8 }}>
                  <i style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} />
                </div>
                {job.error ? (
                  <div className="sub" style={{ marginTop: 8, color: "var(--warn)" }}>
                    {job.error}
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {!loading && jobs.length === 0 ? (
            <div className="empty" style={{ padding: "28px 12px" }}>
              <div className="t">当前条件下没有任务</div>
              <div className="s">切换状态或类型筛选后再看。</div>
            </div>
          ) : null}
        </div>

        <div className="card" style={{ padding: "14px 18px" }}>
          <div className="head-row" style={{ marginBottom: 8 }}>
            <div>
              <h3 style={{ fontSize: 15 }}>任务详情</h3>
              <div className="sub" style={{ marginTop: 4 }}>
                输入参数、执行进度、输出结果
              </div>
            </div>
            {selectedJob ? (
              <span className={`badge ${selectedJob.status === "failed" ? "manual" : "line"}`}>
                {statusLabel(selectedJob.status)}
              </span>
            ) : null}
          </div>

          {detailLoading ? (
            <div className="sub">加载详情中…</div>
          ) : selectedJob ? (
            <div style={{ display: "grid", gap: 14 }}>
              <div className="card" style={{ padding: "12px 14px" }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{formatJobType(selectedJob.type)}</div>
                <div className="sub" style={{ marginTop: 6 }}>
                  创建于 {formatTime(selectedJob.createdAt)} · 最近更新 {formatTime(selectedJob.updatedAt)}
                </div>
                <div className="jobbar" style={{ marginTop: 10 }}>
                  <i
                    style={{
                      width: `${Math.max(0, Math.min(100, selectedJobDetail?.progress ?? selectedJob.progress))}%`,
                    }}
                  />
                </div>
                <div className="sub" style={{ marginTop: 8 }}>
                  进度 {selectedJobDetail?.progress ?? selectedJob.progress}% · 尝试{" "}
                  {selectedJobDetail?.attempts ?? selectedJob.attempts}/
                  {selectedJobDetail?.maxAttempts ?? selectedJob.maxAttempts}
                </div>
              </div>

              <div className="card" style={{ padding: "12px 14px" }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>输入参数</div>
                <pre
                  style={{
                    margin: "8px 0 0",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    color: "var(--ink-2)",
                  }}
                >
                  {previewJobPayload(selectedJob.input)}
                </pre>
              </div>

              <div className="card" style={{ padding: "12px 14px" }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>输出结果</div>
                <pre
                  style={{
                    margin: "8px 0 0",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    color: "var(--ink-2)",
                  }}
                >
                  {previewJobPayload(selectedJobDetail?.output ?? selectedJob.output)}
                </pre>
              </div>

              {(selectedJobDetail?.error ?? selectedJob.error) ? (
                <div
                  className="card"
                  style={{
                    padding: "12px 14px",
                    borderColor: "var(--warn-soft)",
                    background: "var(--warn-soft)",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--warn)" }}>失败信息</div>
                  <div style={{ marginTop: 8, whiteSpace: "pre-wrap", fontSize: 12.5, color: "var(--warn)" }}>
                    {selectedJobDetail?.error ?? selectedJob.error}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="sub">从左侧选择一条任务查看详情。</div>
          )}
        </div>
      </div>
    </>
  );
}
