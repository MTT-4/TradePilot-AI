"use client";

import { useEffect, useState } from "react";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";

type FollowUpPlan = {
  leadId: string;
  persisted: boolean;
  steps: Array<{
    dayOffset: number;
    dueDate: string;
    channel: "email";
    action: string;
    status: "planned";
  }>;
  note: string;
};

type FollowUpFormState = {
  leadId: string;
  inquiryId: string;
  offsets: string;
  startDate: string;
  persist: boolean;
};

const EMPTY_FORM: FollowUpFormState = {
  leadId: "",
  inquiryId: "",
  offsets: "1,3,7,14,30",
  startDate: "",
  persist: false,
};

async function requestFollowUpPlan(
  tenantId: string,
  form: FollowUpFormState,
): Promise<FollowUpPlan> {
  const payload: Record<string, unknown> = {
    persist: form.persist,
  };
  if (form.leadId.trim()) payload.leadId = form.leadId.trim();
  if (form.inquiryId.trim()) payload.inquiryId = form.inquiryId.trim();
  if (form.startDate.trim()) payload.startDate = form.startDate.trim();
  if (form.offsets.trim()) {
    payload.offsets = form.offsets
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item) && item > 0);
  }

  const response = await fetch("/api/skills/follow-up", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-Id": tenantId,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message ?? "生成跟进计划失败。");
  }

  return (await response.json()) as FollowUpPlan;
}

export function FollowUpClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [form, setForm] = useState<FollowUpFormState>(EMPTY_FORM);
  const [plan, setPlan] = useState<FollowUpPlan | null>(null);
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
          redirectToLogin("/follow-up");
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
      const result = await requestFollowUpPlan(tenantId, form);
      setPlan(result);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "生成跟进计划失败。");
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
          <h2 className="sec">跟进节奏</h2>
          <p className="sub">生成可编辑的跟进计划；默认只出草案，除非显式 `persist=true`。</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span className="badge local">本地编排</span>
          <span className="badge manual">不会自动发送</span>
          <span className="badge line">{me?.currentTenant?.tenantName ?? "当前租户"}</span>
        </div>
      </div>

      <div className="rules">
        <div className="ric">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M8 6h13" />
            <path d="M8 12h13" />
            <path d="M8 18h13" />
            <path d="M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
        </div>
        <div>
          <div className="rt">默认只生成计划草案</div>
          <div className="rs">选中“写入 CRM 跟进任务”才会落到 `CrmActivity`，且仍然不会自动发信。</div>
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
              <p className="sub">`leadId` 与 `inquiryId` 至少填一个。</p>
            </div>
          </div>

          <div className="field">
            <label htmlFor="follow-up-lead-id">线索 ID</label>
            <input
              id="follow-up-lead-id"
              value={form.leadId}
              onChange={(event) => setForm((current) => ({ ...current, leadId: event.target.value }))}
              placeholder="例如 lead_xxx"
            />
          </div>
          <div className="field">
            <label htmlFor="follow-up-inquiry-id">询盘 ID</label>
            <input
              id="follow-up-inquiry-id"
              value={form.inquiryId}
              onChange={(event) => setForm((current) => ({ ...current, inquiryId: event.target.value }))}
              placeholder="例如 inq_xxx"
            />
          </div>
          <div className="field">
            <label htmlFor="follow-up-offsets">跟进天数</label>
            <input
              id="follow-up-offsets"
              value={form.offsets}
              onChange={(event) => setForm((current) => ({ ...current, offsets: event.target.value }))}
              placeholder="例如 1,3,7,14,30"
            />
          </div>
          <div className="field">
            <label htmlFor="follow-up-start-date">起始日期</label>
            <input
              id="follow-up-start-date"
              type="date"
              value={form.startDate}
              onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))}
            />
          </div>

          <div className="row-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <div className={`toggle ${form.persist ? "" : "off"}`} onClick={() => setForm((current) => ({ ...current, persist: !current.persist }))} />
            <div className="grow">
              <div className="nm">写入 CRM 跟进任务</div>
              <div className="sub">开启后会写入 `CrmActivity(type=follow_up)` 并更新最近到期日。</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button className="btn primary" type="submit" disabled={submitting || !tenantId}>
              {submitting ? "生成中…" : "生成跟进计划"}
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setForm(EMPTY_FORM);
                setPlan(null);
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
              <div className="v">{plan?.leadId ?? "—"}</div>
              <div className="l">目标线索</div>
            </div>
            <div className="stat">
              <div className="v">{plan?.steps.length ?? 0}</div>
              <div className="l">计划步数</div>
            </div>
            <div className="stat">
              <div className="v">{plan?.steps[0]?.dueDate ?? "—"}</div>
              <div className="l">首个日期</div>
            </div>
            <div className="stat">
              <div className="v">{plan?.persisted ? "已写入" : "草案"}</div>
              <div className="l">落库状态</div>
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div className="head-row" style={{ marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 16 }}>计划预览</h3>
                <p className="sub">{plan?.note ?? "生成后这里显示跟进节奏。"} </p>
              </div>
              {plan ? (
                <span className={`st ${plan.persisted ? "approved" : "draft"}`}>
                  {plan.persisted ? "已写入" : "草案"}
                </span>
              ) : null}
            </div>
            {(plan?.steps ?? []).length > 0 ? (
              plan?.steps.map((step) => (
                <div className="row-card" key={`${step.dayOffset}-${step.dueDate}`}>
                  <div className="afi">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M12 8v4l3 2" />
                      <circle cx="12" cy="12" r="8" />
                    </svg>
                  </div>
                  <div className="grow">
                    <div className="nm">
                      第 {step.dayOffset} 天
                      <span>{step.dueDate}</span>
                    </div>
                    <div className="sub">{step.action}</div>
                  </div>
                  <span className="badge line">{step.channel === "email" ? "邮件" : step.channel}</span>
                </div>
              ))
            ) : (
              <div className="card" style={{ padding: 16, background: "var(--surface-2)" }}>
                <p className="sub">尚未生成跟进计划。</p>
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ fontSize: 16, marginBottom: 10 }}>执行提醒</h3>
            {[
              "本页只负责生成节奏与任务，不负责发送邮件。",
              "若填写 inquiryId，会按当前租户与 owner-scope 校验访问权限。",
              "落库后仍建议在 CRM 中人工调整文案与具体跟进时机。",
            ].map((item) => (
              <div className="row-card" key={item}>
                <div className="afi">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 16h.01" />
                    <path d="M12 8v4" />
                    <circle cx="12" cy="12" r="9" />
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
  );
}
