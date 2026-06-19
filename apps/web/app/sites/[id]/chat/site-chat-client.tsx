"use client";

import { useEffect, useState } from "react";
import {
  fetchCurrentMe,
  LoginRequiredError,
  redirectToLogin,
  type MeResponse,
} from "@/app/_lib/auth-client";

type SiteDetail = {
  project: {
    id: string;
    name: string;
    slug: string;
    market: string | null;
    product: string | null;
    style: string | null;
    cta: string | null;
    defaultLocale: string;
    status: "draft" | "published" | "offline";
  };
  pages: Array<{
    id: string;
    pageType: string;
    title: string;
    slug: string;
    isHomepage: boolean;
    content: {
      sections?: Array<{
        id?: string;
        heading?: string;
        body?: string;
        bullets?: string[];
      }>;
    };
  }>;
  locales: Array<{
    id: string;
    locale: "en" | "ar" | "ru" | "fr" | "de" | "pt";
    direction: "ltr" | "rtl";
    urlPath: string;
    seoTitle: string | null;
    seoDescription: string | null;
    publishStatus: "pending" | "published" | "failed" | "offline";
    translatedContent: {
      title: string;
      headline: string;
      subheadline: string;
      ctaLabel: string;
      sections: Array<{
        id: string;
        heading: string;
        body: string;
        bullets: string[];
        sourceCitations: string[];
      }>;
      faq: Array<{
        question: string;
        answer: string;
        sourceCitations: string[];
      }>;
    };
  }>;
  version: {
    id: string;
    versionNumber: number;
    note: string | null;
    assistantReply: string;
    previewChecks: Array<{
      key: string;
      label: string;
      status: "pass" | "warn";
      detail: string;
    }>;
    badges: {
      seo: boolean;
      geo: boolean;
      responsive: boolean;
      ogVk: boolean;
      trackingLinks: boolean;
    };
    citations: Array<{
      sourceCitation: string;
      excerpt: string;
    }>;
    conversation: Array<{
      role: "assistant" | "user";
      content: string;
      createdAt: string;
    }>;
  } | null;
};

function roleAllowsEdit(role: string | undefined) {
  return role === "owner" || role === "admin" || role === "operator";
}

function localeLabel(locale: SiteDetail["locales"][number]["locale"]) {
  return locale.toUpperCase();
}

function formatStatus(status: SiteDetail["project"]["status"] | SiteDetail["locales"][number]["publishStatus"]) {
  return status === "published"
    ? "published"
    : status === "draft"
      ? "draft"
      : status === "pending"
        ? "pending"
        : status === "failed"
          ? "failed"
          : "offline";
}

export function SiteChatClient({ siteId }: { siteId: string }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [detail, setDetail] = useState<SiteDetail | null>(null);
  const [selectedLocale, setSelectedLocale] = useState<string>("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
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

        if (!active) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "加载用户失败。");
        setLoading(false);
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

    async function loadSite() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/sites/${siteId}`, {
          headers: {
            "X-Tenant-Id": selectedTenantId,
          },
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error?.message ?? "加载站点失败。");
        }

        const payload = (await response.json()) as SiteDetail;

        if (!active) {
          return;
        }

        setDetail(payload);
        setSelectedLocale((current) => current || payload.locales[0]?.locale || "");
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "加载站点失败。");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadSite();

    return () => {
      active = false;
    };
  }, [selectedTenantId, siteId]);

  const currentMembership =
    me?.memberships.find((membership) => membership.tenantId === selectedTenantId) ?? null;
  const currentLocale =
    detail?.locales.find((locale) => locale.locale === selectedLocale) ?? detail?.locales[0] ?? null;
  const badges = detail?.version
    ? [
        { label: "SEO", active: detail.version.badges.seo },
        { label: "GEO", active: detail.version.badges.geo },
        { label: "响应式", active: detail.version.badges.responsive },
        { label: "OG/VK", active: detail.version.badges.ogVk },
        { label: "追踪链接", active: detail.version.badges.trackingLinks },
      ]
    : [];

  async function submitMessage() {
    if (!selectedTenantId || !message.trim()) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/sites/${siteId}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": selectedTenantId,
        },
        body: JSON.stringify({
          message: message.trim(),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "站点更新失败。");
      }

      const payload = (await response.json()) as SiteDetail;
      setDetail(payload);
      setSelectedLocale((current) => current || payload.locales[0]?.locale || "");
      setMessage("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "站点更新失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="head-row" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow">AI Site Builder</div>
          <h2 className="sec" style={{ marginTop: 4 }}>
            {detail?.project.name ?? "站点草稿"}
          </h2>
          <div className="sub" style={{ marginTop: 4 }}>
            左侧对话改稿，右侧按 locale 预览当前站点。内容只允许引用已核准的公开知识。
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            className="btn ghost sm"
            value={selectedTenantId}
            onChange={(event) => setSelectedTenantId(event.target.value)}
          >
            {me?.memberships.map((membership) => (
              <option key={membership.tenantId} value={membership.tenantId}>
                {membership.tenantName}
              </option>
            ))}
          </select>
          <span className={`st ${detail ? formatStatus(detail.project.status) : "pending"}`}>
            {detail ? detail.project.status : "loading"}
          </span>
          <span className="badge line">
            {detail ? `v${detail.version?.versionNumber ?? 0}` : "加载中"}
          </span>
        </div>
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
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="split">
        <div className="card chat split-chat">
          <div className="chat-head">
            <div className="ai">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="4" width="18" height="14" rx="2" />
                <path d="M3 9h18" />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <b>建站专家</b>
              <br />
              <span>
                {currentMembership ? `当前角色：${currentMembership.role}` : "加载角色中"} · public KB only
              </span>
            </div>
          </div>

          <div className="chat-body">
            {detail?.version?.conversation?.length ? (
              detail.version.conversation.map((item, index) => (
                <div
                  key={`${item.createdAt}-${index}`}
                  className={`msg ${item.role === "assistant" ? "a" : "u"}`}
                >
                  {item.content}
                </div>
              ))
            ) : (
              <div className="msg a">
                {loading
                  ? "正在加载站点对话…"
                  : "告诉我你想改的市场表达、卖点顺序、FAQ、CTA 或语气，我会保留版本快照并只引用公开知识。"}
              </div>
            )}

            {badges.length > 0 ? (
              <div className="msg a">
                当前站点基线已挂载：
                <div className="chips">
                  {badges.map((badge) => (
                    <span key={badge.label} className="chip">
                      {badge.label} {badge.active ? "✓" : "·"}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="chat-compose">
            <textarea
              className="chat-textarea"
              placeholder="例如：首屏更强调交期；新增一段认证说明；阿语版语气再正式一点。"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={!roleAllowsEdit(currentMembership?.role) || submitting}
            />
            <div className="chat-compose-meta">
              <span className="sub">会保留版本快照；引用会被限制在 public 知识范围内。</span>
              <button
                type="button"
                className="btn primary"
                onClick={() => void submitMessage()}
                disabled={!roleAllowsEdit(currentMembership?.role) || submitting || !message.trim()}
              >
                {submitting ? "更新中…" : "发送修改"}
              </button>
            </div>
          </div>
        </div>

        <div className="card preview">
          <div className="pv-bar">
            <span className="pv-dot" />
            <span className="pv-dot" />
            <span className="pv-dot" />
            <span className="pv-url">
              {currentLocale ? currentLocale.urlPath : "/site/..."}
            </span>
            <div className="langtab">
              {detail?.locales.map((locale) => (
                <b
                  key={locale.id}
                  className={selectedLocale === locale.locale ? "on" : ""}
                  onClick={() => setSelectedLocale(locale.locale)}
                >
                  {localeLabel(locale.locale)}
                </b>
              ))}
            </div>
          </div>

          {currentLocale ? (
            <>
              <div className={`pv-body ${currentLocale.direction === "rtl" ? "pv-rtl" : ""}`}>
                <div className="badge line" style={{ marginBottom: 12 }}>
                  {currentLocale.publishStatus}
                </div>
                <div className="pv-hero">{currentLocale.translatedContent.headline}</div>
                <div className="pv-sub">{currentLocale.translatedContent.subheadline}</div>
                <div className="pv-cta">{currentLocale.translatedContent.ctaLabel}</div>

                <div className="pv-grid" style={{ marginTop: 18 }}>
                  {currentLocale.translatedContent.sections.map((section) => (
                    <article className="pv-card" key={section.id}>
                      <h4>{section.heading}</h4>
                      <p>{section.body}</p>
                      {section.bullets.length ? (
                        <ul className="pv-bullets">
                          {section.bullets.map((bullet) => (
                            <li key={bullet}>{bullet}</li>
                          ))}
                        </ul>
                      ) : null}
                      {section.sourceCitations.length ? (
                        <div className="chips">
                          {section.sourceCitations.map((citation) => (
                            <span className="chip" key={citation}>
                              {citation}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>

                {currentLocale.translatedContent.faq.length ? (
                  <div className="pv-stack" style={{ marginTop: 18 }}>
                    <h4 className="sec" style={{ fontSize: 16 }}>FAQ</h4>
                    {currentLocale.translatedContent.faq.map((item) => (
                      <article className="pv-card" key={item.question}>
                        <h4>{item.question}</h4>
                        <p>{item.answer}</p>
                      </article>
                    ))}
                  </div>
                ) : null}

                <div className="pv-meta-grid" style={{ marginTop: 18 }}>
                  <div className="pv-panel">
                    <div className="head-row" style={{ marginBottom: 10 }}>
                      <h4 style={{ fontSize: 15 }}>预览体检</h4>
                      <span className="badge line">{detail?.version?.previewChecks.length ?? 0} 项</span>
                    </div>
                    <div className="pv-stack">
                      {detail?.version?.previewChecks.map((check) => (
                        <div className="pv-note" key={check.key}>
                          <div className="head-row" style={{ marginBottom: 4 }}>
                            <b>{check.label}</b>
                            <span className={`st ${check.status === "pass" ? "approved" : "pending"}`}>
                              {check.status === "pass" ? "通过" : "关注"}
                            </span>
                          </div>
                          <p>{check.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pv-panel">
                    <div className="head-row" style={{ marginBottom: 10 }}>
                      <h4 style={{ fontSize: 15 }}>溯源</h4>
                      <span className="badge line">{detail?.version?.citations.length ?? 0} 条</span>
                    </div>
                    <div className="pv-stack">
                      {detail?.version?.citations.length ? (
                        detail.version.citations.map((item) => (
                          <div className="pv-note" key={item.sourceCitation}>
                            <b>{item.sourceCitation}</b>
                            <p>{item.excerpt}</p>
                          </div>
                        ))
                      ) : (
                        <div className="sub">当前版本还没有可展示的引用。</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="pv-foot">
                <div className="sub">
                  {detail?.project.product ?? "未命名产品"} · {detail?.project.market ?? "未命名市场"}
                </div>
                <a className="btn ghost sm" href={`/site/${detail?.project.slug}/${currentLocale.locale}`} target="_blank" rel="noreferrer">
                  打开公开页
                </a>
              </div>
            </>
          ) : (
            <div className="pv-body">
              <div className="msg a" style={{ maxWidth: "100%" }}>
                {loading ? "正在加载预览…" : "当前站点还没有 locale 草稿。"}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
