"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#faf7ee_0%,#efe4d0_100%)] px-4 py-6 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="rounded-[30px] border border-[#ddd3bd] bg-white/92 p-6 shadow-[0_22px_90px_rgba(50,41,22,0.08)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#2c6d56]">
                T6.1 / CRM
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#1f241f] md:text-4xl">
                询盘与归因
              </h1>
              <p className="mt-2 text-sm leading-7 text-[#655f52]">
                从询盘、线索到商机，保留平台、内容、追踪链接的归因链路。
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
            <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">线索数</div>
            <div className="mt-4 text-4xl font-semibold text-[#1f241f]">{leads.length}</div>
          </div>
          <div className="rounded-[26px] border border-[#ddd3bd] bg-white/90 p-5">
            <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">商机数</div>
            <div className="mt-4 text-4xl font-semibold text-[#1f241f]">{opportunities.length}</div>
          </div>
          <div className="rounded-[26px] border border-[#ddd3bd] bg-white/90 p-5">
            <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">高分线索</div>
            <div className="mt-4 text-4xl font-semibold text-[#1f241f]">
              {leads.filter((lead) => lead.score === "a").length}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[30px] border border-[#ddd3bd] bg-white/90 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1f241f]">最新线索</h2>
              <span className="text-xs text-[#6a6457]">{loading ? "加载中…" : `${leads.length} 条`}</span>
            </div>
            <div className="space-y-3">
              {leads.map((lead) => (
                <article key={lead.id} className="rounded-[24px] border border-[#ece5d3] bg-[#fffdf8] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#eef5f0] px-3 py-1 text-xs text-[#214735]">
                      {lead.sourceAttribution.platform?.toUpperCase() ?? "UNKNOWN"}
                    </span>
                    <span className="rounded-full border border-[#ddd3bd] px-3 py-1 text-xs text-[#6a6457]">
                      {lead.status}
                    </span>
                    {lead.score ? (
                      <span className="rounded-full bg-[#f8efe1] px-3 py-1 text-xs text-[#8b5a24]">
                        评分 {lead.score.toUpperCase()}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-[#1f241f]">{lead.companyName}</h3>
                  <div className="mt-2 text-sm leading-6 text-[#655f52]">
                    内容：{lead.sourceAttribution.contentTitle ?? "未绑定"} · Tracking：
                    {lead.sourceAttribution.trackingSlug ?? "无"}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[#655f52]">
                    最新询盘：{lead.latestInquiry?.subject ?? "无"} ·
                    {lead.latestInquiry ? ` ${formatTime(lead.latestInquiry.createdAt)}` : " 暂无时间"}
                  </div>
                </article>
              ))}
              {!leads.length ? (
                <div className="rounded-2xl border border-dashed border-[#ddd3bd] bg-[#faf6eb] px-4 py-5 text-sm text-[#6a6457]">
                  当前没有线索数据。
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-[30px] border border-[#ddd3bd] bg-white/90 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1f241f]">商机列表</h2>
              <span className="text-xs text-[#6a6457]">{opportunities.length} 条</span>
            </div>
            <div className="space-y-3">
              {opportunities.map((opportunity) => (
                <article key={opportunity.id} className="rounded-[24px] border border-[#ece5d3] bg-[#fffdf8] p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-[#7b745f]">
                    {opportunity.stage}
                  </div>
                  <h3 className="mt-2 text-lg font-semibold text-[#1f241f]">{opportunity.name}</h3>
                  <div className="mt-2 text-sm text-[#655f52]">{opportunity.companyName}</div>
                  <div className="mt-2 text-sm text-[#655f52]">
                    {opportunity.valueAmount
                      ? `${opportunity.currency} ${opportunity.valueAmount}`
                      : "暂未填写金额"}
                  </div>
                </article>
              ))}
              {!opportunities.length ? (
                <div className="rounded-2xl border border-dashed border-[#ddd3bd] bg-[#faf6eb] px-4 py-5 text-sm text-[#6a6457]">
                  当前没有商机数据。
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
