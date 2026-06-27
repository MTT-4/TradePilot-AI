"use client";

import { useEffect, useState } from "react";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";

type QuotationDraft = {
  product: string;
  quantity: string;
  currency: string;
  incoterm: "FOB" | "CIF" | "EXW";
  moq: number | null;
  unitPrice: number | null;
  tiers: Array<{
    minQty: number;
    discountPercent: number;
    unitPrice: number | null;
  }>;
  validUntil: string;
  paymentTerms: string;
  needs_base_cost: boolean;
  requires_human_confirmation: true;
  confirmation_checklist: string[];
  warnings: string[];
  draft_text: string;
};

type QuotationFormState = {
  inquiryId: string;
  product: string;
  quantity: string;
  baseUnitCost: string;
  incoterm: "FOB" | "CIF" | "EXW";
  currency: string;
  marginPercent: string;
};

const EMPTY_FORM: QuotationFormState = {
  inquiryId: "",
  product: "",
  quantity: "",
  baseUnitCost: "",
  incoterm: "FOB",
  currency: "USD",
  marginPercent: "",
};

async function requestQuotationDraft(
  tenantId: string,
  form: QuotationFormState,
): Promise<QuotationDraft> {
  const payload: Record<string, unknown> = {
    incoterm: form.incoterm,
  };

  if (form.inquiryId.trim()) payload.inquiryId = form.inquiryId.trim();
  if (form.product.trim()) payload.product = form.product.trim();
  if (form.quantity.trim()) payload.quantity = form.quantity.trim();
  if (form.currency.trim()) payload.currency = form.currency.trim().toUpperCase();
  const baseUnitCost = Number(form.baseUnitCost);
  if (form.baseUnitCost.trim() && Number.isFinite(baseUnitCost)) {
    payload.baseUnitCost = baseUnitCost;
  }
  const marginPercent = Number(form.marginPercent);
  if (form.marginPercent.trim() && Number.isFinite(marginPercent)) {
    payload.marginPercent = marginPercent;
  }

  const response = await fetch("/api/skills/quotation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-Id": tenantId,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message ?? "生成报价草稿失败。");
  }

  return (await response.json()) as QuotationDraft;
}

function renderMoney(currency: string, value: number | null) {
  if (value == null) {
    return "[待确认]";
  }
  return `${currency} ${value.toFixed(2)}`;
}

export function QuotationClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [form, setForm] = useState<QuotationFormState>(EMPTY_FORM);
  const [draft, setDraft] = useState<QuotationDraft | null>(null);
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
          redirectToLogin("/quotation");
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
      const result = await requestQuotationDraft(tenantId, form);
      setDraft(result);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "生成报价草稿失败。");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="page-body"><div className="card" style={{ padding: 24 }}>加载中…</div></div>;
  }

  return (
    <div className="page-body">
      <div className="head-row">
        <div>
          <div className="eyebrow">技能入口</div>
          <h2 className="sec">报价助手</h2>
          <p className="sub">只产草稿，不发明成交价；未给成本时单价保持待确认。</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span className="badge local">本地规则</span>
          <span className="badge manual">人工确认必需</span>
          <span className="badge line">{me?.currentTenant?.tenantName ?? "当前租户"}</span>
        </div>
      </div>

      <div className="rules">
        <div className="ric">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
            <path d="M10.3 3.5 2.9 16.3A2 2 0 0 0 4.6 19h14.8a2 2 0 0 0 1.7-2.7L13.7 3.5a2 2 0 0 0-3.4 0z" />
          </svg>
        </div>
        <div>
          <div className="rt">价格与交期不自动承诺</div>
          <div className="rs">关键数字由业务人工确认后再对外发送；本页仅为报价草稿入口。</div>
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
              <h3 style={{ fontSize: 16 }}>输入参数</h3>
              <p className="sub">可直接填产品与数量，也可只给 `inquiryId` 让系统回填。</p>
            </div>
          </div>

          <div className="field">
            <label htmlFor="quotation-inquiry-id">询盘 ID</label>
            <input
              id="quotation-inquiry-id"
              value={form.inquiryId}
              onChange={(event) => setForm((current) => ({ ...current, inquiryId: event.target.value }))}
              placeholder="可选，例如 inq_xxx"
            />
          </div>
          <div className="field">
            <label htmlFor="quotation-product">产品</label>
            <input
              id="quotation-product"
              value={form.product}
              onChange={(event) => setForm((current) => ({ ...current, product: event.target.value }))}
              placeholder="例如 LED panel light"
            />
          </div>
          <div className="field">
            <label htmlFor="quotation-quantity">数量</label>
            <input
              id="quotation-quantity"
              value={form.quantity}
              onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
              placeholder="例如 1000 pcs"
            />
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="quotation-cost">基准成本</label>
              <input
                id="quotation-cost"
                inputMode="decimal"
                value={form.baseUnitCost}
                onChange={(event) => setForm((current) => ({ ...current, baseUnitCost: event.target.value }))}
                placeholder="可留空"
              />
            </div>
            <div className="field">
              <label htmlFor="quotation-margin">利润率 %</label>
              <input
                id="quotation-margin"
                inputMode="decimal"
                value={form.marginPercent}
                onChange={(event) => setForm((current) => ({ ...current, marginPercent: event.target.value }))}
                placeholder="可留空，走租户默认"
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="quotation-incoterm">贸易条款</label>
              <select
                id="quotation-incoterm"
                value={form.incoterm}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    incoterm: event.target.value as QuotationFormState["incoterm"],
                  }))
                }
              >
                <option value="FOB">FOB（离岸价）</option>
                <option value="CIF">CIF（到岸价）</option>
                <option value="EXW">EXW（工厂交货价）</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="quotation-currency">币种</label>
              <input
                id="quotation-currency"
                value={form.currency}
                onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
                placeholder="USD"
                maxLength={8}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button className="btn primary" type="submit" disabled={submitting || !tenantId}>
              {submitting ? "生成中…" : "生成报价草稿"}
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setForm(EMPTY_FORM);
                setDraft(null);
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
              <div className="v">{draft?.incoterm ?? "—"}</div>
              <div className="l">贸易条款</div>
            </div>
            <div className="stat">
              <div className="v">{draft ? renderMoney(draft.currency, draft.unitPrice) : "—"}</div>
              <div className="l">单价</div>
            </div>
            <div className="stat">
              <div className="v">{draft?.validUntil ?? "—"}</div>
              <div className="l">有效期</div>
            </div>
            <div className="stat">
              <div className="v">{draft?.moq ?? "—"}</div>
              <div className="l">起订量</div>
            </div>
          </div>

          <div className="preview card">
            <div className="pv-bar">
              <div className="pv-dot" />
              <div className="pv-dot" />
              <div className="pv-dot" />
              <div className="pv-url">/api/skills/quotation</div>
              <div className="langtab">
                <b className="on">草稿</b>
              </div>
            </div>
            <div className="pv-body">
              <div className="pv-hero">{draft?.product || "生成后在这里预览报价草稿"}</div>
              <div className="pv-sub">
                {draft
                  ? `${draft.quantity || "数量待补"} · ${draft.currency} · ${draft.incoterm}`
                  : "输入产品、数量、成本或 inquiryId，生成本地报价草稿。"}
              </div>

              <div className="pv-grid" style={{ marginTop: 18 }}>
                <div className="pv-card">
                  <h4>价格摘要</h4>
                  <ul className="pv-bullets">
                    <li>单价：{draft ? renderMoney(draft.currency, draft.unitPrice) : "—"}</li>
                    <li>起订量：{draft?.moq ?? "—"}</li>
                    <li>账期：{draft?.paymentTerms ?? "—"}</li>
                  </ul>
                </div>
                <div className="pv-card">
                  <h4>确认状态</h4>
                  <ul className="pv-bullets">
                    <li>{draft?.needs_base_cost ? "缺少成本，单价待人工填写" : "已按成本和利润率算出草稿单价"}</li>
                    <li>{draft?.requires_human_confirmation ? "发送前必须人工确认" : "—"}</li>
                    <li>交期始终保持人工确认</li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="pv-stats">
              {(draft?.warnings ?? ["尚未生成草稿"]).map((warning) => (
                <span className="pill" key={warning}>{warning}</span>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div className="head-row" style={{ marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 16 }}>报价正文与确认清单</h3>
                <p className="sub">直接给业务确认，不在这里触发发送。</p>
              </div>
              {draft?.requires_human_confirmation ? (
                <span className="badge manual">需人工确认</span>
              ) : null}
            </div>
            <div className="grid-2">
              <div className="card" style={{ padding: 16, background: "var(--surface-2)" }}>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font)", fontSize: 13 }}>
                  {draft?.draft_text ?? "生成后这里显示报价正文草稿。"}
                </pre>
              </div>
              <div>
                {(draft?.confirmation_checklist ?? ["等待生成报价草稿"]).map((item) => (
                  <div className="row-card" key={item}>
                    <div className="afi">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="m9 12 2 2 4-4" />
                        <path d="M21 12a9 9 0 1 1-6.2-8.56" />
                      </svg>
                    </div>
                    <div className="grow">
                      <div className="nm">{item}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
