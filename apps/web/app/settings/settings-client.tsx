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

type MemberItem = {
  id: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    name: string | null;
  };
};

type MembersResponse = {
  items: MemberItem[];
};

type SettingsOverviewResponse = {
  brandKit: {
    id: string;
    name: string;
    companyName: string;
    primaryColor: string | null;
    secondaryColor: string | null;
    logoUrl: string | null;
    tone: string | null;
    updatedAt: string;
  } | null;
  sitePortfolio: {
    totalSites: number;
    publishedSites: number;
    localeCount: number;
  };
  notifications: {
    unreadCount: number;
    pendingApprovals: number;
  };
  modelPolicy: {
    privateTextRoute: string;
    embeddingRoute: string;
    translationRoute: string;
    externalTextRoute: string;
    localQwenModel: string;
    localBgeModel: string;
    openaiModel: string;
  };
};

type UsageResponse = {
  creditsBalance: string;
  summary: {
    recentInvocationCount: number;
    piiInvocationCount: number;
    totalTokensInput: number;
    totalTokensOutput: number;
    averageLatencyMs: number;
    totalCostUsd: string;
    routeBreakdown: Array<{
      route: string;
      count: number;
    }>;
  };
  recent: Array<{
    id: string;
    route: string;
    taskType: string;
    modelName: string;
    containsPii: boolean;
    tokensInput: number;
    tokensOutput: number;
    latencyMs: number;
    costUsd: string;
    createdAt: string;
  }>;
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

async function fetchMembers(tenantId: string) {
  const response = await fetch("/api/members", {
    headers: {
      "X-Tenant-Id": tenantId,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载成员失败。");
  }

  return (await response.json()) as MembersResponse;
}

async function fetchSettingsOverview(tenantId: string) {
  const response = await fetch("/api/settings/overview", {
    headers: {
      "X-Tenant-Id": tenantId,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载品牌与模型信息失败。");
  }

  return (await response.json()) as SettingsOverviewResponse;
}

async function fetchUsage(tenantId: string) {
  const response = await fetch("/api/usage", {
    headers: {
      "X-Tenant-Id": tenantId,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载模型用量失败。");
  }

  return (await response.json()) as UsageResponse;
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

function formatMemberRole(role: string) {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "operator":
      return "Operator";
    case "sales":
      return "Sales";
    case "viewer":
      return "Viewer";
    default:
      return role;
  }
}

function formatMemberStatus(status: string) {
  switch (status) {
    case "active":
      return "启用";
    case "invited":
      return "已邀请";
    case "suspended":
      return "停用";
    default:
      return status;
  }
}

export function SettingsClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [items, setItems] = useState<DataRequestItem[]>([]);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [overview, setOverview] = useState<SettingsOverviewResponse | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [requestType, setRequestType] = useState<"export" | "delete">("export");
  const [channel, setChannel] = useState<"gdpr" | "pipl">("gdpr");
  const [subjectEmail, setSubjectEmail] = useState("");
  const [note, setNote] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<
    "admin" | "operator" | "sales" | "viewer"
  >("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [membersSubmitting, setMembersSubmitting] = useState(false);
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

  async function refreshMembers(tenantId = selectedTenantId) {
    if (!tenantId) {
      setMembers([]);
      return;
    }

    if (!canManageCompliance) {
      return;
    }

    setError(null);

    const payload = await fetchMembers(tenantId);
    setMembers(payload.items);
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

  async function handleInviteMember() {
    if (!selectedTenantId || !inviteEmail.trim()) {
      setError("请填写成员邮箱。");
      return;
    }

    setMembersSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/members", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "邀请成员失败。");
      }

      setSuccess("成员已登记邀请。");
      setInviteEmail("");
      setInviteRole("viewer");
      await refreshMembers();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "邀请成员失败。");
    } finally {
      setMembersSubmitting(false);
    }
  }

  async function handleUpdateMember(params: {
    memberId: string;
    role?: string;
    status?: string;
  }) {
    if (!selectedTenantId) {
      return;
    }

    setMembersSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/members/${params.memberId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify({
          role: params.role,
          status: params.status,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "更新成员失败。");
      }

      setSuccess("成员权限已更新。");
      await refreshMembers();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "更新成员失败。");
    } finally {
      setMembersSubmitting(false);
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

    void Promise.all([fetchDataRequests(selectedTenantId), fetchMembers(selectedTenantId)])
      .then(([requestsPayload, membersPayload]) => {
        if (!active) {
          return;
        }

        setError(null);
        setItems(requestsPayload.items);
        setMembers(membersPayload.items);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载设置数据失败。");
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

  useEffect(() => {
    if (!selectedTenantId || !canManageCompliance) {
      return;
    }

    let active = true;

    void Promise.all([fetchSettingsOverview(selectedTenantId), fetchUsage(selectedTenantId)])
      .then(([overviewPayload, usagePayload]) => {
        if (!active) {
          return;
        }

        setOverview(overviewPayload);
        setUsage(usagePayload);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载设置概览失败。");
        }
      });

    return () => {
      active = false;
    };
  }, [canManageCompliance, selectedTenantId]);

  const pendingCount = items.filter((item) => item.status === "pending").length;
  const unreadNotifications = overview?.notifications.unreadCount ?? 0;
  const creditsBalance = usage?.creditsBalance ?? "0";
  const visibleItems = canManageCompliance ? items : [];
  const visibleLoading = canManageCompliance ? loading : false;
  const visibleMembers = canManageCompliance ? members : [];
  const visibleMembersLoading = canManageCompliance ? loading : false;

  return (
    <>
      <div className="head-row">
        <div>
          <div className="eyebrow">设置 / 治理</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            品牌、模型、合规与权限
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            复用现有租户数据，把品牌摘要、模型路由、用量、成员与合规动作收口到统一设置页。
          </div>
        </div>
        {me && me.memberships.length > 0 ? (
          <select
            className="btn ghost sm"
            value={selectedTenantId}
            onChange={(event) => {
              setLoading(true);
              setOverview(null);
              setUsage(null);
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
          <div className="v">{unreadNotifications}</div>
          <div className="l">未读治理提醒</div>
        </div>
        <div className="stat">
          <div className="v">{creditsBalance}</div>
          <div className="l">当前 Credits 余额</div>
        </div>
      </div>

      <div className="set-grid">
        <div className="set-nav card" style={{ padding: 8 }}>
          <a href="#requests" className="on">
            数据请求
          </a>
          <a href="#members">成员权限</a>
          <a href="#brand">品牌资料</a>
          <a href="#models">模型路由</a>
          <a href="#usage">模型用量</a>
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

          <div className="card set-block" id="members">
            <div className="head-row" style={{ marginBottom: 10 }}>
              <div>
                <h3>成员与角色</h3>
                <div className="sub">复用现有成员接口，支持邀请、改角色、停用，所有变更写审计日志。</div>
              </div>
              <span className="badge line">{visibleMembersLoading ? "加载中…" : `${visibleMembers.length} 人`}</span>
            </div>

            {canManageCompliance ? (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr) auto",
                    gap: 14,
                    alignItems: "end",
                    marginBottom: 18,
                  }}
                >
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>邀请邮箱</label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="new-user@example.com"
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>初始角色</label>
                    <select
                      value={inviteRole}
                      onChange={(event) =>
                        setInviteRole(
                          event.target.value as "admin" | "operator" | "sales" | "viewer",
                        )
                      }
                    >
                      <option value="viewer">Viewer</option>
                      <option value="sales">Sales</option>
                      <option value="operator">Operator</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    className="btn primary sm"
                    disabled={membersSubmitting || !inviteEmail.trim()}
                    onClick={() => void handleInviteMember()}
                  >
                    {membersSubmitting ? "提交中…" : "邀请成员"}
                  </button>
                </div>

                <div className="card" style={{ padding: "6px 18px" }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>成员</th>
                        <th>角色</th>
                        <th>状态</th>
                        <th>加入时间</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleMembers.map((member) => (
                        <tr key={member.id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{member.user.name ?? member.user.email}</div>
                            <div className="sub">{member.user.email}</div>
                          </td>
                          <td>{formatMemberRole(member.role)}</td>
                          <td>{formatMemberStatus(member.status)}</td>
                          <td>{formatTime(member.createdAt)}</td>
                          <td>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {member.role !== "owner" ? (
                                <>
                                  <select
                                    className="btn ghost sm"
                                    defaultValue={member.role}
                                    onChange={(event) =>
                                      void handleUpdateMember({
                                        memberId: member.id,
                                        role: event.target.value,
                                      })
                                    }
                                    disabled={membersSubmitting}
                                  >
                                    <option value="viewer">Viewer</option>
                                    <option value="sales">Sales</option>
                                    <option value="operator">Operator</option>
                                    <option value="admin">Admin</option>
                                  </select>
                                  <select
                                    className="btn ghost sm"
                                    defaultValue={member.status}
                                    onChange={(event) =>
                                      void handleUpdateMember({
                                        memberId: member.id,
                                        status: event.target.value,
                                      })
                                    }
                                    disabled={membersSubmitting}
                                  >
                                    <option value="invited">已邀请</option>
                                    <option value="active">启用</option>
                                    <option value="suspended">停用</option>
                                  </select>
                                </>
                              ) : (
                                <span className="sub">Owner 只能由 Owner 管理</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!visibleMembers.length ? (
                    <div className="sub" style={{ padding: "12px 0" }}>
                      当前租户还没有额外成员记录。
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div
                className="card"
                style={{
                  padding: "12px 14px",
                  background: "var(--surface-2)",
                  borderStyle: "dashed",
                }}
              >
                只有 Owner / Admin 可以查看和管理成员权限。
              </div>
            )}
          </div>

          <div className="card set-block" id="brand">
            <div className="head-row" style={{ marginBottom: 10 }}>
              <div>
                <h3>品牌资料</h3>
                <div className="sub">读取最新 Brand Kit，用于站点、内容包和图片生成的一致风格控制。</div>
              </div>
              <span className="badge line">
                {overview?.sitePortfolio.totalSites ?? 0} 个站点 / {overview?.sitePortfolio.localeCount ?? 0} 个 locale
              </span>
            </div>

            {canManageCompliance ? (
              overview?.brandKit ? (
                <div className="pv-grid">
                  <div className="pv-card">
                    <h4>{overview.brandKit.companyName}</h4>
                    <p>
                      Brand Kit 名称：{overview.brandKit.name}
                      <br />
                      最近更新：{formatTime(overview.brandKit.updatedAt)}
                    </p>
                    <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                      <span className="badge line">
                        主色 {overview.brandKit.primaryColor ?? "未设置"}
                      </span>
                      <span className="badge line">
                        辅色 {overview.brandKit.secondaryColor ?? "未设置"}
                      </span>
                      {overview.brandKit.logoUrl ? <span className="badge good">已配置 Logo</span> : null}
                    </div>
                  </div>
                  <div className="pv-panel">
                    <h4>品牌摘要</h4>
                    <div className="pv-stack" style={{ marginTop: 10 }}>
                      <div className="pv-note">
                        <b>品牌语气</b>
                        <p>{overview.brandKit.tone ?? "未在 metadata.tone 中设置，当前走工业 B2B 默认语气。"}</p>
                      </div>
                      <div className="pv-note">
                        <b>站点覆盖</b>
                        <p>
                          已发布站点 {overview.sitePortfolio.publishedSites} / {overview.sitePortfolio.totalSites}，
                          当前共维护 {overview.sitePortfolio.localeCount} 个语言版本。
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card empty">
                  <div className="t">当前租户还没有 Brand Kit</div>
                  <div className="s">后续可以补一个品牌设置表单或从内容包编辑器回填。</div>
                </div>
              )
            ) : (
              <div
                className="card"
                style={{
                  padding: "12px 14px",
                  background: "var(--surface-2)",
                  borderStyle: "dashed",
                }}
              >
                只有 Owner / Admin 可以查看品牌摘要与模型用量。
              </div>
            )}
          </div>

          <div className="card set-block" id="models">
            <div className="head-row" style={{ marginBottom: 10 }}>
              <div>
                <h3>模型路由</h3>
                <div className="sub">用文档化方式把隐私路由讲清楚，避免前端同学误把敏感请求送到第三方模型。</div>
              </div>
              <Link className="btn ghost sm" href="/kb/reviews">
                看知识基线
              </Link>
            </div>

            {canManageCompliance ? (
              <div className="pv-grid">
                <div className="pv-card">
                  <h4>隐私优先路由</h4>
                  <ul className="pv-bullets">
                    <li>文本生成 / 分类（含 PII）: {overview?.modelPolicy.privateTextRoute ?? "local_qwen"}</li>
                    <li>向量嵌入: {overview?.modelPolicy.embeddingRoute ?? "local_bge"}</li>
                    <li>翻译: {overview?.modelPolicy.translationRoute ?? "google_translate"}</li>
                    <li>非 PII 外部生成: {overview?.modelPolicy.externalTextRoute ?? "openai_when_non_pii"}</li>
                  </ul>
                </div>
                <div className="pv-panel">
                  <h4>当前模型名</h4>
                  <div className="pv-stack" style={{ marginTop: 10 }}>
                    <div className="pv-note">
                      <b>LOCAL_QWEN_MODEL</b>
                      <p>{overview?.modelPolicy.localQwenModel ?? "—"}</p>
                    </div>
                    <div className="pv-note">
                      <b>LOCAL_BGE_MODEL</b>
                      <p>{overview?.modelPolicy.localBgeModel ?? "—"}</p>
                    </div>
                    <div className="pv-note">
                      <b>OPENAI_MODEL</b>
                      <p>{overview?.modelPolicy.openaiModel ?? "—"}</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="card"
                style={{
                  padding: "12px 14px",
                  background: "var(--surface-2)",
                  borderStyle: "dashed",
                }}
              >
                当前角色只能看 RBAC 和审计说明，模型配置由 Owner / Admin 管理。
              </div>
            )}
          </div>

          <div className="card set-block" id="usage">
            <div className="head-row" style={{ marginBottom: 10 }}>
              <div>
                <h3>模型用量</h3>
                <div className="sub">基于最近 20 次模型调用汇总速度、成本、PII 命中与路线分布。</div>
              </div>
              <span className="badge line">Credits {creditsBalance}</span>
            </div>

            {canManageCompliance ? (
              <>
                <div className="stat-strip" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 14 }}>
                  <div className="stat">
                    <div className="v">{usage?.summary.recentInvocationCount ?? 0}</div>
                    <div className="l">近 20 次调用</div>
                  </div>
                  <div className="stat">
                    <div className="v">{usage?.summary.piiInvocationCount ?? 0}</div>
                    <div className="l">PII 命中</div>
                  </div>
                  <div className="stat">
                    <div className="v">{usage?.summary.averageLatencyMs ?? 0}</div>
                    <div className="l">平均延迟 ms</div>
                  </div>
                  <div className="stat">
                    <div className="v">{usage?.summary.totalCostUsd ?? "0.0000"}</div>
                    <div className="l">累计成本 USD</div>
                  </div>
                </div>

                <div className="pv-grid" style={{ marginBottom: 14 }}>
                  <div className="pv-card">
                    <h4>Token 汇总</h4>
                    <p>输入 {usage?.summary.totalTokensInput ?? 0} / 输出 {usage?.summary.totalTokensOutput ?? 0}</p>
                    <div className="usebar">
                      <i
                        style={{
                          width: `${
                            usage && usage.summary.totalTokensInput + usage.summary.totalTokensOutput > 0
                              ? Math.max(
                                  8,
                                  (usage.summary.totalTokensInput /
                                    (usage.summary.totalTokensInput + usage.summary.totalTokensOutput)) *
                                    100,
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                    <div className="sub">色条表示输入 tokens 在最近调用中的占比。</div>
                  </div>
                  <div className="pv-panel">
                    <h4>路由分布</h4>
                    <div className="pv-stack" style={{ marginTop: 10 }}>
                      {(usage?.summary.routeBreakdown ?? []).map((item) => (
                        <div className="pv-note" key={item.route}>
                          <b>{item.route}</b>
                          <p>{item.count} 次最近调用</p>
                        </div>
                      ))}
                      {(usage?.summary.routeBreakdown ?? []).length === 0 ? (
                        <div className="pv-note">
                          <b>暂无数据</b>
                          <p>当前租户还没有模型调用记录。</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="card" style={{ padding: "6px 18px" }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>Route</th>
                        <th>Task</th>
                        <th>Model</th>
                        <th>PII</th>
                        <th>Tokens</th>
                        <th>Latency</th>
                        <th>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(usage?.recent ?? []).map((item) => (
                        <tr key={item.id}>
                          <td>{formatTime(item.createdAt)}</td>
                          <td>{item.route}</td>
                          <td>{item.taskType}</td>
                          <td>{item.modelName}</td>
                          <td>{item.containsPii ? "是" : "否"}</td>
                          <td>{item.tokensInput}/{item.tokensOutput}</td>
                          <td>{item.latencyMs}ms</td>
                          <td>{item.costUsd}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(usage?.recent ?? []).length === 0 ? (
                    <div className="sub" style={{ padding: "12px 0" }}>
                      当前还没有模型调用记录。
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div
                className="card"
                style={{
                  padding: "12px 14px",
                  background: "var(--surface-2)",
                  borderStyle: "dashed",
                }}
              >
                只有 Owner / Admin 可以查看模型用量和成本信息。
              </div>
            )}
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
              <br />
              `membership_role_updated` / `membership_status_updated`
              <br />
              运维脚本：`npm run ops:backup-local` / `npm run ops:restore-local` / `npm run ops:check-secrets`
              <br />
              当前治理入口：`/notifications` / `/publish-checklist` / `/settings`
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
