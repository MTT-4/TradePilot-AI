import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getPublicSiteLocalePageData,
  type SiteApiLocale,
} from "@/server/sites/service";
import { InquiryForm } from "./inquiry-form";

const supportedLocales = new Set<SiteApiLocale>([
  "en",
  "ar",
  "ru",
  "fr",
  "de",
  "pt",
]);

async function loadPageData(params: {
  slug: string;
  locale: string;
}) {
  if (!supportedLocales.has(params.locale as SiteApiLocale)) {
    notFound();
  }

  try {
    return await getPublicSiteLocalePageData({
      slug: params.slug,
      locale: params.locale as SiteApiLocale,
    });
  } catch {
    notFound();
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}): Promise<Metadata> {
  const resolvedParams = await params;
  const data = await loadPageData(resolvedParams);

  return {
    title: data.locale.seoTitle ?? data.locale.translatedContent.seoTitle,
    description:
      data.locale.seoDescription ?? data.locale.translatedContent.seoDescription,
    alternates: {
      canonical: data.absoluteUrl,
      languages: data.alternates,
    },
    openGraph: {
      type: "website",
      title: data.version?.ogMeta.title ?? data.locale.translatedContent.seoTitle,
      description:
        data.version?.ogMeta.description ??
        data.locale.translatedContent.seoDescription,
      url: data.absoluteUrl,
      locale: data.locale.locale,
      siteName: "TradePilot",
    },
    other: {
      "vk:title":
        data.version?.ogMeta.title ?? data.locale.translatedContent.seoTitle,
      "vk:description":
        data.version?.ogMeta.description ??
        data.locale.translatedContent.seoDescription,
    },
  };
}

export default async function PublicSiteLocalePage({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}) {
  const resolvedParams = await params;
  const data = await loadPageData(resolvedParams);
  const sections = data.locale.translatedContent.sections ?? [];
  const faqItems = data.locale.translatedContent.faq ?? [];
  const ctaLabel = data.locale.translatedContent.ctaLabel ?? "Contact us";
  const subheadline = data.locale.translatedContent.subheadline ?? "";

  return (
    <main
      dir={data.locale.direction}
      className="min-h-screen bg-[linear-gradient(180deg,#fbfaf5_0%,#f2eee1_100%)] text-[#1f241f]"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(data.jsonLd),
        }}
      />

      <section className="border-b border-[#e4dcc8] bg-[radial-gradient(circle_at_top_right,_rgba(16,112,76,0.16),_transparent_28%),linear-gradient(135deg,rgba(224,213,182,0.24),rgba(255,255,255,0.78))]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12 md:px-8 md:py-16">
          <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.22em] text-[#2c6d56]">
            <span className="rounded-full border border-[#cfe3d8] bg-[#f1f8f3] px-3 py-1">
              {data.project.product ?? data.project.name}
            </span>
            <span className="rounded-full border border-[#ddd3bd] bg-[#faf5e8] px-3 py-1">
              {data.project.market ?? "Global"}
            </span>
            <span className="rounded-full border border-[#ddd3bd] bg-white px-3 py-1">
              {data.locale.locale.toUpperCase()}
            </span>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-5">
              <p className="font-mono text-xs uppercase tracking-[0.32em] text-[#486757]">
                Quick Answer
              </p>
              <div className="rounded-[24px] border border-[#dce7e1] bg-[#f4faf7] p-5 text-sm leading-7 text-[#28523f]">
                {data.locale.quickAnswer}
              </div>
              <div>
                <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
                  {data.locale.translatedContent.headline}
                </h1>
                <p className="mt-4 max-w-3xl text-lg leading-8 text-[#55554d]">
                  {subheadline}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a
                  href="#inquiry-form"
                  className="rounded-full bg-[#1f6a52] px-5 py-3 text-sm font-medium text-white"
                >
                  {ctaLabel}
                </a>
                <span className="rounded-full border border-[#ddd3bd] bg-white px-4 py-3 text-sm text-[#5a564a]">
                  {data.locale.urlPath}
                </span>
              </div>
            </div>

            <aside className="rounded-[28px] border border-[#ddd3bd] bg-white/90 p-6 shadow-[0_24px_90px_rgba(54,45,23,0.08)]">
              <h2 className="text-lg font-semibold">Preview Health</h2>
              <div className="mt-4 space-y-3">
                {(data.version?.previewChecks ?? []).map((check) => (
                  <div
                    key={check.key}
                    className="rounded-2xl border border-[#ece5d3] bg-[#fffdf8] p-4"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="font-medium">{check.label}</div>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs ${
                          check.status === "pass"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {check.status === "pass" ? "通过" : "关注"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-7 text-[#666154]">
                      {check.detail}
                    </p>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-10 md:px-8 lg:grid-cols-2">
        {sections.map((section) => (
          <article
            key={section.id}
            className="rounded-[28px] border border-[#e4dcc8] bg-white p-6 shadow-[0_18px_70px_rgba(54,45,23,0.06)]"
          >
            <h2 className="text-2xl font-semibold tracking-tight">{section.heading}</h2>
            <p className="mt-3 text-base leading-8 text-[#55554d]">{section.body}</p>
            {section.bullets.length ? (
              <ul className="mt-5 space-y-2">
                {section.bullets.map((bullet) => (
                  <li
                    key={bullet}
                    className="rounded-2xl bg-[#f7f2e6] px-4 py-3 text-sm text-[#3d403b]"
                  >
                    {bullet}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </section>

      {faqItems.length ? (
        <section className="mx-auto w-full max-w-6xl px-4 pb-10 md:px-8">
          <div className="rounded-[28px] border border-[#e4dcc8] bg-white p-6 shadow-[0_18px_70px_rgba(54,45,23,0.06)]">
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="text-2xl font-semibold tracking-tight">FAQ</h2>
              <span className="rounded-full border border-[#dce7e1] bg-[#f1f8f3] px-3 py-1 text-xs text-[#2c6d56]">
                AI-ready FAQ
              </span>
            </div>
            <div className="space-y-4">
              {faqItems.map((item) => (
                <article key={item.question} className="rounded-2xl bg-[#faf6eb] p-5">
                  <h3 className="text-lg font-medium">{item.question}</h3>
                  <p className="mt-2 text-sm leading-7 text-[#5f594c]">{item.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-8">
        <div className="grid gap-6 lg:grid-cols-[0.7fr_0.3fr]">
          <InquiryForm
            tenantSlug={data.tenantSlug}
            ctaLabel={ctaLabel}
            preferredLocale={data.locale.locale}
          />

          <aside className="rounded-[28px] border border-[#e4dcc8] bg-[#f6f2e6] p-6">
            <h2 className="text-lg font-semibold">Hreflang</h2>
            <div className="mt-4 space-y-2">
              {(data.version?.hreflangs ?? []).map((item) => (
                <div
                  key={item.locale}
                  className="rounded-2xl border border-[#ddd3bd] bg-white px-4 py-3 text-sm"
                >
                  <div className="font-medium uppercase">{item.locale}</div>
                  <div className="mt-1 text-[#666154]">{item.href}</div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
