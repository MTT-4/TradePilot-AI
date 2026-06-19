"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";

type DataRequestItem = {
  id: string;
  type: string;
  status: string;
  scope: Record<string, unknown> | null;
  requestedByUserId: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type DataRequestsResponse = {
  items: DataRequestItem[];
};

const ADMIN_ROLES = new Set(["owner", "admin"]);

async function fetchDataRequests(tenantId: string) {
  const response = await fetch("/api/data-requests", {
    headers: {
      "X-Tenant-Id": tenantId,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载数据请求失败。");
  }

  return (await response.json()) as DataRequestsResponse;
}

function formatTime(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRequestType(type: string) {
  return type === "delete" ? "删除请求" : "导出请求";
}

function formatRequestStatus(status: string) {
  switch (status) {
    case "pending":
      return "待处理";
    case "processing":
      return "处理中";
    case "completed":
      return "已完成";
    case "rejected":
      return "已拒绝";
    default:
      return status;
  }
}

function readScopeText(scope: Record<string, unknown> | null) {
  if (!scope) {
    return "未附加范围";
  }

  const channel = typeof scope.channel === "string" ? scope.channel.toUpperCase() : "N/A";
  const subjectEmail =
    typeof scope.subjectEmail === "string" ? scope.subjectEmail : "未指定";
  const note = typeof scope.note === "string" && scope.note.trim() ? scope.note.trim() : null;

  return `${channel} · ${subjectEmail}${note ? ` · ${note}` : ""}`;
}

export function SettingsClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [items, setItems] = useState<DataRequestItem[]>([]);
  const [requestType, setRequestType] = useState<"export" | "delete">("export");
  const [channel, setChannel] = useState<"gdpr" | "pipl">("gdpr");
  const [subjectEmail, setSubjectEmail] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const currentMembership =
    me?.memberships.find((item) => item.tenantId === selectedTenantId) ?? null;
  const canManageCompliance = ADMIN_ROLES.has(currentMembership?.role ?? "");

  async function refreshDataRequests(tenantId = selectedTenantId) {
    if (!tenantId) {
      setItems([]);
      setLoading(false);
      return;
    }

    if (!canManageCompliance) {
      return;
    }

    setLoading(true);
    setError(null);

    const payload = await fetchDataRequests(tenantId);
    setItems(payload.items);
    setLoading(false);
  }

  async function handleCreateRequest() {
    if (!selectedTenantId || !subjectEmail.trim()) {
      setError("请填写数据主体邮箱。");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/data-requests", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify({
          type: requestType,
          scope: {
            channel,
            subjectEmail: subjectEmail.trim(),
            note: note.trim() || undefined,
          },
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "创建数据请求失败。");
      }

      setSuccess(
        requestType === "delete"
          ? "删除请求已登记并写入审计日志。"
          : "导出请求已登记并写入审计日志。",
      );
      setSubjectEmail("");
      setNote("");
      await refreshDataRequests();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "创建数据请求失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResolveRequest(requestId: string, status: "completed" | "rejected") {
    if (!selectedTenantId) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/data-requests/${requestId}/complete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "更新数据请求失败。");
      }

      setSuccess(status === "completed" ? "请求已标记完成。" : "请求已拒绝。");
      await refreshDataRequests();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "更新数据请求失败。");
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

    if (!canManageCompliance) {
      return;
    }

    void fetchDataRequests(selectedTenantId)
      .then((payload) => {
        if (!active) {
          return;
        }

        setError(null);
        setItems(payload.items);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载数据请求失败。");
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
  }, [canManageCompliance, selectedTenantId]);

  const pendingCount = items.filter((item) => item.status === "pending").length;
  const completedCount = items.filter((item) => item.status === "completed").length;
  const deleteCount = items.filter((item) => item.type === "delete").length;
  const visibleItems = canManageCompliance ? items : [];
  const visibleLoading = canManageCompliance ? loading : false;

  return (
    <>
      <div className="head-row">
        <div>
          <div className="eyebrow">合规与权限</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            GDPR / PIPL 数据请求与 RBAC 基线
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            管理导出/删除请求，明确谁能审批站点、内容与首响，所有动作都写审计日志。
          </div>
        </div>
        {me && me.memberships.length > 0 ? (
          <select
            className="btn ghost sm"
            value={selectedTenantId}
            onChange={(event) => {
              setLoading(true);
              setSuccess(null);
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

      {success ? (
        <div
          className="card"
          style={{
            padding: "12px 16px",
            marginBottom: 18,
            borderColor: "#cce8dd",
            background: "#effaf5",
            color: "var(--teal-dark)",
            fontSize: 13,
          }}
        >
          {success}
        </div>
      ) : null}

      <div className="stat-strip" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat">
          <div className="v">{pendingCount}</div>
          <div className="l">待处理请求</div>
        </div>
        <div className="stat">
          <div className="v">{completedCount}</div>
          <div className="l">已完成请求</div>
        </div>
        <div className="stat">
          <div className="v">{deleteCount}</div>
          <div className="l">删除请求</div>
        </div>
      </div>

      <div className="set-grid">
        <div className="set-nav card" style={{ padding: 8 }}>
          <a href="#requests" className="on">
            数据请求
          </a>
          <a href="#roles">权限矩阵</a>
          <a href="#audit">审计基线</a>
        </div>

        <div>
          <div className="card set-block" id="requests">
            <div className="head-row" style={{ marginBottom: 10 }}>
              <div>
                <h3>GDPR / PIPL 数据请求</h3>
                <div className="sub">Owner / Admin 可登记导出或删除请求，并对处理结果留痕。</div>
              </div>
              <span className={`badge ${canManageCompliance ? "good" : "line"}`}>
                当前角色：{currentMembership?.role ?? "未知"}
              </span>
            </div>

            {canManageCompliance ? (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 14,
                    marginBottom: 14,
                  }}
                >
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>请求类型</label>
                    <select
                      value={requestType}
                      onChange={(event) => setRequestType(event.target.value as "export" | "delete")}
                    >
                      <option value="export">导出</option>
                      <option value="delete">删除</option>
                    </select>
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>法规通道</label>
                    <select
                      value={channel}
                      onChange={(event) => setChannel(event.target.value as "gdpr" | "pipl")}
                    >
                      <option value="gdpr">GDPR</option>
                      <option value="pipl">PIPL</option>
                    </select>
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>数据主体邮箱</label>
                    <input
                      type="email"
                      value={subjectEmail}
                      onChange={(event) => setSubjectEmail(event.target.value)}
                      placeholder="buyer@example.com"
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>备注</label>
                    <input
                      type="text"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="例如：客户要求导出近 24 个月往来记录"
                    />
                  </div>
                </div>
                <div className="head-row" style={{ marginBottom: 18 }}>
                  <div className="sub">
                    创建后会写 `data_request_created` 审计日志；完成或拒绝会写 `data_request_resolved`。
                  </div>
                  <button
                    type="button"
                    className="btn primary sm"
                    disabled={submitting || !subjectEmail.trim()}
                    onClick={() => void handleCreateRequest()}
                  >
                    {submitting ? "提交中…" : "登记请求"}
                  </button>
                </div>
              </>
            ) : (
              <div
                className="card"
                style={{
                  padding: "12px 14px",
                  background: "var(--surface-2)",
                  borderStyle: "dashed",
                  marginBottom: 14,
                }}
              >
                你当前是 `{currentMembership?.role ?? "unknown"}` 角色，只能查看权限矩阵，不能创建或处理数据请求。
              </div>
            )}

            <div className="head-row" style={{ marginBottom: 10 }}>
              <h3 style={{ marginBottom: 0 }}>最近请求</h3>
              <span className="badge line">{visibleLoading ? "加载中…" : `${visibleItems.length} 条`}</span>
            </div>
            <div className="card" style={{ padding: "6px 18px" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>范围</th>
                    <th>状态</th>
                    <th>创建时间</th>
                    <th>完成时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <tr key={item.id}>
                      <td>{formatRequestType(item.type)}</td>
                      <td>{readScopeText(item.scope)}</td>
                      <td>{formatRequestStatus(item.status)}</td>
                      <td>{formatTime(item.createdAt)}</td>
                      <td>{formatTime(item.completedAt)}</td>
                      <td>
                        {item.status === "pending" && canManageCompliance ? (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="btn ghost sm"
                              onClick={() => void handleResolveRequest(item.id, "completed")}
                            >
                              标记完成
                            </button>
                            <button
                              type="button"
                              className="btn ghost sm"
                              onClick={() => void handleResolveRequest(item.id, "rejected")}
                            >
                              拒绝
                            </button>
                          </div>
                        ) : (
                          <span className="sub">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleItems.length ? (
                <div className="sub" style={{ padding: "12px 0" }}>
                  当前租户还没有登记数据请求。
                </div>
              ) : null}
            </div>
          </div>

          <div className="card set-block" id="roles">
            <div className="head-row" style={{ marginBottom: 10 }}>
              <div>
                <h3>RBAC 权限矩阵</h3>
                <div className="sub">服务端按动作强制，不依赖前端隐藏按钮。</div>
              </div>
              <Link className="btn ghost sm" href="/hitl">
                看审批中心
              </Link>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>动作</th>
                  <th>Owner</th>
                  <th>Admin</th>
                  <th>Operator</th>
                  <th>Sales</th>
                  <th>Viewer</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>站点上线审批</td>
                  <td>允许</td>
                  <td>允许</td>
                  <td>拒绝</td>
                  <td>拒绝</td>
                  <td>拒绝</td>
                </tr>
                <tr>
                  <td>内容发布审批</td>
                  <td>允许</td>
                  <td>允许</td>
                  <td>允许</td>
                  <td>拒绝</td>
                  <td>拒绝</td>
                </tr>
                <tr>
                  <td>首响发送审批</td>
                  <td>允许</td>
                  <td>允许</td>
                  <td>允许</td>
                  <td>允许</td>
                  <td>拒绝</td>
                </tr>
                <tr>
                  <td>数据导出 / 删除请求</td>
                  <td>允许</td>
                  <td>允许</td>
                  <td>拒绝</td>
                  <td>拒绝</td>
                  <td>拒绝</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card set-block" id="audit">
            <div className="head-row" style={{ marginBottom: 10 }}>
              <div>
                <h3>审计基线</h3>
                <div className="sub">对外动作、权限动作、删改数据必须可回溯。</div>
              </div>
              <Link className="btn ghost sm" href="/kb/reviews">
                看知识审核
              </Link>
            </div>
            <div className="sub" style={{ lineHeight: 1.75 }}>
              当前已落地的关键审计事件包括：
              <br />
              `data_request_created` / `data_request_resolved`
              <br />
              `site_publish_requested` / `site_published`
              <br />
              `content_publish_requested` / `content_item_marked_published`
              <br />
              `reply_send_requested` / `reply_sent` / `hitl_task_approved`
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
