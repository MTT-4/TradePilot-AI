import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  ContentPackStatus,
  FileKind,
  FileSourceType,
  JobType,
  KnowledgeSensitivity,
  LocaleCode,
  MediaType,
  ModelTaskType,
  Platform,
  Prisma,
  PublishStatus,
} from "@prisma/client";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/server/api/errors";
import type { TenantContext } from "@/server/db/tenant-context";
import { getPrismaClient } from "@/server/db/prisma";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import { enqueueTenantJob } from "@/server/jobs/service";
import { hybridSearchKnowledgeChunks } from "@/server/kb/service";
import { createModelGateway } from "@/server/model-gateway";
import { putTenantObject } from "@/server/storage/object-store";
import { createTrackingLink } from "@/server/tracking/service";

const execFile = promisify(execFileCallback);

const apiLocaleSchema = z.enum(["en", "ar", "ru", "fr", "de", "pt"]);
const apiPlatformSchema = z.enum([
  "linkedin",
  "facebook",
  "instagram",
  "reels",
  "tiktok",
  "youtube",
  "shorts",
  "vk_clips",
  "rutube",
]);
const exportFormatSchema = z.enum(["csv", "md", "zip"]);

const contentPackGenerateSchema = z.object({
  campaignId: z.string().min(1).optional(),
  topic: z.string().trim().min(1).max(160),
  market: z.string().trim().min(1).max(120).optional(),
  locales: z.array(apiLocaleSchema).min(1).max(6),
  platforms: z.array(apiPlatformSchema).min(1).max(9).optional(),
});

const contentPackChatMessageSchema = z.object({
  message: z.string().trim().min(1).max(1200),
});

const contentItemPatchSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  body: z.string().trim().min(1).max(4000).optional(),
  plannedAt: z.string().datetime().nullable().optional(),
  ownerUserId: z.string().min(1).nullable().optional(),
});

const contentItemImageGenerationSchema = z.object({
  mode: z
    .enum(["text_to_image", "image_to_image", "background_swap"])
    .default("text_to_image"),
  backgroundStyle: z.string().trim().min(1).max(120).optional(),
  referenceLabel: z.string().trim().min(1).max(120).optional(),
});

const modelPackItemSchema = z.object({
  platform: z.nativeEnum(Platform),
  title: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(4000),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  coverHeadline: z.string().trim().min(1).max(140),
  visualDirection: z.string().trim().min(1).max(220),
  storyboard: z.array(z.string().trim().min(1).max(220)).max(8).default([]),
  script: z.array(z.string().trim().min(1).max(320)).max(8).default([]),
  imagePrompt: z.string().trim().min(1).max(1200).optional(),
  notes: z.array(z.string().trim().min(1).max(220)).max(8).default([]),
});

const modelPackResponseSchema = z.object({
  title: z.string().trim().min(1).max(180).default("AI generated content pack"),
  items: z.array(modelPackItemSchema).min(1).max(9),
});

type ApiLocale = z.infer<typeof apiLocaleSchema>;
type ApiPlatform = z.infer<typeof apiPlatformSchema>;
type ContentPackGenerateInput = z.infer<typeof contentPackGenerateSchema>;
type ContentPackChatInput = z.infer<typeof contentPackChatMessageSchema>;
type ContentItemPatchInput = z.infer<typeof contentItemPatchSchema>;
type ContentItemImageGenerationInput = z.infer<
  typeof contentItemImageGenerationSchema
>;
type ModelPackItem = z.infer<typeof modelPackItemSchema>;

type PlatformRuleDefaults = {
  mediaType: MediaType;
  ratio: string;
  dimensions: string;
  copyLimit: number;
  hashtagLimit: number;
  recommendedWindow: string;
  coverStyle: string;
  durationSeconds?: number;
  notes: string[];
};

type NormalizedPlatformRule = PlatformRuleDefaults & {
  platform: Platform;
  displayName: string;
  localeAware: boolean;
  rawRules: Record<string, unknown>;
};

const PLATFORM_ORDER: Platform[] = [
  Platform.LINKEDIN,
  Platform.FACEBOOK,
  Platform.INSTAGRAM,
  Platform.REELS,
  Platform.TIKTOK,
  Platform.YOUTUBE,
  Platform.SHORTS,
  Platform.VK_CLIPS,
  Platform.RUTUBE,
];

const VIDEO_PLATFORMS = new Set<Platform>([
  Platform.REELS,
  Platform.TIKTOK,
  Platform.YOUTUBE,
  Platform.SHORTS,
  Platform.VK_CLIPS,
  Platform.RUTUBE,
]);

const PLATFORM_LABELS: Record<Platform, string> = {
  [Platform.LINKEDIN]: "LinkedIn",
  [Platform.FACEBOOK]: "Facebook",
  [Platform.INSTAGRAM]: "Instagram",
  [Platform.REELS]: "Reels",
  [Platform.TIKTOK]: "TikTok",
  [Platform.YOUTUBE]: "YouTube",
  [Platform.SHORTS]: "Shorts",
  [Platform.VK_CLIPS]: "VK Clips",
  [Platform.RUTUBE]: "RuTube",
};

const PLATFORM_DEFAULTS: Record<Platform, PlatformRuleDefaults> = {
  [Platform.LINKEDIN]: {
    mediaType: MediaType.IMAGE,
    ratio: "1.91:1",
    dimensions: "1200x627",
    copyLimit: 320,
    hashtagLimit: 5,
    recommendedWindow: "Tue-Thu 09:00-11:00 local time",
    coverStyle: "clean export-trade hero image",
    notes: ["Open with commercial clarity.", "Use fewer hashtags and stronger proof."],
  },
  [Platform.FACEBOOK]: {
    mediaType: MediaType.IMAGE,
    ratio: "1:1",
    dimensions: "1080x1080",
    copyLimit: 260,
    hashtagLimit: 4,
    recommendedWindow: "Weekdays 12:00-14:00 local time",
    coverStyle: "approachable product + context scene",
    notes: ["Keep CTA direct.", "Avoid dense technical paragraphs."],
  },
  [Platform.INSTAGRAM]: {
    mediaType: MediaType.CAROUSEL,
    ratio: "4:5",
    dimensions: "1080x1350",
    copyLimit: 220,
    hashtagLimit: 8,
    recommendedWindow: "Weekdays 18:00-21:00 local time",
    coverStyle: "bold product detail with layered text block",
    notes: ["Carousel should tell a sequence.", "First slide must hook quickly."],
  },
  [Platform.REELS]: {
    mediaType: MediaType.VIDEO_SCRIPT,
    ratio: "9:16",
    dimensions: "1080x1920",
    copyLimit: 180,
    hashtagLimit: 6,
    recommendedWindow: "Daily 19:00-22:00 local time",
    coverStyle: "fast-moving proof-driven cover",
    durationSeconds: 30,
    notes: ["No rendered video in V1.0.", "Output script, storyboard, cover only."],
  },
  [Platform.TIKTOK]: {
    mediaType: MediaType.VIDEO_SCRIPT,
    ratio: "9:16",
    dimensions: "1080x1920",
    copyLimit: 180,
    hashtagLimit: 6,
    recommendedWindow: "Daily 18:00-22:00 local time",
    coverStyle: "high-contrast hook-led cover",
    durationSeconds: 28,
    notes: ["Use quick beats.", "Open with the buyer problem in the first seconds."],
  },
  [Platform.YOUTUBE]: {
    mediaType: MediaType.VIDEO_SCRIPT,
    ratio: "16:9",
    dimensions: "1280x720",
    copyLimit: 320,
    hashtagLimit: 5,
    recommendedWindow: "Wed-Sat 12:00-16:00 local time",
    coverStyle: "thumbnail with product promise + proof",
    durationSeconds: 45,
    notes: ["Keep title searchable.", "No final video render in V1.0."],
  },
  [Platform.SHORTS]: {
    mediaType: MediaType.VIDEO_SCRIPT,
    ratio: "9:16",
    dimensions: "1080x1920",
    copyLimit: 170,
    hashtagLimit: 5,
    recommendedWindow: "Daily 18:00-21:00 local time",
    coverStyle: "minimal cover with one strong promise",
    durationSeconds: 25,
    notes: ["Short hook, one proof, one CTA."],
  },
  [Platform.VK_CLIPS]: {
    mediaType: MediaType.VIDEO_SCRIPT,
    ratio: "9:16",
    dimensions: "1080x1920",
    copyLimit: 190,
    hashtagLimit: 6,
    recommendedWindow: "Weekdays 18:00-21:00 local time",
    coverStyle: "localized cover with short punchy headline",
    durationSeconds: 30,
    notes: ["Use localized hooks for RU audiences.", "No TTS or subtitle generation."],
  },
  [Platform.RUTUBE]: {
    mediaType: MediaType.VIDEO_SCRIPT,
    ratio: "16:9",
    dimensions: "1280x720",
    copyLimit: 300,
    hashtagLimit: 5,
    recommendedWindow: "Weekdays 13:00-18:00 local time",
    coverStyle: "technical thumbnail with product reliability angle",
    durationSeconds: 45,
    notes: ["Keep script more explanatory than Shorts."],
  },
};

function toPrismaLocale(locale: ApiLocale) {
  return locale.toUpperCase() as LocaleCode;
}

function toApiLocale(locale: LocaleCode) {
  return locale.toLowerCase() as ApiLocale;
}

function toPrismaPlatform(platform: ApiPlatform) {
  return platform.toUpperCase() as Platform;
}

function toApiPlatform(platform: Platform) {
  return platform.toLowerCase() as ApiPlatform;
}

function toApiMediaType(mediaType: MediaType) {
  return mediaType.toLowerCase();
}

function toApiPublishStatus(status: PublishStatus) {
  return status.toLowerCase();
}

function toApiContentPackStatus(status: ContentPackStatus) {
  return status.toLowerCase();
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

function clampText(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength - 1).trimEnd() + "…";
}

function extractJsonPayload(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  return candidate.trim();
}

function buildResolvedTrackingUrl(trackingLink: {
  targetUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string | null;
}) {
  const url = new URL(trackingLink.targetUrl);
  url.searchParams.set("utm_source", trackingLink.utmSource);
  url.searchParams.set("utm_medium", trackingLink.utmMedium);
  url.searchParams.set("utm_campaign", trackingLink.utmCampaign);

  if (trackingLink.utmContent) {
    url.searchParams.set("utm_content", trackingLink.utmContent);
  } else {
    url.searchParams.delete("utm_content");
  }

  return url.toString();
}

function parseDimensions(dimensions: string | undefined) {
  const matched = dimensions?.match(/(\d{2,5})\s*x\s*(\d{2,5})/i);

  if (!matched) {
    return {
      width: 1080,
      height: 1080,
    };
  }

  return {
    width: Number(matched[1]),
    height: Number(matched[2]),
  };
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildGeneratedImageSvg(params: {
  companyName: string;
  platformLabel: string;
  title: string;
  coverHeadline: string;
  prompt: string;
  visualDirection: string;
  backgroundStyle?: string;
  referenceLabel?: string;
  primaryColor: string;
  secondaryColor: string;
  width: number;
  height: number;
  variant: "primary" | "cover";
  mode: ContentItemImageGenerationInput["mode"];
}) {
  const headline =
    params.variant === "cover" ? params.coverHeadline : params.title;
  const secondaryLine =
    params.variant === "cover"
      ? params.title
      : `Prompt: ${clampText(params.prompt, 80)}`;
  const footer =
    params.mode === "background_swap"
      ? `Background swap · ${params.backgroundStyle ?? "brand scene"}`
      : params.mode === "image_to_image"
        ? `Image-to-image · ${params.referenceLabel ?? "reference guided"}`
        : `Text-to-image · ${params.visualDirection}`;
  const paddedWidth = Math.max(180, params.width - 120);
  const bodyY = Math.max(240, Math.round(params.height * 0.58));
  const footerY = Math.max(bodyY + 110, params.height - 90);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${params.width}" height="${params.height}" viewBox="0 0 ${params.width} ${params.height}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${params.primaryColor}"/>
      <stop offset="100%" stop-color="${params.secondaryColor}"/>
    </linearGradient>
  </defs>
  <rect width="${params.width}" height="${params.height}" rx="48" fill="url(#bg)"/>
  <circle cx="${Math.round(params.width * 0.84)}" cy="${Math.round(params.height * 0.18)}" r="${Math.round(Math.min(params.width, params.height) * 0.14)}" fill="rgba(255,255,255,0.12)"/>
  <circle cx="${Math.round(params.width * 0.2)}" cy="${Math.round(params.height * 0.82)}" r="${Math.round(Math.min(params.width, params.height) * 0.16)}" fill="rgba(255,255,255,0.08)"/>
  <rect x="60" y="54" rx="999" ry="999" width="${Math.min(360, params.width - 120)}" height="48" fill="rgba(255,255,255,0.18)"/>
  <text x="84" y="86" font-size="24" font-family="Helvetica, Arial, sans-serif" fill="#ffffff">${escapeSvgText(params.companyName)} · ${escapeSvgText(params.platformLabel)}</text>
  <text x="60" y="${Math.max(180, Math.round(params.height * 0.3))}" font-size="${params.variant === "cover" ? 58 : 52}" font-weight="700" font-family="Helvetica, Arial, sans-serif" fill="#ffffff">
    <tspan x="60" dy="0">${escapeSvgText(clampText(headline, 48))}</tspan>
  </text>
  <text x="60" y="${bodyY}" font-size="28" font-family="Helvetica, Arial, sans-serif" fill="rgba(255,255,255,0.94)">
    <tspan x="60" dy="0">${escapeSvgText(clampText(secondaryLine, 68))}</tspan>
    <tspan x="60" dy="42">${escapeSvgText(clampText(params.visualDirection, 72))}</tspan>
  </text>
  <rect x="60" y="${footerY - 44}" rx="24" ry="24" width="${paddedWidth}" height="64" fill="rgba(20,24,20,0.18)"/>
  <text x="86" y="${footerY}" font-size="22" font-family="Helvetica, Arial, sans-serif" fill="#ffffff">${escapeSvgText(clampText(footer, 88))}</text>
</svg>`;
}

function buildGeneratedAssetObjectKey(params: {
  itemId: string;
  variant: "primary" | "cover";
}) {
  return `content-packs/generated/${params.itemId}/${params.variant}-${randomUUID()}.svg`;
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

async function ensureTenantOwnerMembership(params: {
  tenantContext: TenantContext;
  ownerUserId: string | null | undefined;
}) {
  if (!params.ownerUserId) {
    return null;
  }

  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const membership = await tenantPrisma.membership.findFirst({
    where: {
      userId: params.ownerUserId,
      status: "ACTIVE",
    },
    select: {
      userId: true,
    },
  });

  if (!membership) {
    throw new ApiError(404, "NOT_FOUND", "Requested owner user is not active in this tenant.");
  }

  return membership.userId;
}

function normalizeRawRuleRules(
  value: unknown,
): Partial<PlatformRuleDefaults> & { localeAware?: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;

  return {
    ratio: typeof record.ratio === "string" ? record.ratio : undefined,
    dimensions: typeof record.dimensions === "string" ? record.dimensions : undefined,
    copyLimit:
      typeof record.copyLimit === "number" && Number.isFinite(record.copyLimit)
        ? record.copyLimit
        : undefined,
    hashtagLimit:
      typeof record.hashtagLimit === "number" && Number.isFinite(record.hashtagLimit)
        ? record.hashtagLimit
        : undefined,
    recommendedWindow:
      typeof record.recommendedWindow === "string"
        ? record.recommendedWindow
        : typeof record.publishWindow === "string"
          ? record.publishWindow
          : undefined,
    coverStyle: typeof record.coverStyle === "string" ? record.coverStyle : undefined,
    durationSeconds:
      typeof record.durationSeconds === "number" && Number.isFinite(record.durationSeconds)
        ? record.durationSeconds
        : undefined,
    localeAware: typeof record.localeAware === "boolean" ? record.localeAware : undefined,
  };
}

function buildPlatformRule(
  platform: Platform,
  displayName?: string | null,
  rawRules?: unknown,
): NormalizedPlatformRule {
  const defaults = PLATFORM_DEFAULTS[platform];
  const overrides = normalizeRawRuleRules(rawRules);

  return {
    platform,
    displayName: displayName?.trim() || PLATFORM_LABELS[platform],
    mediaType: defaults.mediaType,
    ratio: overrides.ratio ?? defaults.ratio,
    dimensions: overrides.dimensions ?? defaults.dimensions,
    copyLimit: overrides.copyLimit ?? defaults.copyLimit,
    hashtagLimit: overrides.hashtagLimit ?? defaults.hashtagLimit,
    recommendedWindow: overrides.recommendedWindow ?? defaults.recommendedWindow,
    coverStyle: overrides.coverStyle ?? defaults.coverStyle,
    durationSeconds: overrides.durationSeconds ?? defaults.durationSeconds,
    localeAware: overrides.localeAware ?? true,
    notes: defaults.notes,
    rawRules:
      rawRules && typeof rawRules === "object" && !Array.isArray(rawRules)
        ? (rawRules as Record<string, unknown>)
        : {},
  };
}

async function getPlatformRulesMap() {
  const prisma = getPrismaClient();
  const storedRules = await prisma.platformRule.findMany({
    orderBy: {
      createdAt: "asc",
    },
    select: {
      platform: true,
      displayName: true,
      rules: true,
    },
  });
  const byPlatform = new Map<Platform, NormalizedPlatformRule>();

  for (const platform of PLATFORM_ORDER) {
    const stored = storedRules.find((item) => item.platform === platform);
    byPlatform.set(
      platform,
      buildPlatformRule(platform, stored?.displayName, stored?.rules),
    );
  }

  return byPlatform;
}

async function getLatestBrandKit(tenantContext: TenantContext) {
  const tenantPrisma = getTenantPrisma(tenantContext);

  return tenantPrisma.brandKit.findFirst({
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      name: true,
      companyName: true,
      primaryColor: true,
      secondaryColor: true,
      logoUrl: true,
      metadata: true,
    },
  });
}

async function resolvePackCampaign(params: {
  tenantContext: TenantContext;
  createdByUserId?: string;
  campaignId?: string;
  topic: string;
  market?: string;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);

  if (params.campaignId) {
    const existing = await tenantPrisma.campaign.findUnique({
      where: {
        id: params.campaignId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      throw new ApiError(404, "NOT_FOUND", "Campaign not found.");
    }

    return existing.id;
  }

  const created = await tenantPrisma.campaign.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      name: `${params.topic} campaign`,
      topic: params.topic,
      market: params.market ?? null,
      status: "DRAFT",
    },
    select: {
      id: true,
    },
  });

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.createdByUserId,
    action: "campaign_created_from_content_pack",
    entityType: "campaign",
    entityId: created.id,
    metadata: {
      topic: params.topic,
      market: params.market ?? null,
    },
  });

  return created.id;
}

async function resolveDefaultTargetUrl(tenantContext: TenantContext, locale: ApiLocale) {
  const prisma = getPrismaClient();
  const publishedSite = await prisma.siteProject.findFirst({
    where: {
      tenantId: tenantContext.tenantId,
      status: "PUBLISHED",
    },
    orderBy: [
      {
        publishedAt: "desc",
      },
      {
        updatedAt: "desc",
      },
    ],
    select: {
      slug: true,
      locales: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          locale: true,
          urlPath: true,
        },
      },
    },
  });
  const appUrl = getEnv().APP_URL.replace(/\/$/, "");

  if (!publishedSite) {
    return `${appUrl}/`;
  }

  const matchedLocale =
    publishedSite.locales.find((item) => item.locale === toPrismaLocale(locale)) ??
    publishedSite.locales[0] ??
    null;

  if (!matchedLocale) {
    return `${appUrl}/`;
  }

  return `${appUrl}${matchedLocale.urlPath}`;
}

async function searchPackKnowledge(params: {
  tenantContext: TenantContext;
  requestedByUserId?: string;
  topic: string;
  market?: string;
  fetchImpl?: typeof fetch;
}) {
  const result = await hybridSearchKnowledgeChunks({
    tenantContext: params.tenantContext,
    userId: params.requestedByUserId,
    query: [params.topic, params.market ?? ""].filter(Boolean).join(" "),
    limit: 6,
    allowInternalOnly: false,
    market: params.market ?? null,
    fetchImpl: params.fetchImpl,
  });

  return result.items ?? [];
}

function buildKnowledgeSummary(
  knowledgeItems: Awaited<ReturnType<typeof searchPackKnowledge>>,
) {
  return knowledgeItems.map((item) => ({
    text: item.text,
    sourceCitation: item.sourceCitation,
    sensitivity: KnowledgeSensitivity.PUBLIC,
  }));
}

function buildGeneratePrompt(params: {
  input: ContentPackGenerateInput;
  selectedPlatforms: Platform[];
  platformRules: NormalizedPlatformRule[];
  brandKit: Awaited<ReturnType<typeof getLatestBrandKit>>;
}) {
  return [
    "Create a social content pack in JSON only.",
    `Topic: ${params.input.topic}`,
    `Market: ${params.input.market ?? "Global export buyers"}`,
    `Locales: ${params.input.locales.join(", ")}`,
    `Primary locale: ${params.input.locales[0] ?? "en"}`,
    `Platforms: ${params.selectedPlatforms.map((item) => PLATFORM_LABELS[item]).join(", ")}`,
    params.brandKit
      ? `Brand kit: ${params.brandKit.companyName}, primary ${params.brandKit.primaryColor ?? "n/a"}, secondary ${params.brandKit.secondaryColor ?? "n/a"}`
      : "Brand kit: use a neutral industrial B2B look.",
    "For image and carousel platforms, return usable imagePrompt, coverHeadline, caption body, hashtags, visualDirection.",
    "For video platforms, return script beats, storyboard beats, coverHeadline, caption body, hashtags. Do not generate rendered video, TTS, or subtitles.",
    "Return JSON with keys: title, items[].",
    "items[] requires: platform(uppercase enum), title, body, hashtags[], coverHeadline, visualDirection, storyboard[], script[], imagePrompt?, notes[].",
    "Respect these platform rules:",
    ...params.platformRules.map(
      (rule) =>
        `- ${rule.displayName}: mediaType=${rule.mediaType.toLowerCase()}, ratio=${rule.ratio}, dimensions=${rule.dimensions}, copyLimit=${rule.copyLimit}, hashtagLimit=${rule.hashtagLimit}, window=${rule.recommendedWindow}`,
    ),
  ].join("\n");
}

function buildChatPrompt(params: {
  detail: Awaited<ReturnType<typeof getContentPackDetail>>;
  message: string;
}) {
  return [
    "Revise the existing social content pack and return JSON only.",
    `Pack title: ${params.detail.pack.title}`,
    `Topic: ${params.detail.pack.topic}`,
    `Message: ${params.message}`,
    "Current items JSON:",
    JSON.stringify(
      params.detail.items.map((item) => ({
        platform: item.platform.toUpperCase(),
        title: item.title,
        body: item.body,
        mediaType: item.mediaType,
        spec: item.spec,
      })),
    ),
    "Return JSON with keys: title, items[].",
    "Each item uses: platform(uppercase enum), title, body, hashtags[], coverHeadline, visualDirection, storyboard[], script[], imagePrompt?, notes[].",
    "Do not create final rendered video, TTS, or subtitles.",
  ].join("\n");
}

function fallbackHashtags(params: { topic: string; market?: string; platform: Platform }) {
  const topicToken = normalizeSlugPart(params.topic).replace(/-/g, "");
  const marketToken = normalizeSlugPart(params.market ?? "export").replace(/-/g, "");

  return [
    `#${PLATFORM_LABELS[params.platform].replace(/\s+/g, "")}`,
    `#${topicToken.slice(0, 18) || "industrial"}`,
    `#${marketToken.slice(0, 18) || "export"}`,
    "#B2B",
    "#TradePilot",
  ];
}

function buildFallbackPackItems(params: {
  input: ContentPackGenerateInput;
  selectedPlatforms: Platform[];
  platformRules: Map<Platform, NormalizedPlatformRule>;
  brandKit: Awaited<ReturnType<typeof getLatestBrandKit>>;
  knowledgeItems: Awaited<ReturnType<typeof searchPackKnowledge>>;
}): ModelPackItem[] {
  const proofText =
    params.knowledgeItems[0]?.text ??
    `${params.input.topic} is positioned for overseas buyers with public proof points only.`;
  const proofCitation = params.knowledgeItems[0]?.sourceCitation ?? "public knowledge";
  const brandTone =
    params.brandKit && typeof params.brandKit.metadata === "object" && params.brandKit.metadata
      ? String((params.brandKit.metadata as Record<string, unknown>).tone ?? "industrial clarity")
      : "industrial clarity";

  return params.selectedPlatforms.map((platform) => {
    const rule = params.platformRules.get(platform)!;
    const hashtags = fallbackHashtags({
      topic: params.input.topic,
      market: params.input.market,
      platform,
    }).slice(0, rule.hashtagLimit);
    const baseTitle = `${PLATFORM_LABELS[platform]} · ${params.input.topic}`;
    const coverHeadline = clampText(
      `${params.input.topic} for ${params.input.market ?? "export buyers"}`,
      120,
    );

    if (VIDEO_PLATFORMS.has(platform)) {
      return {
        platform,
        title: baseTitle,
        body: clampText(
          `${coverHeadline}. Hook with buyer pain, prove with public facts, close with one CTA. Source: ${proofCitation}.`,
          600,
        ),
        hashtags,
        coverHeadline,
        visualDirection: `Use ${brandTone} with ${rule.coverStyle}. Palette ${params.brandKit?.primaryColor ?? "#0C5C56"} / ${params.brandKit?.secondaryColor ?? "#E9F4F2"}.`,
        storyboard: [
          "Hook: show the buyer pain in the first 2 seconds.",
          "Proof: highlight one public capability or certification.",
          "Offer: frame the product fit for the target market.",
          "CTA: ask the viewer to visit the tracked landing page.",
        ],
        script: [
          `Open with: "${coverHeadline}"`,
          "Explain the buyer problem in one sentence.",
          clampText(proofText, 180),
          "Close with a direct distributor response CTA.",
        ],
        notes: [
          `Recommended window: ${rule.recommendedWindow}`,
          "V1.0 output is script/storyboard/cover only.",
        ],
      };
    }

    return {
      platform,
      title: baseTitle,
      body: clampText(
        `${coverHeadline}. ${proofText} CTA: request buyer details through the landing page.`,
        800,
      ),
      hashtags,
      coverHeadline,
      visualDirection: `Use ${brandTone} with ${rule.coverStyle}. Preserve product naming and B2B credibility.`,
      imagePrompt: `Create a ${rule.mediaType.toLowerCase()} concept for ${params.input.topic} targeting ${params.input.market ?? "export buyers"}, using ${params.brandKit?.primaryColor ?? "#0C5C56"} and ${params.brandKit?.secondaryColor ?? "#E9F4F2"}, include product focus and trade-show quality typography.`,
      storyboard:
        rule.mediaType === MediaType.CAROUSEL
          ? [
              "Slide 1: buyer hook",
              "Slide 2: public proof",
              "Slide 3: product fit",
              "Slide 4: CTA",
            ]
          : [],
      script: [],
      notes: [`Recommended window: ${rule.recommendedWindow}`],
    };
  });
}

function calibrateItemByRule(params: {
  item: ModelPackItem;
  rule: NormalizedPlatformRule;
  topic: string;
  market?: string;
  brandKit: Awaited<ReturnType<typeof getLatestBrandKit>>;
}) {
  const hashtags = params.item.hashtags
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
    .slice(0, params.rule.hashtagLimit);
  const notes = Array.from(
    new Set([
      ...params.item.notes,
      ...params.rule.notes,
      `Recommended window: ${params.rule.recommendedWindow}`,
    ]),
  ).slice(0, 8);
  const visualDirection = clampText(params.item.visualDirection, 220);

  if (params.rule.mediaType === MediaType.VIDEO_SCRIPT) {
    return {
      title: clampText(params.item.title, 180),
      body: clampText(params.item.body, params.rule.copyLimit),
      mediaType: params.rule.mediaType,
      spec: {
        ratio: params.rule.ratio,
        dimensions: params.rule.dimensions,
        durationSeconds: params.rule.durationSeconds ?? 30,
        coverHeadline: clampText(params.item.coverHeadline, 140),
        visualDirection,
        hashtags,
        storyboard:
          params.item.storyboard.length > 0
            ? params.item.storyboard.slice(0, 6)
            : [
                "Hook",
                "Proof",
                "Offer",
                "CTA",
              ],
        script:
          params.item.script.length > 0
            ? params.item.script.slice(0, 6)
            : [
                `Open on ${params.topic}`,
                "State the buyer problem",
                "Show one public proof point",
                "End with one CTA",
              ],
        coverStyle: params.rule.coverStyle,
        notes,
        constraints: {
          renderedVideo: false,
          tts: false,
          subtitles: false,
        },
      } satisfies Record<string, unknown>,
    };
  }

  return {
    title: clampText(params.item.title, 180),
    body: clampText(params.item.body, params.rule.copyLimit),
    mediaType: params.rule.mediaType,
    spec: {
      ratio: params.rule.ratio,
      dimensions: params.rule.dimensions,
      coverHeadline: clampText(params.item.coverHeadline, 140),
      visualDirection,
      hashtags,
      imagePrompt:
        params.item.imagePrompt ??
        `Create a ${params.rule.mediaType.toLowerCase()} concept for ${params.topic} in ${params.market ?? "global"} using ${params.brandKit?.primaryColor ?? "#0C5C56"}.`,
      slidePlan:
        params.rule.mediaType === MediaType.CAROUSEL
          ? params.item.storyboard.slice(0, 6)
          : [],
      notes,
    } satisfies Record<string, unknown>,
  };
}

function parseModelPackItems(params: {
  text: string;
  input: ContentPackGenerateInput;
  selectedPlatforms: Platform[];
  platformRules: Map<Platform, NormalizedPlatformRule>;
  brandKit: Awaited<ReturnType<typeof getLatestBrandKit>>;
  knowledgeItems: Awaited<ReturnType<typeof searchPackKnowledge>>;
}) {
  try {
    const parsed = modelPackResponseSchema.parse(
      JSON.parse(extractJsonPayload(params.text)),
    );
    const requestedPlatforms = new Set(params.selectedPlatforms);
    const byPlatform = new Map<Platform, ModelPackItem>();

    for (const item of parsed.items) {
      if (requestedPlatforms.has(item.platform)) {
        byPlatform.set(item.platform, item);
      }
    }

    const fallback = buildFallbackPackItems(params);

    return {
      title: parsed.title,
      items: params.selectedPlatforms.map(
        (platform) =>
          byPlatform.get(platform) ??
          fallback.find((item) => item.platform === platform)!,
      ),
    };
  } catch {
    return {
      title: `${params.input.topic} content pack`,
      items: buildFallbackPackItems(params),
    };
  }
}

function pickPlatformsFromMessage(message: string) {
  const normalized = message.toLowerCase();
  const matched: Platform[] = [];

  for (const platform of PLATFORM_ORDER) {
    const apiName = platform.toLowerCase();
    const label = PLATFORM_LABELS[platform].toLowerCase();

    if (normalized.includes(apiName) || normalized.includes(label)) {
      matched.push(platform);
    }
  }

  return matched;
}

function applyFallbackChatUpdate(params: {
  detail: Awaited<ReturnType<typeof getContentPackDetail>>;
  message: string;
}) {
  const targetedPlatforms = pickPlatformsFromMessage(params.message);
  const targetSet =
    targetedPlatforms.length > 0
      ? new Set(targetedPlatforms)
      : new Set(params.detail.items.map((item) => item.platformEnum));

  return params.detail.items.map((item) =>
    targetSet.has(item.platformEnum)
      ? {
          platform: item.platformEnum,
          title: clampText(`${item.title} · Updated`, 180),
          body: clampText(`${item.body} Update request: ${params.message}`, 4000),
          hashtags: item.hashtags,
          coverHeadline: item.coverHeadline,
          visualDirection:
            typeof item.spec.visualDirection === "string"
              ? `${item.spec.visualDirection} Updated per request.`
              : "Updated per request.",
          storyboard: Array.isArray(item.spec.storyboard)
            ? item.spec.storyboard.map((entry) => String(entry))
            : [],
          script: Array.isArray(item.spec.script)
            ? item.spec.script.map((entry) => String(entry))
            : [],
          imagePrompt:
            typeof item.spec.imagePrompt === "string"
              ? `${item.spec.imagePrompt} Updated per request.`
              : undefined,
          notes: [
            ...item.notes,
            `User request: ${params.message}`,
          ].slice(0, 8),
        }
      : {
          platform: item.platformEnum,
          title: item.title,
          body: item.body,
          hashtags: item.hashtags,
          coverHeadline: item.coverHeadline,
          visualDirection:
            typeof item.spec.visualDirection === "string"
              ? item.spec.visualDirection
              : "Keep current direction.",
          storyboard: Array.isArray(item.spec.storyboard)
            ? item.spec.storyboard.map((entry) => String(entry))
            : [],
          script: Array.isArray(item.spec.script)
            ? item.spec.script.map((entry) => String(entry))
            : [],
          imagePrompt:
            typeof item.spec.imagePrompt === "string"
              ? item.spec.imagePrompt
              : undefined,
          notes: item.notes,
        },
  );
}

async function generatePackDraft(params: {
  tenantContext: TenantContext;
  requestedByUserId?: string;
  input: ContentPackGenerateInput;
  fetchImpl?: typeof fetch;
}) {
  const selectedPlatforms = (
    params.input.platforms?.map((item) => toPrismaPlatform(item)) ?? PLATFORM_ORDER
  ).filter((item, index, collection) => collection.indexOf(item) === index);
  const platformRulesMap = await getPlatformRulesMap();
  const platformRules = selectedPlatforms.map(
    (platform) => platformRulesMap.get(platform)!,
  );
  const brandKit = await getLatestBrandKit(params.tenantContext);
  const knowledgeItems = await searchPackKnowledge({
    tenantContext: params.tenantContext,
    requestedByUserId: params.requestedByUserId,
    topic: params.input.topic,
    market: params.input.market,
    fetchImpl: params.fetchImpl,
  });
  const gateway = createModelGateway({
    fetchImpl: params.fetchImpl,
  });
  const modelResult = await gateway.invoke({
    tenantContext: params.tenantContext,
    userId: params.requestedByUserId,
    taskType: ModelTaskType.GENERATE,
    sensitivity: KnowledgeSensitivity.PUBLIC,
    requestSummary: `content pack generate: ${params.input.topic}`,
    prompt: buildGeneratePrompt({
      input: params.input,
      selectedPlatforms,
      platformRules,
      brandKit,
    }),
    knowledgeChunks: buildKnowledgeSummary(knowledgeItems),
  });
  const parsed = parseModelPackItems({
    text: modelResult.text,
    input: params.input,
    selectedPlatforms,
    platformRules: platformRulesMap,
    brandKit,
    knowledgeItems,
  });

  return {
    title: parsed.title,
    items: parsed.items.map((item) => {
      const rule = platformRulesMap.get(item.platform)!;

      return {
        platform: item.platform,
        ...calibrateItemByRule({
          item,
          rule,
          topic: params.input.topic,
          market: params.input.market,
          brandKit,
        }),
      };
    }),
    platformRulesMap,
    brandKit,
    knowledgeItems,
  };
}

async function upsertTrackingLinksForPack(params: {
  tenantContext: TenantContext;
  contentPackId: string;
  campaignId: string | null;
  locale: ApiLocale;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const items = await tenantPrisma.contentItem.findMany({
    where: {
      contentPackId: params.contentPackId,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      platform: true,
      trackingLink: {
        select: {
          id: true,
        },
      },
    },
  });
  const targetUrl = await resolveDefaultTargetUrl(params.tenantContext, params.locale);

  for (const item of items) {
    if (!item.trackingLink) {
      await createTrackingLink(params.tenantContext, {
        contentItemId: item.id,
        campaignId: params.campaignId ?? undefined,
        targetUrl,
        utmCampaign: normalizeSlugPart(`${params.contentPackId}`).replace(/-/g, "_"),
        utmContent: normalizeSlugPart(item.platform.toLowerCase()),
      });
    }
  }
}

function serializeContentItemSpec(spec: unknown) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return {} as Record<string, unknown>;
  }

  return spec as Record<string, unknown>;
}

function serializeContentPackDetail(params: {
  pack: {
    id: string;
    title: string;
    topic: string;
    market: string | null;
    locales: unknown;
    status: ContentPackStatus;
    createdAt: Date;
    updatedAt: Date;
    campaign: {
      id: string;
      name: string;
      topic: string | null;
      market: string | null;
      status: string;
    } | null;
    brandKit: Awaited<ReturnType<typeof getLatestBrandKit>> | null;
  };
  items: Array<{
    id: string;
    platform: Platform;
    locale: LocaleCode;
    mediaType: MediaType;
    title: string | null;
    body: string | null;
    spec: unknown;
    publishStatus: PublishStatus;
    plannedAt: Date | null;
    publishedAt: Date | null;
    owner: {
      id: string;
      name: string | null;
      email: string;
    } | null;
    trackingLink: {
      id: string;
      slug: string;
      targetUrl: string;
      utmSource: string;
      utmMedium: string;
      utmCampaign: string;
      utmContent: string | null;
    } | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  const locales = Array.isArray(params.pack.locales)
    ? params.pack.locales.filter((item): item is ApiLocale => typeof item === "string")
    : [];

  return {
    pack: {
      id: params.pack.id,
      title: params.pack.title,
      topic: params.pack.topic,
      market: params.pack.market,
      locales,
      status: toApiContentPackStatus(params.pack.status),
      createdAt: params.pack.createdAt.toISOString(),
      updatedAt: params.pack.updatedAt.toISOString(),
      campaign: params.pack.campaign
        ? {
            id: params.pack.campaign.id,
            name: params.pack.campaign.name,
            topic: params.pack.campaign.topic,
            market: params.pack.campaign.market,
            status: params.pack.campaign.status.toLowerCase(),
          }
        : null,
      brandKit: params.pack.brandKit
        ? {
            id: params.pack.brandKit.id,
            name: params.pack.brandKit.name,
            companyName: params.pack.brandKit.companyName,
            primaryColor: params.pack.brandKit.primaryColor,
            secondaryColor: params.pack.brandKit.secondaryColor,
            logoUrl: params.pack.brandKit.logoUrl,
            metadata: params.pack.brandKit.metadata,
          }
        : null,
    },
    items: params.items.map((item) => {
      const normalizedSpec = serializeContentItemSpec(item.spec);
      const hashtags = Array.isArray(normalizedSpec.hashtags)
        ? normalizedSpec.hashtags.map((entry) => String(entry))
        : [];
      const notes = Array.isArray(normalizedSpec.notes)
        ? normalizedSpec.notes.map((entry) => String(entry))
        : [];

      return {
        id: item.id,
        platform: toApiPlatform(item.platform),
        platformEnum: item.platform,
        locale: toApiLocale(item.locale),
        mediaType: toApiMediaType(item.mediaType),
        title: item.title ?? "",
        body: item.body ?? "",
        hashtags,
        coverHeadline:
          typeof normalizedSpec.coverHeadline === "string"
            ? normalizedSpec.coverHeadline
            : item.title ?? "",
        notes,
        spec: normalizedSpec,
        publishStatus: toApiPublishStatus(item.publishStatus),
        plannedAt: item.plannedAt?.toISOString() ?? null,
        publishedAt: item.publishedAt?.toISOString() ?? null,
        owner: item.owner
          ? {
              id: item.owner.id,
              name: item.owner.name,
              email: item.owner.email,
            }
          : null,
        trackingLink: item.trackingLink
          ? {
              id: item.trackingLink.id,
              slug: item.trackingLink.slug,
              targetUrl: item.trackingLink.targetUrl,
              resolvedUrl: buildResolvedTrackingUrl(item.trackingLink),
              utmSource: item.trackingLink.utmSource,
              utmMedium: item.trackingLink.utmMedium,
              utmCampaign: item.trackingLink.utmCampaign,
              utmContent: item.trackingLink.utmContent,
            }
          : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      };
    }),
  };
}

async function getContentPackRecord(tenantContext: TenantContext, packId: string) {
  const tenantPrisma = getTenantPrisma(tenantContext);

  return tenantPrisma.contentPack.findUnique({
    where: {
      id: packId,
    },
    select: {
      id: true,
      title: true,
      topic: true,
      market: true,
      locales: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      campaign: {
        select: {
          id: true,
          name: true,
          topic: true,
          market: true,
          status: true,
        },
      },
      items: {
        orderBy: [
          {
            plannedAt: "asc",
          },
          {
            createdAt: "asc",
          },
        ],
        select: {
          id: true,
          platform: true,
          locale: true,
          mediaType: true,
          title: true,
          body: true,
          spec: true,
          publishStatus: true,
          plannedAt: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          trackingLink: {
            select: {
              id: true,
              slug: true,
              targetUrl: true,
              utmSource: true,
              utmMedium: true,
              utmCampaign: true,
              utmContent: true,
            },
          },
        },
      },
    },
  });
}

export async function listPlatformRules() {
  const ruleMap = await getPlatformRulesMap();

  return {
    items: PLATFORM_ORDER.map((platform) => {
      const rule = ruleMap.get(platform)!;

      return {
        platform: toApiPlatform(platform),
        displayName: rule.displayName,
        mediaType: toApiMediaType(rule.mediaType),
        rules: {
          ratio: rule.ratio,
          dimensions: rule.dimensions,
          copyLimit: rule.copyLimit,
          hashtagLimit: rule.hashtagLimit,
          recommendedWindow: rule.recommendedWindow,
          coverStyle: rule.coverStyle,
          durationSeconds: rule.durationSeconds ?? null,
          localeAware: rule.localeAware,
          notes: rule.notes,
          ...rule.rawRules,
        },
      };
    }),
  };
}

export async function createContentPackGenerationRequest(params: {
  tenantContext: TenantContext;
  requestedByUserId?: string;
  input: ContentPackGenerateInput;
}) {
  const input = contentPackGenerateSchema.parse(params.input);
  const campaignId = await resolvePackCampaign({
    tenantContext: params.tenantContext,
    createdByUserId: params.requestedByUserId,
    campaignId: input.campaignId,
    topic: input.topic,
    market: input.market,
  });
  const prisma = getPrismaClient();
  const contentPack = await prisma.contentPack.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      campaignId,
      createdByUserId: params.requestedByUserId,
      title: `${input.topic} pack`,
      topic: input.topic,
      market: input.market ?? null,
      locales: input.locales,
      status: ContentPackStatus.PROCESSING,
    },
    select: {
      id: true,
    },
  });
  const queued = await enqueueTenantJob({
    tenantContext: params.tenantContext,
    requestedByUserId: params.requestedByUserId,
    type: JobType.GENERATE_CONTENT_PACK,
    input: {
      contentPackId: contentPack.id,
      request: input,
    },
  });

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.requestedByUserId,
    action: "content_pack_generation_requested",
    entityType: "content_pack",
    entityId: contentPack.id,
    metadata: {
      campaignId,
      topic: input.topic,
      platforms: input.platforms ?? PLATFORM_ORDER.map((item) => item.toLowerCase()),
    },
  });

  return {
    packId: contentPack.id,
    jobId: queued.jobId,
  };
}

export async function runGenerateContentPackJob(params: {
  tenantId: string;
  requestedByUserId?: string;
  contentPackId: string;
  request: ContentPackGenerateInput;
  reportProgress?: (progress: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}) {
  const tenantContext: TenantContext = {
    tenantId: params.tenantId,
    userId: params.requestedByUserId ?? "system",
    role: "OWNER",
  };
  const tenantPrisma = getTenantPrisma(tenantContext);

  await tenantPrisma.contentPack.update({
    where: {
      id: params.contentPackId,
    },
    data: {
      status: ContentPackStatus.PROCESSING,
    },
  });
  await params.reportProgress?.(12);

  const draft = await generatePackDraft({
    tenantContext,
    requestedByUserId: params.requestedByUserId,
    input: params.request,
    fetchImpl: params.fetchImpl,
  });
  await params.reportProgress?.(48);

  await tenantPrisma.contentItem.deleteMany({
    where: {
      contentPackId: params.contentPackId,
    },
  });
  await params.reportProgress?.(58);

  for (const [index, item] of draft.items.entries()) {
    await tenantPrisma.contentItem.create({
      data: {
        tenantId: tenantContext.tenantId,
        contentPackId: params.contentPackId,
        platform: item.platform,
        locale: toPrismaLocale(params.request.locales[0] ?? "en"),
        mediaType: item.mediaType,
        title: item.title,
        body: item.body,
        spec: item.spec,
        publishStatus: PublishStatus.PENDING,
        plannedAt: new Date(Date.now() + index * 3_600_000),
      },
    });
  }
  await params.reportProgress?.(72);

  const packRecord = await tenantPrisma.contentPack.findUnique({
    where: {
      id: params.contentPackId,
    },
    select: {
      campaignId: true,
    },
  });

  await upsertTrackingLinksForPack({
    tenantContext,
    contentPackId: params.contentPackId,
    campaignId: packRecord?.campaignId ?? null,
    locale: params.request.locales[0] ?? "en",
  });
  await params.reportProgress?.(88);

  await tenantPrisma.contentPack.update({
    where: {
      id: params.contentPackId,
    },
    data: {
      title: draft.title,
      status: ContentPackStatus.READY,
    },
  });
  await createAuditLog({
    tenantId: tenantContext.tenantId,
    actorUserId: params.requestedByUserId,
    action: "content_pack_generated",
    entityType: "content_pack",
    entityId: params.contentPackId,
    metadata: {
      platformCount: draft.items.length,
      locales: params.request.locales,
      trackingLinksCreated: draft.items.length,
    },
  });
  await params.reportProgress?.(100);

  return {
    contentPackId: params.contentPackId,
    itemCount: draft.items.length,
    locales: params.request.locales,
    status: "ready",
  };
}

export async function getContentPackDetail(
  tenantContext: TenantContext,
  packId: string,
) {
  const pack = await getContentPackRecord(tenantContext, packId);

  if (!pack) {
    throw new ApiError(404, "NOT_FOUND", "Content pack not found.");
  }

  const brandKit = await getLatestBrandKit(tenantContext);

  return serializeContentPackDetail({
    pack: {
      ...pack,
      brandKit,
    },
    items: pack.items,
  });
}

export async function applyContentPackChatUpdate(params: {
  tenantContext: TenantContext;
  packId: string;
  requestedByUserId?: string;
  input: ContentPackChatInput;
  fetchImpl?: typeof fetch;
}) {
  const input = contentPackChatMessageSchema.parse(params.input);
  const detail = await getContentPackDetail(params.tenantContext, params.packId);
  const platformRulesMap = await getPlatformRulesMap();
  const brandKit = await getLatestBrandKit(params.tenantContext);
  const knowledgeItems = await searchPackKnowledge({
    tenantContext: params.tenantContext,
    requestedByUserId: params.requestedByUserId,
    topic: detail.pack.topic,
    market: detail.pack.market ?? undefined,
    fetchImpl: params.fetchImpl,
  });
  const gateway = createModelGateway({
    fetchImpl: params.fetchImpl,
  });
  const modelResult = await gateway.invoke({
    tenantContext: params.tenantContext,
    userId: params.requestedByUserId,
    taskType: ModelTaskType.GENERATE,
    sensitivity: KnowledgeSensitivity.PUBLIC,
    requestSummary: `content pack chat: ${detail.pack.id}`,
    prompt: buildChatPrompt({
      detail,
      message: input.message,
    }),
    knowledgeChunks: buildKnowledgeSummary(knowledgeItems),
  });

  let nextItems: ModelPackItem[];

  try {
    const parsed = modelPackResponseSchema.parse(
      JSON.parse(extractJsonPayload(modelResult.text)),
    );
    const byPlatform = new Map<Platform, ModelPackItem>();

    for (const item of parsed.items) {
      byPlatform.set(item.platform, item);
    }

    nextItems = detail.items.map((item) => {
      const revised = byPlatform.get(item.platformEnum);

      if (revised) {
        return revised;
      }

      return {
        platform: item.platformEnum,
        title: item.title,
        body: item.body,
        hashtags: item.hashtags,
        coverHeadline: item.coverHeadline,
        visualDirection:
          typeof item.spec.visualDirection === "string"
            ? item.spec.visualDirection
            : "Keep current direction.",
        storyboard: Array.isArray(item.spec.storyboard)
          ? item.spec.storyboard.map((entry) => String(entry))
          : [],
        script: Array.isArray(item.spec.script)
          ? item.spec.script.map((entry) => String(entry))
          : [],
        imagePrompt:
          typeof item.spec.imagePrompt === "string"
            ? item.spec.imagePrompt
            : undefined,
        notes: item.notes,
      };
    });
  } catch {
    nextItems = applyFallbackChatUpdate({
      detail,
      message: input.message,
    });
  }

  const tenantPrisma = getTenantPrisma(params.tenantContext);

  for (const nextItem of nextItems) {
    const rule = platformRulesMap.get(nextItem.platform)!;
    const calibrated = calibrateItemByRule({
      item: nextItem,
      rule,
      topic: detail.pack.topic,
      market: detail.pack.market ?? undefined,
      brandKit,
    });

    await tenantPrisma.contentItem.updateMany({
      where: {
        contentPackId: params.packId,
        platform: nextItem.platform,
      },
      data: {
        title: calibrated.title,
        body: calibrated.body,
        mediaType: calibrated.mediaType,
        spec: calibrated.spec,
      },
    });
  }

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.requestedByUserId,
    action: "content_pack_updated_by_chat",
    entityType: "content_pack",
    entityId: params.packId,
    metadata: {
      message: input.message,
    },
  });

  return getContentPackDetail(params.tenantContext, params.packId);
}

async function getContentItemRecord(params: {
  tenantContext: TenantContext;
  itemId: string;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);

  return tenantPrisma.contentItem.findUnique({
    where: {
      id: params.itemId,
    },
    select: {
      id: true,
      contentPackId: true,
      platform: true,
      mediaType: true,
      title: true,
      body: true,
      spec: true,
      publishStatus: true,
      plannedAt: true,
      publishedAt: true,
      ownerUserId: true,
    },
  });
}

export async function updateContentItem(params: {
  tenantContext: TenantContext;
  itemId: string;
  requestedByUserId?: string;
  input: ContentItemPatchInput;
}) {
  const input = contentItemPatchSchema.parse(params.input);
  const item = await getContentItemRecord({
    tenantContext: params.tenantContext,
    itemId: params.itemId,
  });

  if (!item) {
    throw new ApiError(404, "NOT_FOUND", "Content item not found.");
  }

  const ownerUserId = await ensureTenantOwnerMembership({
    tenantContext: params.tenantContext,
    ownerUserId: input.ownerUserId,
  });
  const tenantPrisma = getTenantPrisma(params.tenantContext);

  await tenantPrisma.contentItem.update({
    where: {
      id: params.itemId,
    },
    data: {
      title: input.title ?? undefined,
      body: input.body ?? undefined,
      plannedAt:
        input.plannedAt === undefined
          ? undefined
          : input.plannedAt === null
            ? null
            : new Date(input.plannedAt),
      ownerUserId:
        input.ownerUserId === undefined
          ? undefined
          : ownerUserId,
    },
  });

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.requestedByUserId,
    action: "content_item_updated",
    entityType: "content_item",
    entityId: params.itemId,
    metadata: {
      titleChanged: input.title !== undefined,
      bodyChanged: input.body !== undefined,
      plannedAtChanged: input.plannedAt !== undefined,
      ownerChanged: input.ownerUserId !== undefined,
    },
  });

  return getContentPackDetail(params.tenantContext, item.contentPackId);
}

export async function generateContentItemImageAssets(params: {
  tenantContext: TenantContext;
  itemId: string;
  requestedByUserId?: string;
  input?: ContentItemImageGenerationInput;
}) {
  const input = contentItemImageGenerationSchema.parse(params.input ?? {});
  const item = await getContentItemRecord({
    tenantContext: params.tenantContext,
    itemId: params.itemId,
  });

  if (!item) {
    throw new ApiError(404, "NOT_FOUND", "Content item not found.");
  }

  if (item.mediaType === MediaType.VIDEO_SCRIPT) {
    throw new ApiError(
      409,
      "CONFLICT",
      "Video script items are limited to script, storyboard, and cover planning in V1.0.",
    );
  }

  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const normalizedSpec = serializeContentItemSpec(item.spec);
  const brandKit = await getLatestBrandKit(params.tenantContext);
  const { width, height } = parseDimensions(
    typeof normalizedSpec.dimensions === "string"
      ? normalizedSpec.dimensions
      : undefined,
  );
  const companyName = brandKit?.companyName ?? "TradePilot";
  const primaryColor = brandKit?.primaryColor ?? "#0C5C56";
  const secondaryColor = brandKit?.secondaryColor ?? "#E9F4F2";
  const prompt =
    typeof normalizedSpec.imagePrompt === "string"
      ? normalizedSpec.imagePrompt
      : item.body ?? item.title ?? PLATFORM_LABELS[item.platform];
  const visualDirection =
    typeof normalizedSpec.visualDirection === "string"
      ? normalizedSpec.visualDirection
      : "industrial B2B visual system";
  const coverHeadline =
    typeof normalizedSpec.coverHeadline === "string" && normalizedSpec.coverHeadline.trim()
      ? normalizedSpec.coverHeadline
      : item.title ?? PLATFORM_LABELS[item.platform];
  const variants: Array<"primary" | "cover"> = ["primary", "cover"];
  const nextAssets: Array<Record<string, unknown>> = [];

  for (const variant of variants) {
    const svg = buildGeneratedImageSvg({
      companyName,
      platformLabel: PLATFORM_LABELS[item.platform],
      title: item.title ?? PLATFORM_LABELS[item.platform],
      coverHeadline,
      prompt,
      visualDirection,
      backgroundStyle: input.backgroundStyle,
      referenceLabel: input.referenceLabel,
      primaryColor,
      secondaryColor,
      width,
      height,
      variant,
      mode: input.mode,
    });
    const objectKey = buildGeneratedAssetObjectKey({
      itemId: item.id,
      variant,
    });
    const buffer = Buffer.from(svg, "utf8");
    const stored = await putTenantObject({
      tenantId: params.tenantContext.tenantId,
      objectKey,
      body: buffer,
      contentType: "image/svg+xml",
    });
    const file = await tenantPrisma.file.create({
      data: {
        tenantId: params.tenantContext.tenantId,
        uploadedByUserId: params.requestedByUserId,
        sourceType: FileSourceType.GENERATED,
        kind: FileKind.IMAGE,
        originalName: `${normalizeSlugPart(item.title ?? PLATFORM_LABELS[item.platform]) || item.id}-${variant}.svg`,
        mimeType: "image/svg+xml",
        sizeBytes: buffer.byteLength,
        bucket: stored.bucket,
        objectKey,
        checksum: createHash("sha256").update(buffer).digest("hex"),
      },
      select: {
        id: true,
      },
    });

    nextAssets.push({
      id: randomUUID(),
      fileId: file.id,
      variant,
      mode: input.mode,
      width,
      height,
      mimeType: "image/svg+xml",
      previewUrl: `/api/files/${file.id}`,
      createdAt: new Date().toISOString(),
      backgroundStyle: input.backgroundStyle ?? null,
      referenceLabel: input.referenceLabel ?? null,
    });
  }

  const existingAssets = Array.isArray(normalizedSpec.generatedAssets)
    ? normalizedSpec.generatedAssets.filter(
        (entry) =>
          !entry ||
          typeof entry !== "object" ||
          !("variant" in entry) ||
          !variants.includes(String(entry.variant) as "primary" | "cover"),
      )
    : [];

  await tenantPrisma.contentItem.update({
    where: {
      id: params.itemId,
    },
    data: {
      spec: {
        ...normalizedSpec,
        generatedAssets: [...existingAssets, ...nextAssets],
        generatedImageMode: input.mode,
        generatedImageUpdatedAt: new Date().toISOString(),
      },
    },
  });

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.requestedByUserId,
    action: "content_item_generated_image_assets",
    entityType: "content_item",
    entityId: params.itemId,
    metadata: {
      mode: input.mode,
      generatedVariants: variants,
    },
  });

  return getContentPackDetail(params.tenantContext, item.contentPackId);
}

export async function markContentItemPublished(params: {
  tenantContext: TenantContext;
  itemId: string;
  requestedByUserId?: string;
}) {
  const item = await getContentItemRecord({
    tenantContext: params.tenantContext,
    itemId: params.itemId,
  });

  if (!item) {
    throw new ApiError(404, "NOT_FOUND", "Content item not found.");
  }

  const tenantPrisma = getTenantPrisma(params.tenantContext);

  await tenantPrisma.contentItem.update({
    where: {
      id: params.itemId,
    },
    data: {
      publishStatus: PublishStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.requestedByUserId,
    action: "content_item_marked_published",
    entityType: "content_item",
    entityId: params.itemId,
    metadata: {
      platform: item.platform.toLowerCase(),
    },
  });

  return getContentPackDetail(params.tenantContext, item.contentPackId);
}

export async function unmarkContentItemPublished(params: {
  tenantContext: TenantContext;
  itemId: string;
  requestedByUserId?: string;
}) {
  const item = await getContentItemRecord({
    tenantContext: params.tenantContext,
    itemId: params.itemId,
  });

  if (!item) {
    throw new ApiError(404, "NOT_FOUND", "Content item not found.");
  }

  const tenantPrisma = getTenantPrisma(params.tenantContext);

  await tenantPrisma.contentItem.update({
    where: {
      id: params.itemId,
    },
    data: {
      publishStatus: PublishStatus.PENDING,
      publishedAt: null,
    },
  });

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.requestedByUserId,
    action: "content_item_unmarked_published",
    entityType: "content_item",
    entityId: params.itemId,
  });

  return getContentPackDetail(params.tenantContext, item.contentPackId);
}

function escapeCsvField(value: string | null | undefined) {
  const normalized = value ?? "";

  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }

  return normalized;
}

function buildCsvExport(detail: Awaited<ReturnType<typeof getContentPackDetail>>) {
  const header = [
    "platform",
    "mediaType",
    "title",
    "plannedAt",
    "publishStatus",
    "trackingUrl",
    "trackingSlug",
    "body",
  ];
  const rows = detail.items.map((item) =>
    [
      item.platform,
      item.mediaType,
      item.title,
      item.plannedAt ?? "",
      item.publishStatus,
      item.trackingLink?.resolvedUrl ?? "",
      item.trackingLink?.slug ?? "",
      item.body,
    ]
      .map((field) => escapeCsvField(field))
      .join(","),
  );

  return [header.join(","), ...rows].join("\n");
}

function buildMarkdownExport(detail: Awaited<ReturnType<typeof getContentPackDetail>>) {
  return [
    `# ${detail.pack.title}`,
    "",
    `- Topic: ${detail.pack.topic}`,
    `- Market: ${detail.pack.market ?? "Global"}`,
    `- Status: ${detail.pack.status}`,
    "",
    "## Publish Checklist",
    "",
    ...detail.items.flatMap((item) => [
      `### ${PLATFORM_LABELS[item.platformEnum]}`,
      `- Media type: ${item.mediaType}`,
      `- Planned at: ${item.plannedAt ?? "Not scheduled"}`,
      `- Publish status: ${item.publishStatus}`,
      `- Tracking link: ${item.trackingLink?.resolvedUrl ?? "Missing"}`,
      "",
      item.title,
      "",
      item.body,
      "",
    ]),
  ].join("\n");
}

async function buildZipExport(detail: Awaited<ReturnType<typeof getContentPackDetail>>) {
  const tempDir = await mkdtemp(join(tmpdir(), "tradepilot-pack-"));
  const baseName = normalizeSlugPart(detail.pack.title) || detail.pack.id;
  const csvPath = join(tempDir, `${baseName}.csv`);
  const mdPath = join(tempDir, `${baseName}.md`);
  const zipPath = join(tempDir, `${baseName}.zip`);

  try {
    await writeFile(csvPath, buildCsvExport(detail), "utf8");
    await writeFile(mdPath, buildMarkdownExport(detail), "utf8");
    await execFile("/usr/bin/zip", ["-j", zipPath, csvPath, mdPath]);

    return readFile(zipPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function exportContentPack(params: {
  tenantContext: TenantContext;
  packId: string;
  format: z.infer<typeof exportFormatSchema>;
}) {
  const format = exportFormatSchema.parse(params.format);
  const detail = await getContentPackDetail(params.tenantContext, params.packId);

  if (format === "csv") {
    return {
      fileName: `${normalizeSlugPart(detail.pack.title) || detail.pack.id}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: Buffer.from(buildCsvExport(detail), "utf8"),
    };
  }

  if (format === "md") {
    return {
      fileName: `${normalizeSlugPart(detail.pack.title) || detail.pack.id}.md`,
      contentType: "text/markdown; charset=utf-8",
      body: Buffer.from(buildMarkdownExport(detail), "utf8"),
    };
  }

  return {
    fileName: `${normalizeSlugPart(detail.pack.title) || detail.pack.id}.zip`,
    contentType: "application/zip",
    body: await buildZipExport(detail),
  };
}
