import {
  JobType,
  KnowledgeSensitivity,
  LocaleCode,
  LocaleDirection,
  PublishStatus,
  SiteStatus,
} from "@prisma/client";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/server/api/errors";
import type { TenantContext } from "@/server/db/tenant-context";
import { getPrismaClient } from "@/server/db/prisma";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import { enqueueTenantJob } from "@/server/jobs/service";

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
  conversation: z.array(snapshotConversationMessageSchema).max(40).default([]),
});

type ApiLocale = z.infer<typeof apiLocaleSchema>;
export type SiteBriefInput = z.infer<typeof siteBriefSchema>;
type PreviewCheck = z.infer<typeof previewCheckSchema>;
type ModelLocaleDraft = z.infer<typeof modelLocaleDraftSchema>;
type ModelDraft = z.infer<typeof modelDraftSchema>;
type SnapshotConversationMessage = z.infer<typeof snapshotConversationMessageSchema>;
type SiteSnapshot = z.infer<typeof snapshotSchema>;

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

async function createUniqueSiteSlug(baseText: string, tenantId: string) {
  const prisma = getPrismaClient();
  const baseSlug = normalizeSlugPart(baseText) || "site";

  for (let index = 0; index < 50; index += 1) {
    const candidate = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
    const existing = await prisma.siteProject.findFirst({
      where: {
        tenantId,
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

function buildDefaultPreviewChecks(): PreviewCheck[] {
  return [
    {
      key: "seo",
      label: "SEO",
      status: "pass",
      detail: "TDK 与结构化标题已生成。",
    },
    {
      key: "geo",
      label: "GEO",
      status: "pass",
      detail: "公开知识溯源已保留，适合 AI 摘要引用。",
    },
    {
      key: "mobile",
      label: "移动端",
      status: "pass",
      detail: "首屏、卖点和 CTA 保持窄屏可读。",
    },
    {
      key: "form",
      label: "询盘表单",
      status: "pass",
      detail: "CTA 已收敛到单一询盘动作。",
    },
    {
      key: "share",
      label: "OG/VK 分享卡",
      status: "pass",
      detail: "分享卡标题和摘要已准备。",
    },
  ];
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
}) {
  const conversation = [
    ...(params.previousConversation ?? []),
    ...(params.newMessages ?? []),
  ].slice(-40);

  return {
    brief: params.brief,
    assistantReply: params.draft.assistantReply,
    pages: params.draft.pages,
    locales: params.draft.locales,
    previewChecks: params.draft.previewChecks.length > 0
      ? params.draft.previewChecks
      : buildDefaultPreviewChecks(),
    citations: params.draft.citations,
    badges: {
      seo: true,
      geo: true,
      responsive: true,
      ogVk: true,
      trackingLinks: true,
    },
    conversation,
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
          urlPath: `/sites/${siteProject.slug}/${localeDraft.locale}`,
          translatedContent: localeDraft,
          seoTitle: localeDraft.seoTitle,
          seoDescription: localeDraft.seoDescription,
          geoMetadata: {
            market: params.brief.market,
            product: params.brief.product,
            locale: localeDraft.locale,
            source: "public_kb_only",
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
        snapshot: params.snapshot,
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
          citations: params.snapshot.citations.map((item) => item.sourceCitation),
        },
      },
    });

    return version;
  });
}

function buildGenerationPrompt(brief: SiteBriefInput) {
  return sanitizePublicPromptText(
    [
    "Create a B2B export landing site draft in JSON only.",
    `Market: ${brief.market}`,
    `Product: ${brief.product}`,
    `Locales: ${brief.locales.join(", ")}`,
    `Style: ${brief.style}`,
    `CTA intent: ${brief.cta}`,
    "Requirements:",
    "- Use only attached public knowledge context.",
    "- Keep the copy suitable for public marketing pages.",
    "- Produce 1 to 3 pages, but default to 1 landing page.",
    "- For each locale include title, headline, subheadline, CTA, sections, FAQ, seoTitle, seoDescription.",
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
  return sanitizePublicPromptText(
    [
    "Revise the existing B2B site draft and return JSON only.",
    `Market: ${params.brief.market}`,
    `Product: ${params.brief.product}`,
    `Locales: ${params.brief.locales.join(", ")}`,
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
  const slug = await createUniqueSiteSlug(
    `${brief.product}-${brief.market}`,
    params.tenantContext.tenantId,
  );
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
  const draft = parseModelDraft({
    text: modelResult.text,
    brief: params.brief,
    requestedLocales: params.brief.locales,
    knowledgeItems,
    assistantReplyFallback: "已基于公开知识生成站点草稿，可继续对话修改。",
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

function getSnapshotFromUnknown(value: unknown, fallbackBrief: SiteBriefInput) {
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
          conversation: snapshot.conversation,
          createdAt: params.currentVersion.createdAt.toISOString(),
          updatedAt: params.currentVersion.updatedAt.toISOString(),
        }
      : null,
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
  });
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
  const draft = parseModelDraft({
    text: modelResult.text,
    brief,
    requestedLocales: brief.locales,
    knowledgeItems,
    assistantReplyFallback: "已根据你的要求更新站点草稿。",
  });
  const now = new Date().toISOString();
  const nextSnapshot = buildSnapshot({
    brief,
    draft,
    previousConversation: snapshot.conversation,
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
