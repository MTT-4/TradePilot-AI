import {
  HitlStatus,
  HitlTaskType,
  JobType,
  KnowledgeSensitivity,
  LocaleCode,
  LocaleDirection,
  Prisma,
  PublishStatus,
  SiteStatus,
} from "@prisma/client";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/server/api/errors";
import { hasMinimumRole } from "@/server/auth/rbac";
import type { TenantContext } from "@/server/db/tenant-context";
import { getPrismaClient } from "@/server/db/prisma";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import { markContentItemPublished } from "@/server/content-packs/service";
import { enqueueTenantJob } from "@/server/jobs/service";
import { approveReplySendTask } from "@/server/replies/service";

const apiLocaleSchema = z.enum(["en", "ar", "ru", "fr", "de", "pt"]);

const siteBriefSchema = z.object({
  market: z.string().trim().min(1).max(120),
  product: z.string().trim().min(1).max(120),
  locales: z.array(apiLocaleSchema).min(1).max(6),
  style: z.string().trim().min(1).max(120),
  cta: z.string().trim().min(1).max(120),
});

const previewCheckSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  status: z.enum(["pass", "warn"]),
  detail: z.string().trim().min(1).max(240),
});

const localeSectionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  heading: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(1200),
  bullets: z.array(z.string().trim().min(1).max(240)).max(6).default([]),
  sourceCitations: z.array(z.string().trim().min(1).max(240)).max(4).default([]),
});

const localeFaqSchema = z.object({
  question: z.string().trim().min(1).max(240),
  answer: z.string().trim().min(1).max(1000),
  sourceCitations: z.array(z.string().trim().min(1).max(240)).max(4).default([]),
});

const modelLocaleDraftSchema = z.object({
  locale: apiLocaleSchema,
  title: z.string().trim().min(1).max(160),
  headline: z.string().trim().min(1).max(200),
  subheadline: z.string().trim().min(1).max(600),
  ctaLabel: z.string().trim().min(1).max(120),
  sections: z.array(localeSectionSchema).min(2).max(8),
  faq: z.array(localeFaqSchema).max(4).default([]),
  seoTitle: z.string().trim().min(1).max(70),
  seoDescription: z.string().trim().min(1).max(180),
});

const modelPageSchema = z.object({
  pageType: z.string().trim().min(1).max(40),
  slug: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  isHomepage: z.boolean().default(false),
  sections: z.array(z.string().trim().min(1).max(40)).min(2).max(8),
});

const modelCitationSchema = z.object({
  sourceCitation: z.string().trim().min(1).max(240),
  excerpt: z.string().trim().min(1).max(360),
});

const modelDraftSchema = z.object({
  projectName: z.string().trim().min(1).max(120),
  assistantReply: z.string().trim().min(1).max(500),
  pages: z.array(modelPageSchema).min(1).max(3),
  locales: z.array(modelLocaleDraftSchema).min(1).max(6),
  previewChecks: z.array(previewCheckSchema).min(4).max(8),
  citations: z.array(modelCitationSchema).max(8).default([]),
});

const snapshotConversationMessageSchema = z.object({
  role: z.enum(["assistant", "user"]),
  content: z.string().trim().min(1).max(2000),
  createdAt: z.string().trim().min(1).max(64),
});

const snapshotSchema = z.object({
  brief: siteBriefSchema,
  assistantReply: z.string().trim().min(1).max(500),
  pages: z.array(modelPageSchema).min(1).max(3),
  locales: z.array(modelLocaleDraftSchema).min(1).max(6),
  previewChecks: z.array(previewCheckSchema).min(4).max(8),
  citations: z.array(modelCitationSchema).max(8).default([]),
  badges: z.object({
    seo: z.boolean(),
    geo: z.boolean(),
    responsive: z.boolean(),
    ogVk: z.boolean(),
    trackingLinks: z.boolean(),
  }),
  hreflangs: z
    .array(
      z.object({
        locale: apiLocaleSchema,
        href: z.string().trim().min(1).max(240),
      }),
    )
    .max(6)
    .default([]),
  robots: z
    .object({
      allowAiBots: z.boolean(),
      rules: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
    })
    .default({
      allowAiBots: true,
      rules: ["index,follow", "max-image-preview:large"],
    }),
  ogMeta: z
    .object({
      title: z.string().trim().min(1).max(120),
      description: z.string().trim().min(1).max(240),
      imageAlt: z.string().trim().min(1).max(160),
    })
    .default({
      title: "TradePilot site preview",
      description: "Public marketing site preview.",
      imageAlt: "TradePilot site preview card",
    }),
  autofillCandidates: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40),
        kind: z.enum(["product", "certification", "blog"]),
        title: z.string().trim().min(1).max(160),
        summary: z.string().trim().min(1).max(320),
        body: z.string().trim().min(1).max(1600),
        sourceCitations: z.array(z.string().trim().min(1).max(240)).max(6).default([]),
        status: z.enum(["draft", "pending_publish", "applied"]).default("draft"),
        updatedAt: z.string().trim().min(1).max(64),
      }),
    )
    .max(12)
    .default([]),
  conversation: z.array(snapshotConversationMessageSchema).max(40).default([]),
});

type ApiLocale = z.infer<typeof apiLocaleSchema>;
export type SiteBriefInput = z.infer<typeof siteBriefSchema>;
export type SiteApiLocale = ApiLocale;
type PreviewCheck = z.infer<typeof previewCheckSchema>;
type ModelLocaleDraft = z.infer<typeof modelLocaleDraftSchema>;
type ModelDraft = z.infer<typeof modelDraftSchema>;
type SnapshotConversationMessage = z.infer<typeof snapshotConversationMessageSchema>;
type SiteSnapshot = z.infer<typeof snapshotSchema>;
type SiteHreflang = SiteSnapshot["hreflangs"][number];
type AutofillCandidate = SiteSnapshot["autofillCandidates"][number];

type SearchItem = {
  id: string;
  chunkIndex: number;
  text: string;
  sourceCitation: string | null;
  locale: LocaleCode;
  product: string | null;
  market: string | null;
  sensitivity: KnowledgeSensitivity;
};

function toPrismaLocale(locale: ApiLocale) {
  return locale.toUpperCase() as LocaleCode;
}

function toApiLocale(locale: LocaleCode) {
  return locale.toLowerCase() as ApiLocale;
}

function toApiSiteStatus(status: SiteStatus) {
  return status.toLowerCase();
}

function toApiPublishStatus(status: PublishStatus) {
  return status.toLowerCase();
}

function getDirectionForLocale(locale: ApiLocale) {
  return locale === "ar" ? LocaleDirection.RTL : LocaleDirection.LTR;
}

function normalizeSlugPart(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

async function createUniqueSiteSlug(baseText: string) {
  const prisma = getPrismaClient();
  const baseSlug = normalizeSlugPart(baseText) || "site";

  for (let index = 0; index < 50; index += 1) {
    const candidate = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
    const existing = await prisma.siteProject.findFirst({
      where: {
        slug: candidate,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return candidate;
    }
  }

  throw new ApiError(409, "CONFLICT", "Unable to allocate a unique site slug.");
}

function getSourceLocale(brief: SiteBriefInput) {
  return brief.locales[0] ?? "en";
}

function buildGlossaryTerms(brief: SiteBriefInput) {
  return Array.from(
    new Set(
      [brief.product, "TradePilot"]
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  );
}

function protectGlossaryTerms(text: string, glossaryTerms: string[]) {
  let protectedText = text;
  const replacements: Array<{ placeholder: string; term: string }> = [];

  for (const [index, term] of glossaryTerms.entries()) {
    const placeholder = `TPGLOSSARYTOKEN${index}KEEP`;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "g");

    if (pattern.test(protectedText)) {
      protectedText = protectedText.replace(pattern, placeholder);
      replacements.push({
        placeholder,
        term,
      });
    }
  }

  return {
    protectedText,
    replacements,
  };
}

function restoreGlossaryTerms(
  text: string,
  replacements: Array<{ placeholder: string; term: string }>,
) {
  return replacements.reduce((current, item) => {
    const pattern = new RegExp(item.placeholder, "g");
    return current.replace(pattern, item.term);
  }, text);
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function buildRetrievalQuery(brief: SiteBriefInput, extraPrompt?: string) {
  return sanitizePublicPromptText(
    [
    brief.product,
    brief.market,
    brief.style,
    brief.cta,
    extraPrompt,
    "landing page value proposition faq proof points export buyers",
  ]
    .filter(Boolean)
    .join(" "),
  );
}

function sanitizePublicPromptText(text: string) {
  return text
    .replace(/\binternal[-_\s]?only\b/gi, "restricted")
    .replace(/\bconfidential\b/gi, "restricted")
    .replace(/\bpricing\b/gi, "commercial details")
    .replace(/\bprice\b/gi, "commercial details")
    .replace(/\bquote\b/gi, "commercial response")
    .replace(/\bcontract\b/gi, "agreement");
}

async function searchPublicKnowledge(params: {
  tenantContext: TenantContext;
  brief: SiteBriefInput;
  extraPrompt?: string;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const tokens = buildRetrievalQuery(params.brief, params.extraPrompt)
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter((token) => token.length >= 3)
    .slice(0, 8);

  const items = await tenantPrisma.knowledgeChunk.findMany({
    where: {
      sensitivity: KnowledgeSensitivity.PUBLIC,
      OR: tokens.length
        ? tokens.map((token) => ({
            OR: [
              {
                text: {
                  contains: token,
                  mode: "insensitive",
                },
              },
              {
                sourceCitation: {
                  contains: token,
                  mode: "insensitive",
                },
              },
              {
                product: {
                  contains: token,
                  mode: "insensitive",
                },
              },
              {
                market: {
                  contains: token,
                  mode: "insensitive",
                },
              },
            ],
          }))
        : undefined,
    },
    orderBy: [
      {
        updatedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
    take: 6,
    select: {
      id: true,
      chunkIndex: true,
      text: true,
      sourceCitation: true,
      locale: true,
      product: true,
      market: true,
      sensitivity: true,
    },
  });

  return items;
}

function extractJsonPayload(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1);
  }

  return candidate;
}

function buildAllowedCitationSet(knowledgeItems: SearchItem[]) {
  return new Set(
    knowledgeItems
      .map((item) => item.sourceCitation?.trim())
      .filter((value): value is string => Boolean(value)),
  );
}

function sanitizeCitations(
  citations: string[] | undefined,
  allowedCitations: Set<string>,
) {
  return (citations ?? []).filter((citation) => allowedCitations.has(citation));
}

function sanitizeModelLocaleDraft(
  draft: ModelLocaleDraft,
  allowedCitations: Set<string>,
) {
  return {
    ...draft,
    sections: draft.sections.map((section) => ({
      ...section,
      sourceCitations: sanitizeCitations(section.sourceCitations, allowedCitations),
    })),
    faq: draft.faq.map((item) => ({
      ...item,
      sourceCitations: sanitizeCitations(item.sourceCitations, allowedCitations),
    })),
  } satisfies ModelLocaleDraft;
}

function deriveQuickAnswer(localeDraft: ModelLocaleDraft) {
  const faqAnswer = localeDraft.faq?.[0]?.answer?.trim();

  if (faqAnswer) {
    return faqAnswer.slice(0, 220);
  }

  return (localeDraft.subheadline ?? localeDraft.headline ?? "")
    .trim()
    .slice(0, 220);
}

function buildCandidateSectionId(candidateId: string) {
  return `autofill-${candidateId}`;
}

function buildAutofillPageSlug(title: string) {
  return normalizeSlugPart(title).slice(0, 64) || "autofill-page";
}

function buildDefaultPreviewChecks(params?: {
  draft?: ModelDraft;
}): PreviewCheck[] {
  const localeDraft = params?.draft?.locales[0];
  const hasSeo =
    params?.draft?.locales.every(
      (locale) => Boolean(locale.seoTitle.trim()) && Boolean(locale.seoDescription.trim()),
    ) ?? true;
  const hasGeo = Boolean(localeDraft && deriveQuickAnswer(localeDraft) && params?.draft?.citations.length);
  const hasResponsive = Boolean(
    localeDraft &&
      localeDraft.sections.length <= 6 &&
      localeDraft.headline.length <= 140,
  );
  const hasForm = Boolean(localeDraft?.ctaLabel.trim());
  const hasShare = Boolean(localeDraft?.seoTitle.trim() && localeDraft?.seoDescription.trim());

  return [
    {
      key: "seo",
      label: "SEO",
      status: hasSeo ? "pass" : "warn",
      detail: hasSeo ? "TDK 与结构化标题已生成。" : "仍有 locale 缺少 TDK。",
    },
    {
      key: "geo",
      label: "GEO",
      status: hasGeo ? "pass" : "warn",
      detail: hasGeo
        ? "公开知识溯源与顶部快答已保留，适合 AI 摘要引用。"
        : "建议补足快答块或溯源信息。",
    },
    {
      key: "mobile",
      label: "移动端",
      status: hasResponsive ? "pass" : "warn",
      detail: hasResponsive ? "首屏、卖点和 CTA 保持窄屏可读。" : "文案区块偏多，建议压缩首屏长度。",
    },
    {
      key: "form",
      label: "询盘表单",
      status: hasForm ? "pass" : "warn",
      detail: hasForm ? "CTA 已收敛到单一询盘动作。" : "CTA 缺失，无法通过询盘表单检查。",
    },
    {
      key: "share",
      label: "OG/VK 分享卡",
      status: hasShare ? "pass" : "warn",
      detail: hasShare ? "分享卡标题和摘要已准备。" : "OG/VK 分享卡信息不完整。",
    },
  ];
}

function buildHreflangs(slug: string, locales: ModelLocaleDraft[]) {
  return locales.map((localeDraft) => ({
    locale: localeDraft.locale,
    href: `/site/${slug}/${localeDraft.locale}`,
  })) satisfies SiteHreflang[];
}

function buildOgMeta(params: {
  brief: SiteBriefInput;
  locales: ModelLocaleDraft[];
}) {
  const source = params.locales[0];

  return {
    title: source?.seoTitle ?? `${params.brief.product} | TradePilot`,
    description:
      source?.seoDescription ??
      `${params.brief.product} landing page for ${params.brief.market}.`,
    imageAlt: `${params.brief.product} marketing preview`,
  };
}

function buildRobotsRules() {
  return {
    allowAiBots: true,
    rules: [
      "index,follow",
      "max-image-preview:large",
      "max-snippet:-1",
      "max-video-preview:-1",
    ],
  };
}

function buildSnapshotBadges(draft: ModelDraft) {
  const checks = buildDefaultPreviewChecks({
    draft,
  });
  const hasPass = (key: string) =>
    checks.find((item) => item.key === key)?.status === "pass";

  return {
    seo: hasPass("seo"),
    geo: hasPass("geo"),
    responsive: hasPass("mobile"),
    ogVk: hasPass("share"),
    trackingLinks: true,
  };
}

function buildFallbackDraft(params: {
  brief: SiteBriefInput;
  knowledgeItems: SearchItem[];
  assistantReply: string;
  locales?: ApiLocale[];
}) {
  const citations = params.knowledgeItems
    .map((item) => ({
      sourceCitation: item.sourceCitation ?? `${item.product ?? "Knowledge"} chunk ${item.chunkIndex + 1}`,
      excerpt: item.text.slice(0, 240),
    }))
    .slice(0, 4);
  const allowedCitations = new Set(citations.map((item) => item.sourceCitation));
  const sections = [
    {
      id: "hero",
      heading: `${params.brief.product} for ${params.brief.market}`,
      body:
        params.knowledgeItems[0]?.text.slice(0, 280) ??
        `${params.brief.product} landing draft for ${params.brief.market} buyers.`,
      bullets: params.knowledgeItems
        .slice(0, 3)
        .map((item) => item.text.slice(0, 90)),
      sourceCitations: sanitizeCitations(
        params.knowledgeItems
          .slice(0, 2)
          .map((item) => item.sourceCitation ?? ""),
        allowedCitations,
      ),
    },
    {
      id: "proof",
      heading: "Why buyers shortlist this offer",
      body:
        params.knowledgeItems[1]?.text.slice(0, 280) ??
        `Style: ${params.brief.style}. CTA: ${params.brief.cta}.`,
      bullets: [
        `Built for ${params.brief.market}`,
        `Tone: ${params.brief.style}`,
        `CTA: ${params.brief.cta}`,
      ],
      sourceCitations: sanitizeCitations(
        params.knowledgeItems
          .slice(1, 3)
          .map((item) => item.sourceCitation ?? ""),
        allowedCitations,
      ),
    },
  ];
  const locales = (params.locales ?? params.brief.locales).map((locale) => ({
    locale,
    title: `${params.brief.product} landing`,
    headline: `${params.brief.product} for ${params.brief.market}`,
    subheadline: `Built from public knowledge only. Style: ${params.brief.style}.`,
    ctaLabel: params.brief.cta,
    sections,
    faq: [
      {
        question: `Is this draft grounded in public knowledge?`,
        answer: "Yes. Only publicly approved knowledge chunks were attached.",
        sourceCitations: [],
      },
    ],
    seoTitle: `${params.brief.product} | ${params.brief.market}`,
    seoDescription: `Public-knowledge draft for ${params.brief.product} in ${params.brief.market}.`,
  })) satisfies ModelLocaleDraft[];

  return {
    projectName: `${params.brief.product} · ${params.brief.market}`,
    assistantReply: params.assistantReply,
    pages: [
      {
        pageType: "landing",
        slug: "home",
        title: `${params.brief.product} Landing`,
        isHomepage: true,
        sections: sections.map((section) => section.id),
      },
    ],
    locales: locales.map((locale) =>
      sanitizeModelLocaleDraft(locale, allowedCitations),
    ),
    previewChecks: buildDefaultPreviewChecks(),
    citations,
  } satisfies ModelDraft;
}

async function callGoogleTranslateText(params: {
  text: string;
  sourceLocale: ApiLocale;
  targetLocale: ApiLocale;
  glossaryTerms: string[];
  fetchImpl?: typeof fetch;
}) {
  if (params.sourceLocale === params.targetLocale) {
    return params.text;
  }

  const env = getEnv();
  const fetchImpl = params.fetchImpl ?? fetch;
  const { protectedText, replacements } = protectGlossaryTerms(
    params.text,
    params.glossaryTerms,
  );
  const response = await fetchImpl(
    `${env.GOOGLE_TRANSLATE_BASE_URL}?key=${encodeURIComponent(env.GOOGLE_TRANSLATE_KEY)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: protectedText,
        target: params.targetLocale,
        source: params.sourceLocale,
        format: "text",
      }),
    },
  );

  if (!response.ok) {
    throw new ApiError(500, "INTERNAL", "Google Translate request failed.");
  }

  const payload = (await response.json()) as {
    data?: {
      translations?: Array<{
        translatedText?: string;
      }>;
    };
  };
  const translatedText = payload.data?.translations?.[0]?.translatedText;

  if (typeof translatedText !== "string") {
    throw new ApiError(500, "INTERNAL", "Google Translate response was empty.");
  }

  return restoreGlossaryTerms(
    decodeHtmlEntities(translatedText),
    replacements,
  );
}

async function translateLocaleDraft(params: {
  sourceLocaleDraft: ModelLocaleDraft;
  sourceLocale: ApiLocale;
  targetLocale: ApiLocale;
  brief: SiteBriefInput;
  fetchImpl?: typeof fetch;
}) {
  if (params.sourceLocale === params.targetLocale) {
    return {
      ...params.sourceLocaleDraft,
      locale: params.targetLocale,
      ctaLabel: params.brief.cta,
    } satisfies ModelLocaleDraft;
  }

  const glossaryTerms = buildGlossaryTerms(params.brief);
  const translate = (text: string) =>
    callGoogleTranslateText({
      text,
      sourceLocale: params.sourceLocale,
      targetLocale: params.targetLocale,
      glossaryTerms,
      fetchImpl: params.fetchImpl,
    });

  return {
    locale: params.targetLocale,
    title: await translate(params.sourceLocaleDraft.title),
    headline: await translate(params.sourceLocaleDraft.headline),
    subheadline: await translate(params.sourceLocaleDraft.subheadline),
    ctaLabel: await translate(params.brief.cta),
    sections: await Promise.all(
      params.sourceLocaleDraft.sections.map(async (section) => ({
        id: section.id,
        heading: await translate(section.heading),
        body: await translate(section.body),
        bullets: await Promise.all(section.bullets.map((bullet) => translate(bullet))),
        sourceCitations: section.sourceCitations,
      })),
    ),
    faq: await Promise.all(
      params.sourceLocaleDraft.faq.map(async (item) => ({
        question: await translate(item.question),
        answer: await translate(item.answer),
        sourceCitations: item.sourceCitations,
      })),
    ),
    seoTitle: await translate(params.sourceLocaleDraft.seoTitle),
    seoDescription: await translate(params.sourceLocaleDraft.seoDescription),
  } satisfies ModelLocaleDraft;
}

async function localizeDraft(params: {
  brief: SiteBriefInput;
  sourceDraft: ModelDraft;
  fetchImpl?: typeof fetch;
}) {
  const sourceLocale = getSourceLocale(params.brief);
  const sourceLocaleDraft =
    params.sourceDraft.locales.find((item) => item.locale === sourceLocale) ??
    params.sourceDraft.locales[0];

  if (!sourceLocaleDraft) {
    throw new ApiError(500, "INTERNAL", "Missing source locale draft.");
  }

  const localizedLocales = await Promise.all(
    params.brief.locales.map((locale) =>
      translateLocaleDraft({
        sourceLocaleDraft,
        sourceLocale,
        targetLocale: locale,
        brief: params.brief,
        fetchImpl: params.fetchImpl,
      }),
    ),
  );

  return {
    ...params.sourceDraft,
    locales: localizedLocales,
  } satisfies ModelDraft;
}

function parseModelDraft(params: {
  text: string;
  brief: SiteBriefInput;
  requestedLocales: ApiLocale[];
  knowledgeItems: SearchItem[];
  assistantReplyFallback: string;
}) {
  const allowedCitations = buildAllowedCitationSet(params.knowledgeItems);

  try {
    const parsed = modelDraftSchema.parse(
      JSON.parse(extractJsonPayload(params.text)),
    );
    const byLocale = new Map(
      parsed.locales.map((localeDraft) => [
        localeDraft.locale,
        sanitizeModelLocaleDraft(localeDraft, allowedCitations),
      ]),
    );
    const defaultLocale =
      byLocale.get(params.requestedLocales[0]) ??
      byLocale.values().next().value ??
      null;

    if (!defaultLocale) {
      throw new Error("Missing locale draft.");
    }

    const locales = params.requestedLocales.map((locale) => {
      const candidate = byLocale.get(locale);

      if (candidate) {
        return {
          ...candidate,
          ctaLabel: params.brief.cta,
        } satisfies ModelLocaleDraft;
      }

      return {
        ...defaultLocale,
        locale,
        ctaLabel: params.brief.cta,
      } satisfies ModelLocaleDraft;
    });
    const citations = parsed.citations.filter((item) =>
      allowedCitations.has(item.sourceCitation),
    );

    return {
      ...parsed,
      assistantReply:
        parsed.assistantReply.trim() || params.assistantReplyFallback,
      locales,
      citations,
    } satisfies ModelDraft;
  } catch {
    return buildFallbackDraft({
      brief: params.brief,
      knowledgeItems: params.knowledgeItems,
      assistantReply: params.assistantReplyFallback,
      locales: params.requestedLocales,
    });
  }
}

function buildSnapshot(params: {
  brief: SiteBriefInput;
  draft: ModelDraft;
  previousConversation?: SnapshotConversationMessage[];
  newMessages?: SnapshotConversationMessage[];
  autofillCandidates?: AutofillCandidate[];
}): SiteSnapshot {
  const conversation = [
    ...(params.previousConversation ?? []),
    ...(params.newMessages ?? []),
  ].slice(-40);

  return {
    brief: params.brief,
    assistantReply: params.draft.assistantReply,
    pages: params.draft.pages,
    locales: params.draft.locales,
    previewChecks:
      params.draft.previewChecks.length > 0
        ? params.draft.previewChecks
        : buildDefaultPreviewChecks({
            draft: params.draft,
          }),
    citations: params.draft.citations,
    badges: buildSnapshotBadges(params.draft),
    hreflangs: [],
    robots: buildRobotsRules(),
    ogMeta: buildOgMeta({
      brief: params.brief,
      locales: params.draft.locales,
    }),
    autofillCandidates: params.autofillCandidates ?? [],
    conversation,
  } satisfies SiteSnapshot;
}

function finalizeSnapshot(params: {
  brief: SiteBriefInput;
  draft: ModelDraft;
  slug: string;
  snapshot: SiteSnapshot;
}) {
  return {
    ...params.snapshot,
    previewChecks: buildDefaultPreviewChecks({
      draft: params.draft,
    }),
    badges: buildSnapshotBadges(params.draft),
    hreflangs: buildHreflangs(params.slug, params.draft.locales),
    robots: buildRobotsRules(),
    ogMeta: buildOgMeta({
      brief: params.brief,
      locales: params.draft.locales,
    }),
    autofillCandidates: params.snapshot.autofillCandidates ?? [],
  } satisfies SiteSnapshot;
}

async function persistSiteDraft(params: {
  tenantContext: TenantContext;
  siteProjectId: string;
  createdByUserId?: string;
  brief: SiteBriefInput;
  draft: ModelDraft;
  snapshot: SiteSnapshot;
  note: string;
  auditAction: "site_draft_generated" | "site_draft_updated";
}) {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const siteProject = await tx.siteProject.findFirst({
      where: {
        id: params.siteProjectId,
        tenantId: params.tenantContext.tenantId,
      },
      select: {
        id: true,
        slug: true,
        currentVersionId: true,
      },
    });

    if (!siteProject) {
      throw new ApiError(404, "NOT_FOUND", "Site project not found.");
    }

    const lastVersion = await tx.siteVersion.findFirst({
      where: {
        tenantId: params.tenantContext.tenantId,
        siteProjectId: params.siteProjectId,
      },
      orderBy: {
        versionNumber: "desc",
      },
      select: {
        versionNumber: true,
      },
    });
    const defaultLocale = params.brief.locales[0] ?? "en";
    const defaultLocaleContent =
      params.draft.locales.find((item) => item.locale === defaultLocale) ??
      params.draft.locales[0];
    const finalSnapshot = finalizeSnapshot({
      brief: params.brief,
      draft: params.draft,
      slug: siteProject.slug,
      snapshot: params.snapshot,
    });

    await tx.siteProject.update({
      where: {
        id: siteProject.id,
      },
      data: {
        name: params.draft.projectName,
        market: params.brief.market,
        product: params.brief.product,
        style: params.brief.style,
        cta: params.brief.cta,
        defaultLocale: toPrismaLocale(defaultLocale),
        status: SiteStatus.DRAFT,
      },
    });

    await tx.sitePage.deleteMany({
      where: {
        tenantId: params.tenantContext.tenantId,
        siteProjectId: params.siteProjectId,
      },
    });

    for (const page of params.draft.pages) {
      await tx.sitePage.create({
        data: {
          tenantId: params.tenantContext.tenantId,
          siteProjectId: params.siteProjectId,
          pageType: page.pageType,
          title: page.title,
          slug: page.slug,
          isHomepage: page.isHomepage,
          content: {
            sections: defaultLocaleContent.sections.filter((section) =>
              page.sections.includes(section.id),
            ),
          },
        },
      });
    }

    await tx.siteLocale.deleteMany({
      where: {
        tenantId: params.tenantContext.tenantId,
        siteProjectId: params.siteProjectId,
      },
    });

    for (const localeDraft of params.draft.locales) {
      await tx.siteLocale.create({
        data: {
          tenantId: params.tenantContext.tenantId,
          siteProjectId: params.siteProjectId,
          locale: toPrismaLocale(localeDraft.locale),
          direction: getDirectionForLocale(localeDraft.locale),
          urlPath: `/site/${siteProject.slug}/${localeDraft.locale}`,
          translatedContent: localeDraft,
          seoTitle: localeDraft.seoTitle,
          seoDescription: localeDraft.seoDescription,
          geoMetadata: {
            market: params.brief.market,
            product: params.brief.product,
            locale: localeDraft.locale,
            source: "public_kb_only",
            quickAnswer: deriveQuickAnswer(localeDraft),
          },
          publishStatus: PublishStatus.PENDING,
        },
      });
    }

    const version = await tx.siteVersion.create({
      data: {
        tenantId: params.tenantContext.tenantId,
        siteProjectId: params.siteProjectId,
        createdByUserId: params.createdByUserId,
        versionNumber: (lastVersion?.versionNumber ?? 0) + 1,
        snapshot: finalSnapshot,
        note: params.note,
      },
      select: {
        id: true,
        versionNumber: true,
      },
    });

    await tx.siteProject.update({
      where: {
        id: params.siteProjectId,
      },
      data: {
        currentVersionId: version.id,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: params.tenantContext.tenantId,
        actorUserId: params.createdByUserId,
        action: params.auditAction,
        entityType: "site_project",
        entityId: params.siteProjectId,
        metadata: {
          versionId: version.id,
          versionNumber: version.versionNumber,
          locales: params.brief.locales,
          citations: finalSnapshot.citations.map((item) => item.sourceCitation),
        },
      },
    });

    return version;
  });
}

function buildGenerationPrompt(brief: SiteBriefInput) {
  const sourceLocale = getSourceLocale(brief);

  return sanitizePublicPromptText(
    [
    "Create a B2B export landing site draft in JSON only.",
    `Market: ${brief.market}`,
    `Product: ${brief.product}`,
    `Source locale: ${sourceLocale}`,
    `Requested locales: ${brief.locales.join(", ")}`,
    `Style: ${brief.style}`,
    `CTA intent: ${brief.cta}`,
    "Requirements:",
    "- Use only attached public knowledge context.",
    "- Keep the copy suitable for public marketing pages.",
    "- Produce 1 to 3 pages, but default to 1 landing page.",
    "- Generate only the source locale content. Other locales will be translated later.",
    "- Include title, headline, subheadline, CTA, sections, FAQ, seoTitle, seoDescription for the source locale.",
    "- Keep citations only as exact sourceCitation strings from knowledge context.",
    "- Return JSON with keys: projectName, assistantReply, pages, locales, previewChecks, citations.",
    ].join("\n"),
  );
}

function buildChatPrompt(params: {
  brief: SiteBriefInput;
  message: string;
  snapshot: SiteSnapshot;
}) {
  const sourceLocale = getSourceLocale(params.brief);

  return sanitizePublicPromptText(
    [
    "Revise the existing B2B site draft and return JSON only.",
    `Market: ${params.brief.market}`,
    `Product: ${params.brief.product}`,
    `Source locale: ${sourceLocale}`,
    `Requested locales: ${params.brief.locales.join(", ")}`,
    `Style: ${params.brief.style}`,
    `CTA intent: ${params.brief.cta}`,
    "Current site snapshot JSON:",
    JSON.stringify({
      pages: params.snapshot.pages,
      locales: params.snapshot.locales,
      previewChecks: params.snapshot.previewChecks,
      citations: params.snapshot.citations,
    }),
    "User change request:",
    params.message,
    "Rules:",
    "- Preserve grounded facts and cite only attached public knowledge context.",
    "- If the request asks for unsupported facts, keep the wording generic instead of inventing specifics.",
    "- Return only the source locale draft. Other locales will be translated after the update.",
    "- Return the same JSON shape: projectName, assistantReply, pages, locales, previewChecks, citations.",
    ].join("\n"),
  );
}

async function generateDraftWithModel(params: {
  knowledgeItems: SearchItem[];
  prompt: string;
  fetchImpl?: typeof fetch;
}) {
  const env = getEnv();
  const fetchImpl = params.fetchImpl ?? fetch;
  const knowledgeContext = params.knowledgeItems
    .map((item, index) =>
      `${index + 1}. ${item.text}${item.sourceCitation ? ` (${item.sourceCitation})` : ""}`,
    )
    .join("\n");
  const response = await fetchImpl(
    `${env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You generate structured public marketing drafts. Reply with valid JSON only and do not wrap it in markdown.",
          },
          {
            role: "user",
            content: [params.prompt, knowledgeContext ? `Knowledge Context:\n${knowledgeContext}` : ""]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new ApiError(500, "INTERNAL", "OpenAI site generation request failed.");
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : "";

  if (!text.trim()) {
    throw new ApiError(500, "INTERNAL", "OpenAI site generation returned empty content.");
  }

  return {
    text,
  };
}

export async function createSiteGenerationRequest(params: {
  tenantContext: TenantContext;
  requestedByUserId?: string;
  brief: SiteBriefInput;
}) {
  const brief = siteBriefSchema.parse(params.brief);
  const prisma = getPrismaClient();
  const slug = await createUniqueSiteSlug(`${brief.product}-${brief.market}`);
  const siteProject = await prisma.siteProject.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      createdByUserId: params.requestedByUserId,
      name: `${brief.product} · ${brief.market}`,
      slug,
      market: brief.market,
      product: brief.product,
      style: brief.style,
      cta: brief.cta,
      defaultLocale: toPrismaLocale(brief.locales[0] ?? "en"),
      status: SiteStatus.DRAFT,
    },
    select: {
      id: true,
    },
  });
  const queued = await enqueueTenantJob({
    tenantContext: params.tenantContext,
    requestedByUserId: params.requestedByUserId,
    type: JobType.GENERATE_SITE,
    input: {
      siteId: siteProject.id,
      brief,
    },
  });

  return {
    siteId: siteProject.id,
    jobId: queued.jobId,
  };
}

export async function runGenerateSiteJob(params: {
  tenantId: string;
  requestedByUserId?: string;
  siteId: string;
  brief: SiteBriefInput;
  reportProgress?: (progress: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}) {
  const tenantContext: TenantContext = {
    tenantId: params.tenantId,
    userId: params.requestedByUserId ?? "system",
    role: "OWNER",
  };

  await params.reportProgress?.(15);
  const knowledgeItems = await searchPublicKnowledge({
    tenantContext,
    brief: params.brief,
  });
  await params.reportProgress?.(45);

  const modelResult = await generateDraftWithModel({
    knowledgeItems,
    prompt: buildGenerationPrompt(params.brief),
    fetchImpl: params.fetchImpl,
  });
  const sourceDraft = parseModelDraft({
    text: modelResult.text,
    brief: params.brief,
    requestedLocales: [getSourceLocale(params.brief)],
    knowledgeItems,
    assistantReplyFallback: "已基于公开知识生成站点草稿，可继续对话修改。",
  });
  const draft = await localizeDraft({
    brief: params.brief,
    sourceDraft,
    fetchImpl: params.fetchImpl,
  });
  const now = new Date().toISOString();
  const snapshot = buildSnapshot({
    brief: params.brief,
    draft,
    newMessages: [
      {
        role: "assistant",
        content: draft.assistantReply,
        createdAt: now,
      },
    ],
  });
  await params.reportProgress?.(80);

  const version = await persistSiteDraft({
    tenantContext,
    siteProjectId: params.siteId,
    createdByUserId: params.requestedByUserId,
    brief: params.brief,
    draft,
    snapshot,
    note: "Initial generated draft",
    auditAction: "site_draft_generated",
  });
  await params.reportProgress?.(100);

  return {
    siteId: params.siteId,
    versionId: version.id,
    versionNumber: version.versionNumber,
    citations: snapshot.citations.map((item) => item.sourceCitation),
    localeCount: draft.locales.length,
  };
}

function getSnapshotFromUnknown(
  value: unknown,
  fallbackBrief: SiteBriefInput,
): SiteSnapshot {
  const parsed = snapshotSchema.safeParse(value);

  if (parsed.success) {
    return parsed.data;
  }

  return buildSnapshot({
    brief: fallbackBrief,
    draft: buildFallbackDraft({
      brief: fallbackBrief,
      knowledgeItems: [],
      assistantReply: "Site snapshot recovered with fallback structure.",
    }),
  });
}

async function createAuditLog(params: {
  tenantId: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const prisma = getPrismaClient();

  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata,
    },
  });
}

async function createHitlTask(params: {
  tenantId: string;
  requestedByUserId?: string;
  type: HitlTaskType;
  status: HitlStatus;
  entityType: string;
  entityId: string;
  payload: Prisma.InputJsonValue;
}) {
  const prisma = getPrismaClient();

  return prisma.hitlTask.create({
    data: {
      tenantId: params.tenantId,
      requestedByUserId: params.requestedByUserId,
      type: params.type,
      status: params.status,
      entityType: params.entityType,
      entityId: params.entityId,
      payload: params.payload,
    },
    select: {
      id: true,
    },
  });
}

function buildDraftFromSnapshot(snapshot: SiteSnapshot) {
  return {
    projectName: `${snapshot.brief.product} · ${snapshot.brief.market}`,
    assistantReply: snapshot.assistantReply,
    pages: snapshot.pages,
    locales: snapshot.locales,
    previewChecks: snapshot.previewChecks,
    citations: snapshot.citations,
  } satisfies ModelDraft;
}

function buildDraftFromDetail(detail: Awaited<ReturnType<typeof getSiteProjectDetail>>) {
  const brief = siteBriefSchema.parse({
    market: detail.project.market ?? "Unknown Market",
    product: detail.project.product ?? detail.project.name,
    locales: detail.locales.map((item) => item.locale),
    style: detail.project.style ?? "conversion focused",
    cta: detail.project.cta ?? "Request a quote",
  });
  const snapshot = getSnapshotFromUnknown(
    detail.version
      ? {
          brief,
          assistantReply: detail.version.assistantReply,
          pages: detail.pages.map((page) => ({
            pageType: page.pageType,
            slug: page.slug,
            title: page.title,
            isHomepage: page.isHomepage,
            sections: Array.isArray((page.content as { sections?: Array<{ id?: string }> })?.sections)
              ? ((page.content as { sections: Array<{ id: string }> }).sections.map((section) => section.id))
              : [],
          })),
          locales: detail.locales.map((locale) => locale.translatedContent),
          previewChecks: detail.version.previewChecks,
          citations: detail.version.citations,
          badges: detail.version.badges,
          hreflangs: detail.version.hreflangs,
          robots: detail.version.robots,
          ogMeta: detail.version.ogMeta,
          autofillCandidates: detail.version.autofillCandidates,
          conversation: detail.version.conversation,
        }
      : null,
    brief,
  );

  return {
    brief,
    snapshot,
    draft: buildDraftFromSnapshot(snapshot),
  };
}

function toDetailResponse(params: {
  siteProject: {
    id: string;
    name: string;
    slug: string;
    market: string | null;
    product: string | null;
    style: string | null;
    cta: string | null;
    defaultLocale: LocaleCode;
    status: SiteStatus;
    createdAt: Date;
    updatedAt: Date;
    publishedAt: Date | null;
  };
  pages: Array<{
    id: string;
    pageType: string;
    title: string;
    slug: string;
    isHomepage: boolean;
    content: unknown;
  }>;
  locales: Array<{
    id: string;
    locale: LocaleCode;
    direction: LocaleDirection;
    urlPath: string;
    translatedContent: unknown;
    seoTitle: string | null;
    seoDescription: string | null;
    geoMetadata: unknown;
    publishStatus: PublishStatus;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  currentVersion: {
    id: string;
    versionNumber: number;
    note: string | null;
    snapshot: unknown;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  versions: Array<{
    id: string;
    versionNumber: number;
    note: string | null;
    createdAt: Date;
  }>;
}) {
  const fallbackBrief = siteBriefSchema.parse({
    market: params.siteProject.market ?? "Unknown Market",
    product: params.siteProject.product ?? params.siteProject.name,
    locales:
      params.locales.map((item) => toApiLocale(item.locale)) || ["en"],
    style: params.siteProject.style ?? "conversion focused",
    cta: params.siteProject.cta ?? "Request a quote",
  });
  const snapshot = getSnapshotFromUnknown(
    params.currentVersion?.snapshot,
    fallbackBrief,
  );

  return {
    project: {
      id: params.siteProject.id,
      name: params.siteProject.name,
      slug: params.siteProject.slug,
      market: params.siteProject.market,
      product: params.siteProject.product,
      style: params.siteProject.style,
      cta: params.siteProject.cta,
      defaultLocale: toApiLocale(params.siteProject.defaultLocale),
      status: toApiSiteStatus(params.siteProject.status),
      createdAt: params.siteProject.createdAt.toISOString(),
      updatedAt: params.siteProject.updatedAt.toISOString(),
      publishedAt: params.siteProject.publishedAt?.toISOString() ?? null,
    },
    pages: params.pages.map((page) => ({
      id: page.id,
      pageType: page.pageType,
      title: page.title,
      slug: page.slug,
      isHomepage: page.isHomepage,
      content: page.content,
    })),
    locales: params.locales.map((locale) => ({
      id: locale.id,
      locale: toApiLocale(locale.locale),
      hreflang: toApiLocale(locale.locale),
      direction: locale.direction.toLowerCase(),
      urlPath: locale.urlPath,
      translatedContent: locale.translatedContent,
      seoTitle: locale.seoTitle,
      seoDescription: locale.seoDescription,
      geoMetadata: locale.geoMetadata,
      publishStatus: toApiPublishStatus(locale.publishStatus),
      publishedAt: locale.publishedAt?.toISOString() ?? null,
      createdAt: locale.createdAt.toISOString(),
      updatedAt: locale.updatedAt.toISOString(),
    })),
    version: params.currentVersion
      ? {
          id: params.currentVersion.id,
          versionNumber: params.currentVersion.versionNumber,
          note: params.currentVersion.note,
          assistantReply: snapshot.assistantReply,
          previewChecks: snapshot.previewChecks,
          badges: snapshot.badges,
          citations: snapshot.citations,
          hreflangs: snapshot.hreflangs,
          robots: snapshot.robots,
          ogMeta: snapshot.ogMeta,
          autofillCandidates: snapshot.autofillCandidates,
          conversation: snapshot.conversation,
          createdAt: params.currentVersion.createdAt.toISOString(),
          updatedAt: params.currentVersion.updatedAt.toISOString(),
        }
      : null,
    versionHistory: params.versions.map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      note: version.note,
      createdAt: version.createdAt.toISOString(),
    })),
  };
}

export async function getSiteProjectDetail(
  tenantContext: TenantContext,
  siteId: string,
) {
  const tenantPrisma = getTenantPrisma(tenantContext);
  const siteProject = await tenantPrisma.siteProject.findUnique({
    where: {
      id: siteId,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      market: true,
      product: true,
      style: true,
      cta: true,
      defaultLocale: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      publishedAt: true,
      currentVersion: {
        select: {
          id: true,
          versionNumber: true,
          note: true,
          snapshot: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      versions: {
        orderBy: {
          versionNumber: "desc",
        },
        select: {
          id: true,
          versionNumber: true,
          note: true,
          createdAt: true,
        },
      },
      pages: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          id: true,
          pageType: true,
          title: true,
          slug: true,
          isHomepage: true,
          content: true,
        },
      },
      locales: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          id: true,
          locale: true,
          direction: true,
          urlPath: true,
          translatedContent: true,
          seoTitle: true,
          seoDescription: true,
          geoMetadata: true,
          publishStatus: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!siteProject) {
    throw new ApiError(404, "NOT_FOUND", "Site project not found.");
  }

  return toDetailResponse({
    siteProject,
    pages: siteProject.pages,
    locales: siteProject.locales,
    currentVersion: siteProject.currentVersion,
    versions: siteProject.versions,
  });
}

export async function listSiteProjects(tenantContext: TenantContext) {
  const tenantPrisma = getTenantPrisma(tenantContext);
  const projects = await tenantPrisma.siteProject.findMany({
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      name: true,
      slug: true,
      market: true,
      product: true,
      defaultLocale: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      publishedAt: true,
      currentVersion: {
        select: {
          id: true,
          versionNumber: true,
          snapshot: true,
          note: true,
        },
      },
      locales: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          id: true,
          locale: true,
          direction: true,
          urlPath: true,
          publishStatus: true,
        },
      },
    },
  });

  return {
    items: projects.map((project) => {
      const briefLocales =
        project.locales.length > 0
          ? project.locales.map((item) => toApiLocale(item.locale))
          : [toApiLocale(project.defaultLocale)];
      const brief = siteBriefSchema.parse({
        market: project.market ?? "Unknown Market",
        product: project.product ?? project.name,
        locales: briefLocales,
        style: "conversion focused",
        cta: "Request a quote",
      });
      const snapshot = getSnapshotFromUnknown(project.currentVersion?.snapshot, brief);
      const publicLocale =
        project.locales.find((item) => item.locale === project.defaultLocale) ??
        project.locales[0] ??
        null;

      return {
        id: project.id,
        name: project.name,
        slug: project.slug,
        market: project.market,
        product: project.product,
        defaultLocale: toApiLocale(project.defaultLocale),
        status: toApiSiteStatus(project.status),
        versionNumber: project.currentVersion?.versionNumber ?? 0,
        localeCount: project.locales.length,
        locales: project.locales.map((item) => ({
          id: item.id,
          locale: toApiLocale(item.locale),
          direction: item.direction.toLowerCase(),
          urlPath: item.urlPath,
          publishStatus: toApiPublishStatus(item.publishStatus),
        })),
        publicUrl:
          project.status === SiteStatus.PUBLISHED && publicLocale
            ? publicLocale.urlPath
            : null,
        previewUrl: `/sites/${project.id}/chat`,
        badges: snapshot.badges,
        pendingAutofillCount: snapshot.autofillCandidates.filter(
          (item) => item.status !== "applied",
        ).length,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        publishedAt: project.publishedAt?.toISOString() ?? null,
      };
    }),
  };
}

async function getSiteVersionRecord(params: {
  tenantContext: TenantContext;
  siteId: string;
  versionId: string;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const version = await tenantPrisma.siteVersion.findFirst({
    where: {
      id: params.versionId,
      siteProjectId: params.siteId,
    },
    select: {
      id: true,
      versionNumber: true,
      snapshot: true,
      note: true,
    },
  });

  if (!version) {
    throw new ApiError(404, "NOT_FOUND", "Requested site version not found.");
  }

  return version;
}

export async function rollbackSiteProject(params: {
  tenantContext: TenantContext;
  siteId: string;
  versionId: string;
  requestedByUserId?: string;
}) {
  const detail = await getSiteProjectDetail(params.tenantContext, params.siteId);
  const version = await getSiteVersionRecord({
    tenantContext: params.tenantContext,
    siteId: params.siteId,
    versionId: params.versionId,
  });
  const { brief } = buildDraftFromDetail(detail);
  const snapshot = getSnapshotFromUnknown(version.snapshot, brief);
  const draft = buildDraftFromSnapshot(snapshot);

  const rollbackVersion = await persistSiteDraft({
    tenantContext: params.tenantContext,
    siteProjectId: params.siteId,
    createdByUserId: params.requestedByUserId,
    brief,
    draft,
    snapshot,
    note: `Rollback from v${version.versionNumber}`,
    auditAction: "site_draft_updated",
  });

  if (detail.project.publishedAt) {
    await publishSiteVersion({
      tenantContext: params.tenantContext,
      siteId: params.siteId,
      versionId: rollbackVersion.id,
      approvedByUserId: params.requestedByUserId,
    });
  }

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.requestedByUserId,
    action: "site_version_rolled_back",
    entityType: "site_project",
    entityId: params.siteId,
    metadata: {
      rolledBackFromVersionId: version.id,
      rolledBackFromVersionNumber: version.versionNumber,
    },
  });

  return getSiteProjectDetail(params.tenantContext, params.siteId);
}

export async function requestSitePublish(params: {
  tenantContext: TenantContext;
  siteId: string;
  requestedByUserId?: string;
  mode?: "site_publish" | "autofill_candidate";
  candidateId?: string;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const detail = await getSiteProjectDetail(params.tenantContext, params.siteId);

  if (!detail.version) {
    throw new ApiError(409, "CONFLICT", "Site has no version to publish.");
  }

  const existing = await tenantPrisma.hitlTask.findFirst({
    where: {
      type: HitlTaskType.SITE_PUBLISH,
      status: HitlStatus.PENDING,
      entityType:
        params.mode === "autofill_candidate"
          ? "site_autofill_candidate"
          : "site_project",
      entityId: params.mode === "autofill_candidate"
        ? `${params.siteId}:${params.candidateId ?? ""}`
        : params.siteId,
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return {
      hitlTaskId: existing.id,
      reused: true,
    };
  }

  const hitlTask = await createHitlTask({
    tenantId: params.tenantContext.tenantId,
    requestedByUserId: params.requestedByUserId,
    type: HitlTaskType.SITE_PUBLISH,
    status: HitlStatus.PENDING,
    entityType:
      params.mode === "autofill_candidate"
        ? "site_autofill_candidate"
        : "site_project",
    entityId:
      params.mode === "autofill_candidate"
        ? `${params.siteId}:${params.candidateId ?? ""}`
        : params.siteId,
    payload: {
      siteId: params.siteId,
      versionId: detail.version.id,
      mode: params.mode ?? "site_publish",
      candidateId: params.candidateId ?? null,
    },
  });

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.requestedByUserId,
    action:
      params.mode === "autofill_candidate"
        ? "site_autofill_publish_requested"
        : "site_publish_requested",
    entityType:
      params.mode === "autofill_candidate"
        ? "site_autofill_candidate"
        : "site_project",
    entityId:
      params.mode === "autofill_candidate"
        ? `${params.siteId}:${params.candidateId ?? ""}`
        : params.siteId,
    metadata: {
      siteId: params.siteId,
      versionId: detail.version.id,
      candidateId: params.candidateId ?? null,
    },
  });

  return {
    hitlTaskId: hitlTask.id,
    reused: false,
  };
}

export async function setSiteProjectOffline(params: {
  tenantContext: TenantContext;
  siteId: string;
  requestedByUserId?: string;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const now = new Date();

  await tenantPrisma.siteProject.update({
    where: {
      id: params.siteId,
    },
    data: {
      status: SiteStatus.OFFLINE,
      publishedAt: null,
    },
  });
  await tenantPrisma.siteLocale.updateMany({
    where: {
      siteProjectId: params.siteId,
    },
    data: {
      publishStatus: PublishStatus.OFFLINE,
      publishedAt: null,
    },
  });
  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.requestedByUserId,
    action: "site_offlined",
    entityType: "site_project",
    entityId: params.siteId,
    metadata: {
      offlinedAt: now.toISOString(),
    },
  });

  return getSiteProjectDetail(params.tenantContext, params.siteId);
}

function sanitizeAutofillCandidates(
  candidates: AutofillCandidate[],
  allowedCitations: Set<string>,
) {
  return candidates.map((candidate) => ({
    ...candidate,
    sourceCitations: sanitizeCitations(candidate.sourceCitations, allowedCitations),
  }));
}

function buildAutofillPrompt(params: {
  detail: Awaited<ReturnType<typeof getSiteProjectDetail>>;
  brief: SiteBriefInput;
}) {
  return sanitizePublicPromptText(
    [
      "Generate JSON only for site autofill candidates.",
      `Market: ${params.brief.market}`,
      `Product: ${params.brief.product}`,
      `Source locale: ${getSourceLocale(params.brief)}`,
      `Current site name: ${params.detail.project.name}`,
      "Create 3 candidates covering one product, one certification, and one blog idea.",
      "Each candidate needs kind, title, summary, body, sourceCitations.",
      "Keep sourceCitations only as exact sourceCitation strings from the knowledge context.",
      "Return JSON: {\"assistantReply\":\"...\",\"candidates\":[...]}",
    ].join("\n"),
  );
}

const autofillResponseSchema = z.object({
  assistantReply: z.string().trim().min(1).max(500).default("已生成知识库自动补全候选。"),
  candidates: z
    .array(
      z.object({
        kind: z.enum(["product", "certification", "blog"]),
        title: z.string().trim().min(1).max(160),
        summary: z.string().trim().min(1).max(320),
        body: z.string().trim().min(1).max(1600),
        sourceCitations: z.array(z.string().trim().min(1).max(240)).max(6).default([]),
      }),
    )
    .min(1)
    .max(6),
});

async function generateAutofillCandidatesWithModel(params: {
  detail: Awaited<ReturnType<typeof getSiteProjectDetail>>;
  brief: SiteBriefInput;
  knowledgeItems: SearchItem[];
  fetchImpl?: typeof fetch;
}) {
  const modelResult = await generateDraftWithModel({
    knowledgeItems: params.knowledgeItems,
    prompt: buildAutofillPrompt({
      detail: params.detail,
      brief: params.brief,
    }),
    fetchImpl: params.fetchImpl,
  });

  try {
    return autofillResponseSchema.parse(JSON.parse(extractJsonPayload(modelResult.text)));
  } catch {
    const allowedCitations = buildAllowedCitationSet(params.knowledgeItems);
    return {
      assistantReply: "已生成知识库自动补全候选。",
      candidates: [
        {
          kind: "product" as const,
          title: `${params.brief.product} product block`,
          summary: "Add a compact product section grounded in public facts.",
          body: params.knowledgeItems[0]?.text.slice(0, 600) ??
            `Introduce ${params.brief.product} with public export-facing messaging.`,
          sourceCitations: sanitizeCitations(
            params.knowledgeItems.slice(0, 2).map((item) => item.sourceCitation ?? ""),
            allowedCitations,
          ),
        },
        {
          kind: "certification" as const,
          title: `${params.brief.product} certification proof`,
          summary: "Add a trust section for certifications or compliance evidence.",
          body: params.knowledgeItems[1]?.text.slice(0, 600) ??
            "Summarize public certification evidence without adding private claims.",
          sourceCitations: sanitizeCitations(
            params.knowledgeItems.slice(1, 3).map((item) => item.sourceCitation ?? ""),
            allowedCitations,
          ),
        },
        {
          kind: "blog" as const,
          title: `${params.brief.product} export guide`,
          summary: "Draft a blog page idea that can support SEO and GEO freshness.",
          body: params.knowledgeItems[2]?.text.slice(0, 600) ??
            `Create a public educational article for ${params.brief.market} buyers.`,
          sourceCitations: sanitizeCitations(
            params.knowledgeItems.slice(0, 3).map((item) => item.sourceCitation ?? ""),
            allowedCitations,
          ),
        },
      ],
    };
  }
}

export async function generateSiteAutofillCandidates(params: {
  tenantContext: TenantContext;
  siteId: string;
  requestedByUserId?: string;
  fetchImpl?: typeof fetch;
}) {
  const detail = await getSiteProjectDetail(params.tenantContext, params.siteId);
  const { brief, snapshot } = buildDraftFromDetail(detail);
  const knowledgeItems = await searchPublicKnowledge({
    tenantContext: params.tenantContext,
    brief,
    extraPrompt: "product certification blog autofill candidate",
  });
  const result = await generateAutofillCandidatesWithModel({
    detail,
    brief,
    knowledgeItems,
    fetchImpl: params.fetchImpl,
  });
  const allowedCitations = buildAllowedCitationSet(knowledgeItems);
  const now = new Date().toISOString();
  const candidates = sanitizeAutofillCandidates(
    result.candidates.map((candidate, index) => ({
      id: `${Date.now()}-${index + 1}`,
      kind: candidate.kind,
      title: candidate.title,
      summary: candidate.summary,
      body: candidate.body,
      sourceCitations: candidate.sourceCitations,
      status: "draft",
      updatedAt: now,
    })),
    allowedCitations,
  );
  const tenantPrisma = getTenantPrisma(params.tenantContext);

  if (!detail.version) {
    throw new ApiError(409, "CONFLICT", "Site has no current version.");
  }

  await tenantPrisma.siteVersion.update({
    where: {
      id: detail.version.id,
    },
    data: {
      snapshot: {
        ...snapshot,
        assistantReply: result.assistantReply,
        autofillCandidates: candidates,
      },
    },
  });

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.requestedByUserId,
    action: "site_autofill_generated",
    entityType: "site_project",
    entityId: params.siteId,
    metadata: {
      candidateCount: candidates.length,
    },
  });

  return getSiteProjectDetail(params.tenantContext, params.siteId);
}

export async function updateAutofillCandidate(params: {
  tenantContext: TenantContext;
  siteId: string;
  candidateId: string;
  requestedByUserId?: string;
  title?: string;
  summary?: string;
  body?: string;
}) {
  const detail = await getSiteProjectDetail(params.tenantContext, params.siteId);
  const { snapshot } = buildDraftFromDetail(detail);

  if (!detail.version) {
    throw new ApiError(409, "CONFLICT", "Site has no current version.");
  }

  const nextCandidates = snapshot.autofillCandidates.map((candidate: AutofillCandidate) =>
    candidate.id === params.candidateId
      ? {
          ...candidate,
          title: params.title?.trim() || candidate.title,
          summary: params.summary?.trim() || candidate.summary,
          body: params.body?.trim() || candidate.body,
          updatedAt: new Date().toISOString(),
        }
      : candidate,
  );

  if (!nextCandidates.some((candidate) => candidate.id === params.candidateId)) {
    throw new ApiError(404, "NOT_FOUND", "Autofill candidate not found.");
  }

  const tenantPrisma = getTenantPrisma(params.tenantContext);
  await tenantPrisma.siteVersion.update({
    where: {
      id: detail.version.id,
    },
    data: {
      snapshot: {
        ...snapshot,
        autofillCandidates: nextCandidates,
      },
    },
  });

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.requestedByUserId,
    action: "site_autofill_candidate_updated",
    entityType: "site_autofill_candidate",
    entityId: `${params.siteId}:${params.candidateId}`,
  });

  return getSiteProjectDetail(params.tenantContext, params.siteId);
}

function applyCandidateToSourceDraft(params: {
  draft: ModelDraft;
  candidate: AutofillCandidate;
}) {
  if (params.draft.locales.length === 0) {
    throw new ApiError(500, "INTERNAL", "Missing source locale while applying autofill candidate.");
  }

  const sectionId = buildCandidateSectionId(params.candidate.id);
  const nextLocales = params.draft.locales.map((localeDraft) => ({
    ...localeDraft,
    sections: localeDraft.sections.some((section) => section.id === sectionId)
      ? localeDraft.sections.map((section) =>
          section.id === sectionId
            ? {
                ...section,
                heading: params.candidate.title,
                body: params.candidate.body,
                bullets: [params.candidate.summary],
                sourceCitations: params.candidate.sourceCitations,
              }
            : section,
        )
      : [
          ...localeDraft.sections,
          {
            id: sectionId,
            heading: params.candidate.title,
            body: params.candidate.body,
            bullets: [params.candidate.summary],
            sourceCitations: params.candidate.sourceCitations,
          },
        ],
  })) satisfies ModelLocaleDraft[];
  const pageSlug =
    params.candidate.kind === "blog"
      ? buildAutofillPageSlug(params.candidate.title)
      : "home";
  const nextPages =
    params.candidate.kind === "blog"
      ? params.draft.pages.some((page) => page.slug === pageSlug)
        ? params.draft.pages.map((page) =>
            page.slug === pageSlug
              ? {
                  ...page,
                  title: params.candidate.title,
                  sections: Array.from(new Set([...page.sections, sectionId])),
                }
              : page,
          )
        : [
            ...params.draft.pages,
            {
              pageType: "blog",
              slug: pageSlug,
              title: params.candidate.title,
              isHomepage: false,
              sections: [sectionId],
            },
          ]
      : params.draft.pages.map((page) =>
          page.isHomepage
            ? {
                ...page,
                sections: Array.from(new Set([...page.sections, sectionId])),
              }
            : page,
        );
  const nextCandidates = params.draft.citations.some(
    (item) => item.sourceCitation === params.candidate.sourceCitations[0],
  )
    ? params.draft.citations
    : [
        ...params.draft.citations,
        ...params.candidate.sourceCitations.slice(0, 2).map((citation) => ({
          sourceCitation: citation,
          excerpt: params.candidate.body.slice(0, 220),
        })),
      ];

  return {
    ...params.draft,
    locales: nextLocales,
    pages: nextPages,
    citations: nextCandidates,
  } satisfies ModelDraft;
}

async function publishSiteVersion(params: {
  tenantContext: TenantContext;
  siteId: string;
  versionId: string;
  approvedByUserId?: string;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const version = await tenantPrisma.siteVersion.findFirst({
    where: {
      id: params.versionId,
      siteProjectId: params.siteId,
    },
    select: {
      id: true,
    },
  });

  if (!version) {
    throw new ApiError(404, "NOT_FOUND", "Publish version not found.");
  }

  const now = new Date();
  await tenantPrisma.siteProject.update({
    where: {
      id: params.siteId,
    },
    data: {
      status: SiteStatus.PUBLISHED,
      publishedAt: now,
      currentVersionId: params.versionId,
    },
  });
  await tenantPrisma.siteLocale.updateMany({
    where: {
      siteProjectId: params.siteId,
    },
    data: {
      publishStatus: PublishStatus.PUBLISHED,
      publishedAt: now,
    },
  });
  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.approvedByUserId,
    action: "site_published",
    entityType: "site_project",
    entityId: params.siteId,
    metadata: {
      versionId: params.versionId,
    },
  });
}

export async function listHitlTasks(params: {
  tenantContext: TenantContext;
  status?: "pending" | "approved" | "rejected" | "expired" | "cancelled";
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const tasks = await tenantPrisma.hitlTask.findMany({
    where: {
      status: params.status
        ? (params.status.toUpperCase() as HitlStatus)
        : undefined,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      type: true,
      status: true,
      entityType: true,
      entityId: true,
      payload: true,
      reason: true,
      createdAt: true,
      updatedAt: true,
      resolvedAt: true,
    },
  });

  return {
    items: tasks.map((task) => ({
      id: task.id,
      type: task.type.toLowerCase(),
      status: task.status.toLowerCase(),
      entityType: task.entityType,
      entityId: task.entityId,
      payload: task.payload,
      reason: task.reason,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      resolvedAt: task.resolvedAt?.toISOString() ?? null,
    })),
  };
}

export async function approveHitlTask(params: {
  tenantContext: TenantContext;
  hitlTaskId: string;
  approvedByUserId?: string;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const task = await tenantPrisma.hitlTask.findUnique({
    where: {
      id: params.hitlTaskId,
    },
    select: {
      id: true,
      type: true,
      status: true,
      entityType: true,
      entityId: true,
      payload: true,
    },
  });

  if (!task) {
    throw new ApiError(404, "NOT_FOUND", "HITL task not found.");
  }

  if (task.status !== HitlStatus.PENDING) {
    throw new ApiError(409, "CONFLICT", "HITL task has already been resolved.");
  }

  if (task.type === HitlTaskType.REPLY_SEND) {
    const replyPayload = (task.payload ?? {}) as {
      replyId?: string;
    };

    if (!replyPayload.replyId) {
      throw new ApiError(409, "CONFLICT", "Unsupported HITL task payload.");
    }

    await approveReplySendTask({
      tenantContext: params.tenantContext,
      hitlTaskId: params.hitlTaskId,
      replyId: replyPayload.replyId,
      approvedByUserId: params.approvedByUserId,
    });

    await tenantPrisma.hitlTask.update({
      where: {
        id: params.hitlTaskId,
      },
      data: {
        status: HitlStatus.APPROVED,
        approvedByUserId: params.approvedByUserId,
        resolvedAt: new Date(),
      },
    });

    await createAuditLog({
      tenantId: params.tenantContext.tenantId,
      actorUserId: params.approvedByUserId,
      action: "hitl_task_approved",
      entityType: task.entityType,
      entityId: task.entityId,
      metadata: {
        hitlTaskId: task.id,
      },
    });

    return {
      hitlTaskId: params.hitlTaskId,
      status: "approved",
    };
  }

  if (task.type === HitlTaskType.CONTENT_PUBLISH) {
    const contentPayload = (task.payload ?? {}) as {
      itemId?: string;
    };

    if (!contentPayload.itemId) {
      throw new ApiError(409, "CONFLICT", "Unsupported HITL task payload.");
    }

    if (!hasMinimumRole(params.tenantContext.role, "OPERATOR")) {
      throw new ApiError(403, "FORBIDDEN", "This HITL task requires operator role or higher.");
    }

    await markContentItemPublished({
      tenantContext: params.tenantContext,
      itemId: contentPayload.itemId,
      requestedByUserId: params.approvedByUserId,
    });

    await tenantPrisma.hitlTask.update({
      where: {
        id: params.hitlTaskId,
      },
      data: {
        status: HitlStatus.APPROVED,
        approvedByUserId: params.approvedByUserId,
        resolvedAt: new Date(),
      },
    });

    await createAuditLog({
      tenantId: params.tenantContext.tenantId,
      actorUserId: params.approvedByUserId,
      action: "hitl_task_approved",
      entityType: task.entityType,
      entityId: task.entityId,
      metadata: {
        hitlTaskId: task.id,
      },
    });

    return {
      hitlTaskId: params.hitlTaskId,
      status: "approved",
    };
  }

  if (!hasMinimumRole(params.tenantContext.role, "ADMIN")) {
    throw new ApiError(403, "FORBIDDEN", "This HITL task requires admin role or higher.");
  }

  const payload = (task.payload ?? {}) as {
    siteId?: string;
    versionId?: string;
    mode?: "site_publish" | "autofill_candidate";
    candidateId?: string | null;
  };

  if (task.type !== HitlTaskType.SITE_PUBLISH || !payload.siteId || !payload.versionId) {
    throw new ApiError(409, "CONFLICT", "Unsupported HITL task payload.");
  }

  if (payload.mode === "autofill_candidate" && payload.candidateId) {
    const detail = await getSiteProjectDetail(params.tenantContext, payload.siteId);
    const { brief, snapshot, draft } = buildDraftFromDetail(detail);
    const candidate = snapshot.autofillCandidates.find(
      (item: AutofillCandidate) => item.id === payload.candidateId,
    );

    if (!candidate) {
      throw new ApiError(404, "NOT_FOUND", "Autofill candidate no longer exists.");
    }

    const sourceDraft = applyCandidateToSourceDraft({
      draft,
      candidate,
    });
    const nextSnapshot = {
      ...snapshot,
      autofillCandidates: snapshot.autofillCandidates.map((item: AutofillCandidate) =>
        item.id === candidate.id
          ? {
              ...item,
              status: "applied",
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    } satisfies SiteSnapshot;

    await persistSiteDraft({
      tenantContext: params.tenantContext,
      siteProjectId: payload.siteId,
      createdByUserId: params.approvedByUserId,
      brief,
      draft: sourceDraft,
      snapshot: nextSnapshot,
      note: `Autofill applied: ${candidate.title}`,
      auditAction: "site_draft_updated",
    });
    const updatedDetail = await getSiteProjectDetail(params.tenantContext, payload.siteId);

    if (!updatedDetail.version) {
      throw new ApiError(500, "INTERNAL", "Updated site version missing after autofill apply.");
    }

    await publishSiteVersion({
      tenantContext: params.tenantContext,
      siteId: payload.siteId,
      versionId: updatedDetail.version.id,
      approvedByUserId: params.approvedByUserId,
    });
  } else {
    await publishSiteVersion({
      tenantContext: params.tenantContext,
      siteId: payload.siteId,
      versionId: payload.versionId,
      approvedByUserId: params.approvedByUserId,
    });
  }

  await tenantPrisma.hitlTask.update({
    where: {
      id: params.hitlTaskId,
    },
    data: {
      status: HitlStatus.APPROVED,
      approvedByUserId: params.approvedByUserId,
      resolvedAt: new Date(),
    },
  });

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.approvedByUserId,
    action: "hitl_task_approved",
    entityType: task.entityType,
    entityId: task.entityId,
    metadata: {
      hitlTaskId: task.id,
    },
  });

  return {
    hitlTaskId: params.hitlTaskId,
    status: "approved",
  };
}

function buildSiteJsonLd(params: {
  appUrl: string;
  project: {
    name: string;
    product: string | null;
    market: string | null;
  };
  locale: {
    locale: ApiLocale;
    urlPath: string;
    translatedContent: ModelLocaleDraft;
  };
}) {
  const pageUrl = `${params.appUrl.replace(/\/$/, "")}${params.locale.urlPath}`;
  const faqEntities = (params.locale.translatedContent.faq ?? []).map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.answer,
    },
  }));

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: params.locale.translatedContent.title,
        url: pageUrl,
        inLanguage: params.locale.locale,
        description: params.locale.translatedContent.seoDescription,
      },
      {
        "@type": "Service",
        name: params.project.product ?? params.project.name,
        areaServed: params.project.market ?? undefined,
        description: params.locale.translatedContent.subheadline,
        url: pageUrl,
      },
      ...(faqEntities.length > 0
        ? [
            {
              "@type": "FAQPage",
              mainEntity: faqEntities,
            },
          ]
        : []),
    ],
  };
}

export async function getPublicSiteLocalePageData(params: {
  slug: string;
  locale: ApiLocale;
  allowDraft?: boolean;
}) {
  const prisma = getPrismaClient();
  const siteProject = await prisma.siteProject.findFirst({
    where: {
      slug: params.slug,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      market: true,
      product: true,
      style: true,
      cta: true,
      defaultLocale: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      publishedAt: true,
      tenant: {
        select: {
          slug: true,
        },
      },
      currentVersion: {
        select: {
          id: true,
          versionNumber: true,
          note: true,
          snapshot: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      versions: {
        orderBy: {
          versionNumber: "desc",
        },
        select: {
          id: true,
          versionNumber: true,
          note: true,
          createdAt: true,
        },
      },
      pages: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          id: true,
          pageType: true,
          title: true,
          slug: true,
          isHomepage: true,
          content: true,
        },
      },
      locales: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          id: true,
          locale: true,
          direction: true,
          urlPath: true,
          translatedContent: true,
          seoTitle: true,
          seoDescription: true,
          geoMetadata: true,
          publishStatus: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!siteProject) {
    throw new ApiError(404, "NOT_FOUND", "Public site not found.");
  }

  if (!params.allowDraft && siteProject.status !== SiteStatus.PUBLISHED) {
    throw new ApiError(404, "NOT_FOUND", "Public site not found.");
  }

  const detail = toDetailResponse({
    siteProject,
    pages: siteProject.pages,
    locales: siteProject.locales,
    currentVersion: siteProject.currentVersion,
    versions: siteProject.versions,
  });
  const localeDetail =
    detail.locales.find((item) => item.locale === params.locale) ??
    detail.locales.find((item) => item.locale === detail.project.defaultLocale) ??
    null;

  if (!localeDetail) {
    throw new ApiError(404, "NOT_FOUND", "Requested site locale not found.");
  }

  const translatedContent = localeDetail.translatedContent as ModelLocaleDraft;
  const appUrl = getEnv().APP_URL;

  return {
    project: detail.project,
    tenantSlug: siteProject.tenant.slug,
    pages: detail.pages,
    locale: {
      ...localeDetail,
      translatedContent,
      quickAnswer: deriveQuickAnswer(translatedContent),
    },
    version: detail.version,
    jsonLd: buildSiteJsonLd({
      appUrl,
      project: detail.project,
      locale: {
        locale: localeDetail.locale,
        urlPath: localeDetail.urlPath,
        translatedContent,
      },
    }),
    absoluteUrl: `${appUrl.replace(/\/$/, "")}${localeDetail.urlPath}`,
    alternates: Object.fromEntries(
      (detail.version?.hreflangs ?? []).map((item) => [
        item.locale,
        `${appUrl.replace(/\/$/, "")}${item.href}`,
      ]),
    ) as Record<string, string>,
  };
}

export async function applySiteChatUpdate(params: {
  tenantContext: TenantContext;
  siteId: string;
  message: string;
  requestedByUserId?: string;
  fetchImpl?: typeof fetch;
}) {
  const normalizedMessage = params.message.trim();

  if (!normalizedMessage) {
    throw new ApiError(400, "VALIDATION", "message must not be empty.");
  }

  const detail = await getSiteProjectDetail(params.tenantContext, params.siteId);
  const brief = siteBriefSchema.parse({
    market: detail.project.market ?? "Unknown Market",
    product: detail.project.product ?? detail.project.name,
    locales: detail.locales.map((item) => item.locale) as ApiLocale[],
    style: detail.project.style ?? "conversion focused",
    cta: detail.project.cta ?? "Request a quote",
  });
  const snapshot = getSnapshotFromUnknown(
    {
      brief,
      assistantReply: detail.version?.assistantReply ?? "Draft ready.",
      pages: detail.pages.map((page) => ({
        pageType: page.pageType,
        slug: page.slug,
        title: page.title,
        isHomepage: page.isHomepage,
        sections:
          Array.isArray((page.content as { sections?: Array<{ id?: string }> })?.sections)
            ? ((page.content as { sections: Array<{ id: string }> }).sections.map((section) => section.id))
            : ["hero", "proof"],
      })),
      locales: detail.locales.map((locale) => locale.translatedContent),
      previewChecks: detail.version?.previewChecks ?? buildDefaultPreviewChecks(),
      citations: detail.version?.citations ?? [],
      badges: detail.version?.badges ?? {
        seo: true,
        geo: true,
        responsive: true,
        ogVk: true,
        trackingLinks: true,
      },
      hreflangs: detail.version?.hreflangs ?? [],
      robots: detail.version?.robots ?? buildRobotsRules(),
      ogMeta:
        detail.version?.ogMeta ??
        buildOgMeta({
          brief,
          locales: detail.locales.map(
            (locale) => locale.translatedContent as ModelLocaleDraft,
          ),
        }),
      autofillCandidates: detail.version?.autofillCandidates ?? [],
      conversation: detail.version?.conversation ?? [],
    },
    brief,
  );
  const knowledgeItems = await searchPublicKnowledge({
    tenantContext: params.tenantContext,
    brief,
    extraPrompt: normalizedMessage,
  });
  const modelResult = await generateDraftWithModel({
    knowledgeItems,
    prompt: buildChatPrompt({
      brief,
      message: normalizedMessage,
      snapshot,
    }),
    fetchImpl: params.fetchImpl,
  });
  const sourceDraft = parseModelDraft({
    text: modelResult.text,
    brief,
    requestedLocales: [getSourceLocale(brief)],
    knowledgeItems,
    assistantReplyFallback: "已根据你的要求更新站点草稿。",
  });
  const draft = await localizeDraft({
    brief,
    sourceDraft,
    fetchImpl: params.fetchImpl,
  });
  const now = new Date().toISOString();
  const nextSnapshot = buildSnapshot({
    brief,
    draft,
    previousConversation: snapshot.conversation,
    autofillCandidates: snapshot.autofillCandidates,
    newMessages: [
      {
        role: "user",
        content: normalizedMessage,
        createdAt: now,
      },
      {
        role: "assistant",
        content: draft.assistantReply,
        createdAt: now,
      },
    ],
  });

  await persistSiteDraft({
    tenantContext: params.tenantContext,
    siteProjectId: params.siteId,
    createdByUserId: params.requestedByUserId,
    brief,
    draft,
    snapshot: nextSnapshot,
    note: `Chat update: ${normalizedMessage.slice(0, 120)}`,
    auditAction: "site_draft_updated",
  });

  return getSiteProjectDetail(params.tenantContext, params.siteId);
}

export async function getSiteProjectRecordForTests(params: {
  tenantContext: TenantContext;
  siteId: string;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);

  return tenantPrisma.siteProject.findUnique({
    where: {
      id: params.siteId,
    },
    select: {
      id: true,
      currentVersionId: true,
      status: true,
      updatedAt: true,
    },
  });
}
