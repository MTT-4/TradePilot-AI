"use client";

import { useEffect, useState } from "react";
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

async function fetchCrm(tenantId: string) {
  const headers = {
    "X-Tenant-Id": tenantId,
  };
  const [leadsRes, opportunitiesRes] = await Promise.all([
    fetch("/api/crm/leads", { headers }),
    fetch("/api/crm/opportunities", { headers }),
  ]);

  if (!leadsRes.ok) {
    const payload = await leadsRes.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载线索失败。");
  }

  if (!opportunitiesRes.ok) {
    const payload = await opportunitiesRes.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "加载商机失败。");
  }

  return {
    leads: ((await leadsRes.json()) as LeadsResponse).items,
    opportunities: ((await opportunitiesRes.json()) as OpportunitiesResponse).items,
  };
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function CrmClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageBusyId, setStageBusyId] = useState<string | null>(null);

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

    void fetchCrm(selectedTenantId)
      .then((payload) => {
        if (active) {
          setError(null);
          setLeads(payload.leads);
          setOpportunities(payload.opportunities);
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
  }, [selectedTenantId]);

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
      const refreshed = await fetchCrm(selectedTenantId);
      setLeads(refreshed.leads);
      setOpportunities(refreshed.opportunities);
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "更新阶段失败。");
    } finally {
      setStageBusyId(null);
    }
  }

  const stageColumns = STAGES.map((stage) => ({
    ...stage,
    items: opportunities.filter((item) => item.stage.toLowerCase() === stage.key),
  }));
  const otherOpportunities = opportunities.filter(
    (item) => !STAGES.some((stage) => stage.key === item.stage.toLowerCase()),
  );

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

      <div className="stat-strip" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat">
          <div className="v">{leads.length}</div>
          <div className="l">线索数</div>
        </div>
        <div className="stat">
          <div className="v">{opportunities.length}</div>
          <div className="l">商机数</div>
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
        <span className="badge line">{leads.length} 条</span>
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
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td>
                  <b>{lead.companyName}</b>
                  {lead.country ? (
                    <span className="sub" style={{ marginLeft: 6 }}>{lead.country}</span>
                  ) : null}
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
                  {lead.latestInquiry?.subject ?? "无"}
                  {lead.latestInquiry ? (
                    <div className="sub">{formatTime(lead.latestInquiry.createdAt)}</div>
                  ) : null}
                </td>
                <td>
                  <span className={`st ${lead.status}`}>{statusLabel(lead.status)}</span>
                </td>
              </tr>
            ))}
            {!leads.length ? (
              <tr>
                <td colSpan={5}>
                  <div className="sub" style={{ padding: "12px 0" }}>当前没有线索数据。</div>
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
