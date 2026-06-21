"use client";

import { useEffect, useState } from "react";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";

type ComplianceAssessment = {
  product: string;
  markets: string[];
  required_certifications: Array<{
    code: string;
    name: string;
    markets: string[];
    note: string;
  }>;
  hs_code_candidates: Array<{
    code: string;
    description: string;
  }>;
  country_risk: {
    country: string;
    needs_screening: boolean;
    note: string;
  };
  labeling_notes: string[];
  requires_expert_confirmation: true;
  rule_version: string;
  disclaimer: string;
};

type ComplianceFormState = {
  product: string;
  markets: string;
  country: string;
};

const EMPTY_FORM: ComplianceFormState = {
  product: "",
  markets: "EU,US",
  country: "",
};

async function requestComplianceAssessment(
  tenantId: string,
  form: ComplianceFormState,
): Promise<ComplianceAssessment> {
  const payload: Record<string, unknown> = {
    product: form.product.trim(),
  };
  const markets = form.markets
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (markets.length > 0) payload.markets = markets;
  if (form.country.trim()) payload.country = form.country.trim();

  const response = await fetch("/api/skills/compliance-risk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-Id": tenantId,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message ?? "生成合规评估失败。");
  }

  return (await response.json()) as ComplianceAssessment;
}

export function ComplianceRiskClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [form, setForm] = useState<ComplianceFormState>(EMPTY_FORM);
  const [assessment, setAssessment] = useState<ComplianceAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadMe() {
      try {
        const payload = await fetchCurrentMe();
        if (!active) return;
        setMe(payload);
        setTenantId(payload.currentTenant?.tenantId ?? payload.memberships[0]?.tenantId ?? "");
      } catch (loadError) {
        if (loadError instanceof LoginRequiredError) {
          redirectToLogin("/compliance-risk");
          return;
        }
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "加载租户信息失败。");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadMe();
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) {
      setError("缺少租户上下文。");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await requestComplianceAssessment(tenantId, form);
      setAssessment(result);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "生成合规评估失败。");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="content"><div className="card" style={{ padding: 24 }}>加载中…</div></div>;
  }

  return (
    <div className="content">
      <div className="head-row">
        <div>
          <div className="eyebrow">技能入口</div>
          <h2 className="sec">合规风险</h2>
          <p className="sub">本地规则给出认证、HS Code 和国家筛查提示，不输出法律结论。</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span className="badge local">本地规则库</span>
          <span className="badge manual">需专业机构确认</span>
          <span className="badge line">{me?.currentTenant?.tenantName ?? "当前租户"}</span>
        </div>
      </div>

      <div className="rules">
        <div className="ric">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z" />
            <path d="M9.5 12.5 11 14l4-4" />
          </svg>
        </div>
        <div>
          <div className="rt">规则库仅作合规前筛</div>
          <div className="rs">认证、报关、制裁名单都需要人工或专业机构做最终确认。</div>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ padding: 16, marginBottom: 18 }}>
          <span className="st failed">错误</span>
          <p className="sub" style={{ marginTop: 8 }}>{error}</p>
        </div>
      ) : null}

      <div className="split">
        <form className="card" style={{ padding: 20 }} onSubmit={submit}>
          <div className="head-row" style={{ marginBottom: 12 }}>
            <div>
              <h3 style={{ fontSize: 16 }}>评估输入</h3>
              <p className="sub">市场用逗号分隔，例如 `EU,US,UK`。</p>
            </div>
          </div>
          <div className="field">
            <label htmlFor="compliance-product">产品</label>
            <input
              id="compliance-product"
              value={form.product}
              onChange={(event) => setForm((current) => ({ ...current, product: event.target.value }))}
              placeholder="例如 bluetooth speaker"
            />
          </div>
          <div className="field">
            <label htmlFor="compliance-markets">目标市场</label>
            <input
              id="compliance-markets"
              value={form.markets}
              onChange={(event) => setForm((current) => ({ ...current, markets: event.target.value.toUpperCase() }))}
              placeholder="EU,US"
            />
          </div>
          <div className="field">
            <label htmlFor="compliance-country">目标国家</label>
            <input
              id="compliance-country"
              value={form.country}
              onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))}
              placeholder="例如 Germany / DE"
            />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button className="btn primary" type="submit" disabled={submitting || !tenantId || !form.product.trim()}>
              {submitting ? "评估中…" : "生成合规评估"}
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setForm(EMPTY_FORM);
                setAssessment(null);
                setError(null);
              }}
              disabled={submitting}
            >
              清空
            </button>
          </div>
        </form>

        <div style={{ display: "grid", gap: 18 }}>
          <div className="stat-strip">
            <div className="stat">
              <div className="v">{assessment?.markets.length ?? 0}</div>
              <div className="l">市场数量</div>
            </div>
            <div className="stat">
              <div className="v">{assessment?.required_certifications.length ?? 0}</div>
              <div className="l">认证候选</div>
            </div>
            <div className="stat">
              <div className="v">{assessment?.hs_code_candidates.length ?? 0}</div>
              <div className="l">HS 候选</div>
            </div>
            <div className="stat">
              <div className="v">{assessment?.country_risk.needs_screening ? "是" : "—"}</div>
              <div className="l">名单筛查</div>
            </div>
          </div>

          <div className="grid-2">
            <div className="card" style={{ padding: 20 }}>
              <div className="head-row" style={{ marginBottom: 12 }}>
                <div>
                  <h3 style={{ fontSize: 16 }}>认证与标签</h3>
                  <p className="sub">按产品关键词和目标市场给出参考。</p>
                </div>
              </div>
              {(assessment?.required_certifications ?? []).length > 0 ? (
                assessment?.required_certifications.map((item) => (
                  <div className="row-card" key={`${item.code}-${item.name}`}>
                    <div className="afi">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </div>
                    <div className="grow">
                      <div className="nm">
                        {item.code}
                        <span>{item.name}</span>
                      </div>
                      <div className="sub">{item.note}</div>
                    </div>
                    <span className="badge line">{item.markets.join(", ")}</span>
                  </div>
                ))
              ) : (
                <p className="sub">暂无命中的认证候选。</p>
              )}
              {(assessment?.labeling_notes ?? []).length > 0 ? (
                <div className="card" style={{ padding: 16, marginTop: 14, background: "var(--surface-2)" }}>
                  {(assessment?.labeling_notes ?? []).map((note) => (
                    <div className="row-card" key={note}>
                      <div className="grow">
                        <div className="nm">{note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="card" style={{ padding: 20 }}>
              <div className="head-row" style={{ marginBottom: 12 }}>
                <div>
                  <h3 style={{ fontSize: 16 }}>HS Code 与国家风险</h3>
                  <p className="sub">只给候选，不给最终裁定。</p>
                </div>
              </div>
              {(assessment?.hs_code_candidates ?? []).length > 0 ? (
                assessment?.hs_code_candidates.map((item) => (
                  <div className="row-card" key={`${item.code}-${item.description}`}>
                    <div className="grow">
                      <div className="nm">
                        {item.code}
                        <span>HS 候选</span>
                      </div>
                      <div className="sub">{item.description}</div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="sub">暂无 HS Code 候选。</p>
              )}

              <div className="card" style={{ padding: 16, marginTop: 14, background: "var(--surface-2)" }}>
                <div className="head-row" style={{ marginBottom: 8 }}>
                  <div>
                    <h4 style={{ fontSize: 15 }}>国家筛查</h4>
                    <p className="sub">{assessment?.country_risk.country || "未填写目标国家"}</p>
                  </div>
                  {assessment ? (
                    <span className={`badge ${assessment.country_risk.needs_screening ? "manual" : "line"}`}>
                      {assessment.country_risk.needs_screening ? "需筛查" : "参考"}
                    </span>
                  ) : null}
                </div>
                <p className="sub">{assessment?.country_risk.note ?? "生成后显示筛查提示。"}</p>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div className="head-row" style={{ marginBottom: 10 }}>
              <div>
                <h3 style={{ fontSize: 16 }}>免责声明</h3>
                <p className="sub">规则版本：{assessment?.rule_version ?? "—"}</p>
              </div>
              {assessment?.requires_expert_confirmation ? (
                <span className="badge manual">需专业确认</span>
              ) : null}
            </div>
            <p className="sub" style={{ fontSize: 13, lineHeight: 1.7 }}>
              {assessment?.disclaimer ?? "生成后显示合规免责声明。"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
