"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { statusLabel } from "@/app/_lib/labels";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";

type Lead = {
  id: string;
  companyName: string;
  country: string | null;
  status: string;
  score: string | null;
  inquiryCount: number;
  latestInquiry: {
    id: string;
    sourceType: string;
    subject: string | null;
    createdAt: string;
  } | null;
  sourceAttribution: {
    platform: string | null;
    contentTitle: string | null;
    trackingSlug: string | null;
  };
};

type LeadsResponse = {
  items: Lead[];
};

type Opportunity = {
  id: string;
  companyName: string;
  name: string;
  stage: string;
  valueAmount: string | null;
  currency: string;
};

type OpportunitiesResponse = {
  items: Opportunity[];
};

type InquiryItem = {
  id: string;
  sourceType: string;
  subject: string | null;
  bodyPreview: string;
  fromEmail: string | null;
  fromName: string | null;
  createdAt: string;
  lead: {
    id: string;
    companyName: string | null;
    country: string | null;
    status: string;
    contactName: string | null;
    contactEmail: string | null;
  };
  sourceAttribution: {
    platform: string | null;
    contentTitle: string | null;
    trackingSlug: string | null;
  };
  latestReply: {
    id: string;
    status: string;
    sentAt: string | null;
    updatedAt: string;
  } | null;
};

type InquiriesResponse = {
  items: InquiryItem[];
};

type LeadDetailResponse = {
  lead: {
    id: string;
    ownerUserId: string | null;
    companyName: string | null;
    country: string | null;
    status: string;
    score: string | null;
    scoreReason: string | null;
    followUpDueAt: string | null;
    firstSeenAt: string;
    lastContactAt: string | null;
    contact: {
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      whatsapp: string | null;
      preferredLocale: string | null;
    } | null;
    owner: {
      id: string;
      name: string;
      email: string;
    } | null;
    sourceAttribution: {
      platform: string | null;
      contentTitle: string | null;
      contentBody: string | null;
      trackingSlug: string | null;
      targetUrl: string | null;
      utmSource: string | null;
      utmMedium: string | null;
      utmCampaign: string | null;
      utmContent: string | null;
    };
    inquiries: Array<{
      id: string;
      sourceType: string;
      subject: string | null;
      body: string;
      fromEmail: string | null;
      fromName: string | null;
      createdAt: string;
    }>;
    opportunities: Array<{
      id: string;
      name: string;
      stage: string;
      valueAmount: string | null;
      currency: string;
      followUpDueAt: string | null;
    }>;
  };
};

type ActivityItem = {
  id: string;
  type: string;
  body: string;
  createdAt: string;
  actor: {
    id: string;
    name: string;
    email: string;
  } | null;
};

type ActivitiesResponse = {
  items: ActivityItem[];
};

async function fetchCrm(tenantId: string, inquirySource: "all" | "form" | "email") {
  const headers = {
    "X-Tenant-Id": tenantId,
  };
  const inquiriesUrl =
    inquirySource === "all"
      ? "/api/crm/inquiries"
      : `/api/crm/inquiries?source=${encodeURIComponent(inquirySource)}`;
  const [leadsRes, opportunitiesRes, inquiriesRes] = await Promise.all([
    fetch("/api/crm/leads", { headers }),
    fetch("/api/crm/opportunities", { headers }),
    fetch(inquiriesUrl, { headers }),
  ]);

  if (!leadsRes.ok) {
    const payload = await leadsRes.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载线索失败。");
  }

  if (!opportunitiesRes.ok) {
    const payload = await opportunitiesRes.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载商机失败。");
  }

  if (!inquiriesRes.ok) {
    const payload = await inquiriesRes.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载询盘失败。");
  }

  return {
    leads: ((await leadsRes.json()) as LeadsResponse).items,
    opportunities: ((await opportunitiesRes.json()) as OpportunitiesResponse).items,
    inquiries: ((await inquiriesRes.json()) as InquiriesResponse).items,
  };
}

async function fetchLeadDetail(tenantId: string, leadId: string) {
  const response = await fetch(`/api/crm/leads/${leadId}`, {
    headers: {
      "X-Tenant-Id": tenantId,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载线索详情失败。");
  }

  return (await response.json()) as LeadDetailResponse;
}

async function fetchLeadActivities(tenantId: string, leadId: string) {
  const response = await fetch(`/api/crm/activities?leadId=${encodeURIComponent(leadId)}`, {
    headers: {
      "X-Tenant-Id": tenantId,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载活动失败。");
  }

  return (await response.json()) as ActivitiesResponse;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function sourceTypeLabel(value: string) {
  return value === "email" ? "邮件询盘" : "表单询盘";
}

function activityTypeLabel(value: string) {
  switch (value) {
    case "note":
      return "备注";
    case "stage_change":
      return "阶段变更";
    case "follow_up":
      return "跟进";
    case "email":
      return "邮件";
    case "reply_sent":
      return "首响已发";
    default:
      return value;
  }
}

function inquiryPreview(item: { subject: string | null; bodyPreview?: string; body?: string }) {
  if (item.subject?.trim()) {
    return item.subject;
  }

  const fallback = item.bodyPreview ?? item.body ?? "";
  return fallback.trim() ? fallback : "无";
}

export function CrmClient() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [inquiries, setInquiries] = useState<InquiryItem[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [leadDetail, setLeadDetail] = useState<LeadDetailResponse["lead"] | null>(null);
  const [leadActivities, setLeadActivities] = useState<ActivityItem[]>([]);
  const [leadDetailLoading, setLeadDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageBusyId, setStageBusyId] = useState<string | null>(null);
  const [draftBusyInquiryId, setDraftBusyInquiryId] = useState<string | null>(null);
  const [inquirySource, setInquirySource] = useState<"all" | "form" | "email">("all");
  const selectedLeadIdRef = useRef(selectedLeadId);
  const activeLeadDetail =
    leadDetail && leadDetail.id === selectedLeadId ? leadDetail : null;

  useEffect(() => {
    selectedLeadIdRef.current = selectedLeadId;
  }, [selectedLeadId]);

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

    void fetchCrm(selectedTenantId, inquirySource)
      .then((payload) => {
        if (!active) {
          return;
        }

        setError(null);
        setLeads(payload.leads);
        setOpportunities(payload.opportunities);
        setInquiries(payload.inquiries);
        if (payload.leads.length === 0 && payload.inquiries.length === 0) {
          setLeadDetail(null);
          setLeadActivities([]);
          setLeadDetailLoading(false);
        }
        const nextLeadId =
          selectedLeadIdRef.current &&
          payload.leads.some((lead) => lead.id === selectedLeadIdRef.current)
            ? selectedLeadIdRef.current
            : payload.leads[0]?.id ??
          payload.inquiries[0]?.lead.id ??
          "";
        setSelectedLeadId(nextLeadId);
        if (!selectedLeadIdRef.current || nextLeadId !== selectedLeadIdRef.current) {
          setLeadDetailLoading(Boolean(nextLeadId));
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载 CRM 失败。");
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
  }, [inquirySource, selectedTenantId]);

  useEffect(() => {
    if (!selectedTenantId || !selectedLeadId) {
      return;
    }

    let active = true;

    void Promise.all([
      fetchLeadDetail(selectedTenantId, selectedLeadId),
      fetchLeadActivities(selectedTenantId, selectedLeadId),
    ])
      .then(([detail, activities]) => {
        if (!active) {
          return;
        }

        setError(null);
        setLeadDetail(detail.lead);
        setLeadActivities(activities.items);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载线索详情失败。");
          setLeadDetail(null);
          setLeadActivities([]);
        }
      })
      .finally(() => {
        if (active) {
          setLeadDetailLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedLeadId, selectedTenantId]);

  async function changeStage(opportunityId: string, stage: string) {
    if (!selectedTenantId) {
      return;
    }

    setStageBusyId(opportunityId);
    setError(null);
    try {
      const response = await fetch(`/api/crm/opportunities/${opportunityId}/stage`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify({ stage }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "更新阶段失败。");
      }
      const refreshed = await fetchCrm(selectedTenantId, inquirySource);
      setLeads(refreshed.leads);
      setOpportunities(refreshed.opportunities);
      setInquiries(refreshed.inquiries);
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "更新阶段失败。");
    } finally {
      setStageBusyId(null);
    }
  }

  async function requestReplyDraft(inquiryId: string) {
    if (!selectedTenantId) {
      return;
    }

    setDraftBusyInquiryId(inquiryId);
    setError(null);

    try {
      const response = await fetch("/api/replies/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify({ inquiryId }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "创建首响草稿失败。");
      }

      router.push("/replies");
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : "创建首响草稿失败。");
    } finally {
      setDraftBusyInquiryId(null);
    }
  }

  const stageColumns = STAGES.map((stage) => ({
    ...stage,
    items: opportunities.filter((item) => item.stage.toLowerCase() === stage.key),
  }));
  const otherOpportunities = opportunities.filter(
    (item) => !STAGES.some((stage) => stage.key === item.stage.toLowerCase()),
  );
  const visibleLeads = [...leads]
    .filter((lead) => lead.latestInquiry)
    .sort((left, right) => {
      const leftTime = new Date(left.latestInquiry?.createdAt ?? 0).getTime();
      const rightTime = new Date(right.latestInquiry?.createdAt ?? 0).getTime();
      return rightTime - leftTime || right.inquiryCount - left.inquiryCount;
    })
    .slice(0, 20);
  const visibleInquiries = [...inquiries]
    .sort((left, right) => {
      return (
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime()
      );
    })
    .slice(0, 20);

  return (
    <>
      <div className="head-row">
        <div>
          <div className="eyebrow">CRM 管道</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            商机 · 阶段推进 · 来源归因
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            从询盘、线索到商机，保留平台、内容、追踪链接的归因链路。
          </div>
        </div>
        {me && me.memberships.length > 0 ? (
          <select
            className="btn ghost sm"
            value={selectedTenantId}
            onChange={(event) => {
              setLoading(true);
              setLeadDetailLoading(false);
              setLeadDetail(null);
              setLeadActivities([]);
              setSelectedLeadId("");
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
          <div className="v">{leads.length}</div>
          <div className="l">线索数</div>
        </div>
        <div className="stat">
          <div className="v">{opportunities.length}</div>
          <div className="l">商机数</div>
        </div>
        <div className="stat">
          <div className="v">{inquiries.length}</div>
          <div className="l">可见询盘</div>
        </div>
        <div className="stat">
          <div className="v">{leads.filter((lead) => lead.score === "a").length}</div>
          <div className="l">A 级线索</div>
        </div>
      </div>

      <div className="head-row" style={{ marginBottom: 10 }}>
        <h3 style={{ fontSize: 16 }}>商机管道</h3>
        <span className="badge line">{loading ? "加载中…" : `${opportunities.length} 个商机`}</span>
      </div>
      <div className="kanban">
        {stageColumns.map((column) => {
          const items =
            column.key === "lost"
              ? [...column.items, ...otherOpportunities]
              : column.items;
          return (
            <div className="kcol" key={column.key}>
              <h4>
                {column.label}
                <span className="cnt">{items.length}</span>
              </h4>
              {items.map((opportunity) => (
                <div className="kc" key={opportunity.id}>
                  <div className="co">{opportunity.companyName}</div>
                  <div className="meta">{opportunity.name}</div>
                  <div className="val">
                    {opportunity.valueAmount
                      ? `${opportunity.currency} ${opportunity.valueAmount}`
                      : "待报价"}
                  </div>
                  <select
                    className="btn ghost sm"
                    style={{ marginTop: 8, width: "100%" }}
                    value={STAGES.some((s) => s.key === opportunity.stage.toLowerCase())
                      ? opportunity.stage.toLowerCase()
                      : "new"}
                    disabled={stageBusyId === opportunity.id}
                    onChange={(event) => void changeStage(opportunity.id, event.target.value)}
                  >
                    {STAGES.map((s) => (
                      <option key={s.key} value={s.key}>
                        移至：{s.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="head-row" style={{ marginTop: 22, marginBottom: 10 }}>
        <h3 style={{ fontSize: 16 }}>询盘线索池</h3>
        <span className="badge line">显示最新 {visibleLeads.length} 条</span>
      </div>
      <div className="card" style={{ padding: "6px 18px" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>客户</th>
              <th>评分</th>
              <th>来源（平台 → 内容）</th>
              <th>最新询盘</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleLeads.map((lead) => {
              const latestInquiry = lead.latestInquiry;

              return (
                <tr key={lead.id}>
                  <td>
                    <b>{lead.companyName || "未命名线索"}</b>
                    {lead.country ? (
                      <span className="sub" style={{ marginLeft: 6 }}>{lead.country}</span>
                    ) : null}
                    <div className="sub" style={{ marginTop: 4 }}>
                      {lead.inquiryCount} 次询盘
                    </div>
                  </td>
                  <td>
                    {lead.score ? (
                      <span className={`badge ${lead.score === "a" ? "good" : "line"}`}>
                        {lead.score.toUpperCase()} 级
                      </span>
                    ) : (
                      <span className="sub">—</span>
                    )}
                  </td>
                  <td>
                    {(lead.sourceAttribution.platform ?? "unknown").toUpperCase()} ·{" "}
                    {lead.sourceAttribution.contentTitle ?? "未绑定"}
                    {lead.sourceAttribution.trackingSlug ? (
                      <span className="link" style={{ marginLeft: 6 }}>
                        {lead.sourceAttribution.trackingSlug}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {latestInquiry ? inquiryPreview(latestInquiry) : "无"}
                    {latestInquiry ? (
                      <>
                        <div className="sub">
                          {sourceTypeLabel(latestInquiry.sourceType)} · {formatTime(latestInquiry.createdAt)}
                        </div>
                        <button
                          type="button"
                          className="btn ghost sm"
                          style={{ marginTop: 8 }}
                          disabled={draftBusyInquiryId === latestInquiry.id}
                          onClick={() => void requestReplyDraft(latestInquiry.id)}
                        >
                          {draftBusyInquiryId === latestInquiry.id
                            ? "起草中…"
                            : "用 AI 起草首响"}
                        </button>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span className={`st ${lead.status}`}>{statusLabel(lead.status)}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => {
                        setLeadDetailLoading(true);
                        setSelectedLeadId(lead.id);
                      }}
                    >
                      查看详情
                    </button>
                  </td>
                </tr>
              );
            })}
            {!visibleLeads.length ? (
              <tr>
                <td colSpan={6}>
                  <div className="sub" style={{ padding: "12px 0" }}>当前没有带询盘的线索数据。</div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="split" style={{ marginTop: 18, gridTemplateColumns: "1.1fr 0.9fr" }}>
        <div className="card" style={{ padding: "14px 18px" }}>
          <div className="head-row" style={{ marginBottom: 10 }}>
            <div>
              <h3 style={{ fontSize: 16 }}>线索详情</h3>
              <div className="sub" style={{ marginTop: 4 }}>
                来源归因、历史询盘、已有关联商机
              </div>
            </div>
            {activeLeadDetail ? (
              <span className={`st ${activeLeadDetail.status}`}>{statusLabel(activeLeadDetail.status)}</span>
            ) : null}
          </div>

          {leadDetailLoading ? (
            <div className="sub">加载详情中…</div>
          ) : activeLeadDetail ? (
            <div style={{ display: "grid", gap: 14 }}>
              <div className="card" style={{ padding: "12px 14px" }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>
                  {activeLeadDetail.companyName ?? activeLeadDetail.contact?.name ?? "未命名线索"}
                </div>
                <div className="sub" style={{ marginTop: 6 }}>
                  {activeLeadDetail.country ?? "未知市场"}
                  {activeLeadDetail.owner ? ` · 负责人 ${activeLeadDetail.owner.name}` : ""}
                  {activeLeadDetail.score ? ` · ${activeLeadDetail.score.toUpperCase()} 级` : ""}
                </div>
                <div style={{ display: "grid", gap: 6, marginTop: 10, fontSize: 13 }}>
                  <div>联系人：{activeLeadDetail.contact?.name ?? "—"}</div>
                  <div>邮箱：{activeLeadDetail.contact?.email ?? "—"}</div>
                  <div>电话：{activeLeadDetail.contact?.phone ?? "—"}</div>
                  <div>WhatsApp：{activeLeadDetail.contact?.whatsapp ?? "—"}</div>
                </div>
              </div>

              <div className="card" style={{ padding: "12px 14px" }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>来源归因</div>
                <div style={{ display: "grid", gap: 6, marginTop: 8, fontSize: 13 }}>
                  <div>平台：{(activeLeadDetail.sourceAttribution.platform ?? "unknown").toUpperCase()}</div>
                  <div>内容：{activeLeadDetail.sourceAttribution.contentTitle ?? "未绑定"}</div>
                  <div>追踪链接：{activeLeadDetail.sourceAttribution.trackingSlug ?? "—"}</div>
                  <div>UTM：{activeLeadDetail.sourceAttribution.utmCampaign ?? "—"}</div>
                </div>
              </div>

              <div className="card" style={{ padding: "12px 14px" }}>
                <div className="head-row" style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>历史询盘</div>
                  <span className="badge line">{activeLeadDetail.inquiries.length}</span>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {activeLeadDetail.inquiries.map((inquiry) => (
                    <div key={inquiry.id} className="row-card" style={{ margin: 0 }}>
                      <div className="grow">
                        <div className="nm">
                          {inquiryPreview(inquiry)}
                          <span>{formatTime(inquiry.createdAt)}</span>
                        </div>
                        <div className="sub" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                          {inquiry.body.slice(0, 180)}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                          <span className="badge line">{sourceTypeLabel(inquiry.sourceType)}</span>
                          <button
                            type="button"
                            className="btn ghost sm"
                            disabled={draftBusyInquiryId === inquiry.id}
                            onClick={() => void requestReplyDraft(inquiry.id)}
                          >
                            {draftBusyInquiryId === inquiry.id ? "起草中…" : "起草首响"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!activeLeadDetail.inquiries.length ? (
                    <div className="sub">暂无询盘记录。</div>
                  ) : null}
                </div>
              </div>

              <div className="card" style={{ padding: "12px 14px" }}>
                <div className="head-row" style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>关联商机</div>
                  <span className="badge line">{activeLeadDetail.opportunities.length}</span>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {activeLeadDetail.opportunities.map((opportunity) => (
                    <div key={opportunity.id} className="row-card" style={{ margin: 0 }}>
                      <div className="grow">
                        <div className="nm">
                          {opportunity.name}
                          <span>{statusLabel(opportunity.stage)}</span>
                        </div>
                        <div className="sub" style={{ marginTop: 4 }}>
                          {opportunity.valueAmount
                            ? `${opportunity.currency} ${opportunity.valueAmount}`
                            : "待报价"}
                        </div>
                      </div>
                    </div>
                  ))}
                  {!activeLeadDetail.opportunities.length ? (
                    <div className="sub">当前还没有关联商机。</div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="sub">从上方线索池选择一条线索查看详情。</div>
          )}
        </div>

        <div className="card" style={{ padding: "14px 18px" }}>
          <div className="head-row" style={{ marginBottom: 10 }}>
            <div>
              <h3 style={{ fontSize: 16 }}>最近活动</h3>
              <div className="sub" style={{ marginTop: 4 }}>
                备注、阶段变更、跟进动作
              </div>
            </div>
            {selectedLeadId ? <span className="badge manual">{leadActivities.length}</span> : null}
          </div>

          {leadDetailLoading ? (
            <div className="sub">加载活动中…</div>
          ) : leadActivities.length > 0 ? (
            <div style={{ display: "grid", gap: 10 }}>
              {leadActivities.map((activity) => (
                <div key={activity.id} className="row-card" style={{ margin: 0 }}>
                  <div className="grow">
                    <div className="nm">
                      {activityTypeLabel(activity.type)}
                      <span>{formatTime(activity.createdAt)}</span>
                    </div>
                    <div className="sub" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                      {activity.body}
                    </div>
                    <div className="sub" style={{ marginTop: 6 }}>
                      {activity.actor?.name ?? "系统"} · {activity.actor?.email ?? "自动记录"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="sub">当前线索还没有活动记录。</div>
          )}
        </div>
      </div>

      <div className="head-row" style={{ marginTop: 22, marginBottom: 10 }}>
        <h3 style={{ fontSize: 16 }}>询盘列表</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className={`btn sm ${inquirySource === "all" ? "primary" : "ghost"}`}
            onClick={() => {
              setLoading(true);
              setInquirySource("all");
            }}
          >
            全部
          </button>
          <button
            type="button"
            className={`btn sm ${inquirySource === "form" ? "primary" : "ghost"}`}
            onClick={() => {
              setLoading(true);
              setInquirySource("form");
            }}
          >
            表单
          </button>
          <button
            type="button"
            className={`btn sm ${inquirySource === "email" ? "primary" : "ghost"}`}
            onClick={() => {
              setLoading(true);
              setInquirySource("email");
            }}
          >
            邮件
          </button>
        </div>
      </div>
      <div className="sub" style={{ marginBottom: 10 }}>
        按最新时间倒序，仅展示最新 20 条，减少测试/历史噪音。
      </div>
      <div className="card" style={{ padding: "6px 18px" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>来源</th>
              <th>客户 / 联系人</th>
              <th>询盘内容</th>
              <th>首响状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleInquiries.map((inquiry) => (
              <tr key={inquiry.id}>
                <td>
                  <span className="badge line">{sourceTypeLabel(inquiry.sourceType)}</span>
                  <div className="sub" style={{ marginTop: 6 }}>
                    {(inquiry.sourceAttribution.platform ?? "unknown").toUpperCase()}
                  </div>
                </td>
                <td>
                  <b>{inquiry.lead.companyName ?? inquiry.fromName ?? "匿名询盘"}</b>
                  <div className="sub" style={{ marginTop: 4 }}>
                    {inquiry.fromName ?? inquiry.lead.contactName ?? "未留姓名"}
                    {" · "}
                    {inquiry.fromEmail ?? inquiry.lead.contactEmail ?? "未留邮箱"}
                  </div>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{inquiryPreview(inquiry)}</div>
                  <div className="sub" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                    {inquiry.bodyPreview}
                  </div>
                  <div className="sub" style={{ marginTop: 6 }}>
                    {formatTime(inquiry.createdAt)}
                  </div>
                </td>
                <td>
                  {inquiry.latestReply ? (
                    <>
                      <span className={`badge ${inquiry.latestReply.status === "sent" ? "good" : "manual"}`}>
                        {statusLabel(inquiry.latestReply.status)}
                      </span>
                      <div className="sub" style={{ marginTop: 6 }}>
                        {formatTime(inquiry.latestReply.sentAt ?? inquiry.latestReply.updatedAt)}
                      </div>
                    </>
                  ) : (
                    <span className="sub">未起草</span>
                  )}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => {
                        setLeadDetailLoading(true);
                        setSelectedLeadId(inquiry.lead.id);
                      }}
                    >
                      查看线索
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={draftBusyInquiryId === inquiry.id}
                      onClick={() => void requestReplyDraft(inquiry.id)}
                    >
                      {draftBusyInquiryId === inquiry.id ? "起草中…" : "用 AI 起草首响"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!visibleInquiries.length ? (
              <tr>
                <td colSpan={5}>
                  <div className="sub" style={{ padding: "12px 0" }}>当前过滤条件下没有询盘。</div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

const STAGES: Array<{ key: string; label: string }> = [
  { key: "new", label: "新建" },
  { key: "contacted", label: "已联系" },
  { key: "quoted", label: "已报价" },
  { key: "won", label: "赢单" },
  { key: "lost", label: "丢单" },
];
