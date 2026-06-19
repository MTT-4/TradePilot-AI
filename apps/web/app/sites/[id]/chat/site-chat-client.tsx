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

function statusChipClass(status: "pass" | "warn") {
  return status === "pass"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(24,121,78,0.14),_transparent_28%),linear-gradient(180deg,#f8f6ef_0%,#f3efe2_100%)] px-4 py-6 md:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="rounded-[28px] border border-[#d7d0be] bg-white/85 p-6 shadow-[0_24px_90px_rgba(71,56,18,0.08)] backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-3">
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#2d6b57]">
                AI Site Builder
              </p>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-[#1f241f] md:text-4xl">
                  {detail?.project.name ?? "站点草稿"}
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-7 text-[#5e5a4e] md:text-base">
                  左侧对话改稿，右侧预览当前 locale 内容。建站内容仅允许引用已核准的公开知识。
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <select
                className="rounded-2xl border border-[#d7d0be] bg-white px-4 py-2 text-sm text-[#1f241f]"
                value={selectedTenantId}
                onChange={(event) => setSelectedTenantId(event.target.value)}
              >
                {me?.memberships.map((membership) => (
                  <option key={membership.tenantId} value={membership.tenantId}>
                    {membership.tenantName}
                  </option>
                ))}
              </select>
              <div className="rounded-2xl border border-[#d7d0be] bg-[#f7f3e8] px-4 py-2 text-sm text-[#514c42]">
                {detail ? `v${detail.version?.versionNumber ?? 0}` : "加载中"}
              </div>
            </div>
          </div>

          {badges.length > 0 ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {badges.map((badge) => (
                <span
                  key={badge.label}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    badge.active
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-slate-500"
                  }`}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        {error ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </section>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[28px] border border-[#d7d0be] bg-white/85 p-5 shadow-[0_18px_70px_rgba(71,56,18,0.08)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#1f241f]">建站对话</h2>
                <p className="text-sm text-[#6a6457]">
                  {currentMembership ? `当前角色：${currentMembership.role}` : "加载角色中"}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {detail?.version?.conversation?.length ? (
                detail.version.conversation.map((item, index) => (
                  <article
                    key={`${item.createdAt}-${index}`}
                    className={`rounded-3xl px-4 py-3 text-sm leading-7 ${
                      item.role === "assistant"
                        ? "mr-8 border border-[#dbe8df] bg-[#f1f8f3] text-[#214736]"
                        : "ml-8 border border-[#eadfc7] bg-[#fff8ea] text-[#5a4a1b]"
                    }`}
                  >
                    <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] opacity-70">
                      {item.role === "assistant" ? "Builder" : "You"}
                    </div>
                    <div>{item.content}</div>
                  </article>
                ))
              ) : (
                <div className="rounded-3xl border border-dashed border-[#d7d0be] bg-[#fcfaf4] px-4 py-5 text-sm text-[#6a6457]">
                  {loading ? "正在加载站点对话…" : "当前还没有可展示的对话记录。"}
                </div>
              )}
            </div>

            <div className="mt-5 space-y-3">
              <textarea
                className="min-h-32 w-full rounded-3xl border border-[#d7d0be] bg-[#fffdf8] px-4 py-3 text-sm leading-7 text-[#1f241f] outline-none transition focus:border-[#2d6b57]"
                placeholder="例如：首屏更强调交期；加一段客户常见问题；阿语版语气更专业。"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                disabled={!roleAllowsEdit(currentMembership?.role) || submitting}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs leading-6 text-[#6a6457]">
                  会保留版本快照；引用会被限制在 public 知识范围内。
                </p>
                <button
                  type="button"
                  className="rounded-full bg-[#1f6a52] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#174f3d] disabled:cursor-not-allowed disabled:bg-[#88ab9d]"
                  onClick={() => void submitMessage()}
                  disabled={!roleAllowsEdit(currentMembership?.role) || submitting || !message.trim()}
                >
                  {submitting ? "更新中…" : "发送修改"}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-[#d7d0be] bg-white/85 p-5 shadow-[0_18px_70px_rgba(71,56,18,0.08)]">
            <div className="flex flex-col gap-4 border-b border-[#ece5d3] pb-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#1f241f]">预览草稿</h2>
                <p className="mt-1 text-sm text-[#6a6457]">
                  {currentLocale ? `${currentLocale.urlPath} · ${currentLocale.publishStatus}` : "等待数据"}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {detail?.locales.map((locale) => (
                  <button
                    key={locale.id}
                    type="button"
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] ${
                      selectedLocale === locale.locale
                        ? "border-[#1f6a52] bg-[#1f6a52] text-white"
                        : "border-[#d7d0be] bg-white text-[#514c42]"
                    }`}
                    onClick={() => setSelectedLocale(locale.locale)}
                  >
                    {locale.locale}
                  </button>
                ))}
              </div>
            </div>

            {currentLocale ? (
              <div
                className="mt-5 space-y-6"
                dir={currentLocale.direction}
              >
                <section className="rounded-[24px] border border-[#dfe7e1] bg-[linear-gradient(135deg,rgba(31,106,82,0.08),rgba(213,192,149,0.14))] p-6">
                  <div className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-[#2d6b57]">
                    Hero
                  </div>
                  <h3 className="text-3xl font-semibold tracking-tight text-[#19211d]">
                    {currentLocale.translatedContent.headline}
                  </h3>
                  <p className="mt-3 max-w-3xl text-base leading-8 text-[#4f514e]">
                    {currentLocale.translatedContent.subheadline}
                  </p>
                  <div className="mt-5 inline-flex rounded-full bg-[#1f6a52] px-4 py-2 text-sm font-medium text-white">
                    {currentLocale.translatedContent.ctaLabel}
                  </div>
                </section>

                <section className="grid gap-4 md:grid-cols-2">
                  {currentLocale.translatedContent.sections.map((section) => (
                    <article
                      key={section.id}
                      className="rounded-[24px] border border-[#ece5d3] bg-[#fffdf8] p-5"
                    >
                      <h4 className="text-lg font-semibold text-[#1f241f]">
                        {section.heading}
                      </h4>
                      <p className="mt-2 text-sm leading-7 text-[#5f594c]">
                        {section.body}
                      </p>
                      {section.bullets.length ? (
                        <ul className="mt-4 space-y-2 text-sm leading-7 text-[#3f413f]">
                          {section.bullets.map((bullet) => (
                            <li key={bullet} className="rounded-2xl bg-[#f5f0e4] px-3 py-2">
                              {bullet}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {section.sourceCitations.length ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {section.sourceCitations.map((citation) => (
                            <span
                              key={citation}
                              className="rounded-full border border-[#dbe8df] bg-[#f1f8f3] px-3 py-1 text-xs text-[#2d6b57]"
                            >
                              {citation}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </section>

                {currentLocale.translatedContent.faq.length ? (
                  <section className="rounded-[24px] border border-[#ece5d3] bg-[#fffdf8] p-5">
                    <h4 className="text-lg font-semibold text-[#1f241f]">FAQ</h4>
                    <div className="mt-4 space-y-4">
                      {currentLocale.translatedContent.faq.map((item) => (
                        <article key={item.question} className="rounded-2xl bg-[#f8f4ea] p-4">
                          <h5 className="font-medium text-[#1f241f]">{item.question}</h5>
                          <p className="mt-2 text-sm leading-7 text-[#5f594c]">{item.answer}</p>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="grid gap-4 xl:grid-cols-[0.7fr_0.3fr]">
                  <div className="rounded-[24px] border border-[#ece5d3] bg-[#fffdf8] p-5">
                    <h4 className="text-lg font-semibold text-[#1f241f]">预览体检</h4>
                    <div className="mt-4 space-y-3">
                      {detail?.version?.previewChecks.map((check) => (
                        <div
                          key={check.key}
                          className="flex flex-col gap-2 rounded-2xl border border-[#ece5d3] bg-white p-4 md:flex-row md:items-center md:justify-between"
                        >
                          <div>
                            <div className="font-medium text-[#1f241f]">{check.label}</div>
                            <div className="text-sm leading-7 text-[#635d51]">{check.detail}</div>
                          </div>
                          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${statusChipClass(check.status)}`}>
                            {check.status === "pass" ? "通过" : "关注"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-[#ece5d3] bg-[#fffdf8] p-5">
                    <h4 className="text-lg font-semibold text-[#1f241f]">溯源</h4>
                    <div className="mt-4 space-y-3">
                      {detail?.version?.citations.map((item) => (
                        <article key={item.sourceCitation} className="rounded-2xl bg-[#f1f8f3] p-4">
                          <div className="text-sm font-medium text-[#214736]">{item.sourceCitation}</div>
                          <div className="mt-2 text-xs leading-6 text-[#436153]">{item.excerpt}</div>
                        </article>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <div className="mt-6 rounded-3xl border border-dashed border-[#d7d0be] bg-[#fcfaf4] px-4 py-8 text-sm text-[#6a6457]">
                {loading ? "正在加载预览…" : "当前站点还没有 locale 草稿。"}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
