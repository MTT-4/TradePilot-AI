import { randomBytes } from "node:crypto";
import {
  Platform,
} from "@prisma/client";
import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import { getPrismaClient } from "@/server/db/prisma";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import type { TenantContext } from "@/server/db/tenant-context";

const trackingLinkInputSchema = z.object({
  contentItemId: z.string().min(1),
  campaignId: z.string().min(1).optional(),
  targetUrl: z.string().url(),
  utmSource: z.string().trim().min(1).max(80).optional(),
  utmMedium: z.string().trim().min(1).max(80).optional(),
  utmCampaign: z.string().trim().min(1).max(120).optional(),
  utmContent: z.string().trim().min(1).max(120).optional().nullable(),
  botFilterEnabled: z.boolean().optional(),
});

const BOT_USER_AGENT_PATTERN =
  /(bot|crawler|spider|preview|slurp|headless|facebookexternalhit|whatsapp|telegram|linkedinbot|slackbot|discordbot)/i;

export type TrackingAttribution = {
  tenantId: string;
  trackingLinkId: string;
  campaignId: string | null;
  contentItemId: string;
  platform: Platform;
  slug: string;
  targetUrl: string;
  resolvedUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string | null;
  botFilterEnabled: boolean;
};

type CreateTrackingLinkInput = z.infer<typeof trackingLinkInputSchema>;

type RecordClickEventInput = {
  slug: string;
  visitorIp?: string | null;
  userAgent?: string | null;
  referer?: string | null;
  queryString?: string | null;
};

function normalizeSlugPart(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function validateTargetUrl(targetUrl: string) {
  let parsed: URL;

  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new ApiError(400, "VALIDATION", "targetUrl must be a valid URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ApiError(
      400,
      "VALIDATION",
      "targetUrl must use http or https.",
    );
  }

  return parsed;
}

async function generateUniqueSlug(
  tenantSlug: string,
  platform: Platform,
) {
  const prisma = getPrismaClient();
  const tenantPart = normalizeSlugPart(tenantSlug).slice(0, 10) || "tp";
  const platformPart = platform.toLowerCase().replace(/_/g, "-");

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const randomPart = randomBytes(4).toString("base64url").toLowerCase();
    const slug = `${tenantPart}-${platformPart}-${randomPart}`;
    const existing = await prisma.trackingLink.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!existing) {
      return slug;
    }
  }

  throw new ApiError(409, "CONFLICT", "Unable to allocate tracking slug.");
}

function appendServerUtms(trackingLink: {
  targetUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string | null;
}) {
  const targetUrl = validateTargetUrl(trackingLink.targetUrl);

  targetUrl.searchParams.set("utm_source", trackingLink.utmSource);
  targetUrl.searchParams.set("utm_medium", trackingLink.utmMedium);
  targetUrl.searchParams.set("utm_campaign", trackingLink.utmCampaign);

  if (trackingLink.utmContent) {
    targetUrl.searchParams.set("utm_content", trackingLink.utmContent);
  } else {
    targetUrl.searchParams.delete("utm_content");
  }

  return targetUrl.toString();
}

export async function createTrackingLink(
  tenantContext: TenantContext,
  rawInput: CreateTrackingLinkInput,
) {
  const input = trackingLinkInputSchema.parse(rawInput);
  const prisma = getTenantPrisma(tenantContext);
  const targetUrl = validateTargetUrl(input.targetUrl);
  const contentItem = await prisma.contentItem.findUnique({
    where: {
      id: input.contentItemId,
    },
    select: {
      id: true,
      platform: true,
      contentPack: {
        select: {
          campaignId: true,
        },
      },
      trackingLink: {
        select: {
          id: true,
        },
      },
      tenant: {
        select: {
          name: true,
          slug: true,
        },
      },
    },
  });

  if (!contentItem) {
    throw new ApiError(404, "NOT_FOUND", "Content item not found.");
  }

  if (contentItem.trackingLink) {
    throw new ApiError(
      409,
      "CONFLICT",
      "This content item already has a tracking link.",
    );
  }

  const campaignId = input.campaignId ?? contentItem.contentPack.campaignId ?? null;
  const slug = await generateUniqueSlug(
    contentItem.tenant.slug,
    contentItem.platform,
  );
  const utmSource = input.utmSource ?? contentItem.platform.toLowerCase();
  const utmMedium = input.utmMedium ?? "social";
  const utmCampaign =
    input.utmCampaign ??
    normalizeSlugPart(contentItem.tenant.name).replace(/-/g, "_");
  const created = await prisma.trackingLink.create({
    data: {
      tenantId: tenantContext.tenantId,
      contentItemId: input.contentItemId,
      campaignId,
      platform: contentItem.platform,
      slug,
      targetUrl: targetUrl.toString(),
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent: input.utmContent ?? null,
      botFilterEnabled: input.botFilterEnabled ?? true,
    },
    select: {
      id: true,
      slug: true,
      platform: true,
      targetUrl: true,
      utmSource: true,
      utmMedium: true,
      utmCampaign: true,
      utmContent: true,
      campaignId: true,
      contentItemId: true,
      botFilterEnabled: true,
    },
  });

  return {
    ...created,
    resolvedUrl: appendServerUtms(created),
  };
}

export async function resolveTrackingAttributionBySlug(slug: string) {
  const normalizedSlug = slug.trim();

  if (!normalizedSlug) {
    throw new ApiError(400, "VALIDATION", "Tracking slug is required.");
  }

  const prisma = getPrismaClient();
  const trackingLink = await prisma.trackingLink.findUnique({
    where: { slug: normalizedSlug },
    select: {
      id: true,
      tenantId: true,
      campaignId: true,
      contentItemId: true,
      platform: true,
      slug: true,
      targetUrl: true,
      utmSource: true,
      utmMedium: true,
      utmCampaign: true,
      utmContent: true,
      botFilterEnabled: true,
    },
  });

  if (!trackingLink) {
    throw new ApiError(404, "NOT_FOUND", "Tracking link not found.");
  }

  return {
    trackingLinkId: trackingLink.id,
    tenantId: trackingLink.tenantId,
    campaignId: trackingLink.campaignId,
    contentItemId: trackingLink.contentItemId,
    platform: trackingLink.platform,
    slug: trackingLink.slug,
    targetUrl: trackingLink.targetUrl,
    utmSource: trackingLink.utmSource,
    utmMedium: trackingLink.utmMedium,
    utmCampaign: trackingLink.utmCampaign,
    utmContent: trackingLink.utmContent,
    botFilterEnabled: trackingLink.botFilterEnabled,
    resolvedUrl: appendServerUtms(trackingLink),
  } satisfies TrackingAttribution;
}

export function isBotUserAgent(userAgent: string | null | undefined) {
  if (!userAgent) {
    return false;
  }

  return BOT_USER_AGENT_PATTERN.test(userAgent);
}

export async function recordClickEvent(input: RecordClickEventInput) {
  const tracking = await resolveTrackingAttributionBySlug(input.slug);
  const prisma = getPrismaClient();
  const isBot =
    tracking.botFilterEnabled && isBotUserAgent(input.userAgent ?? null);
  const clickEvent = await prisma.clickEvent.create({
    data: {
      tenantId: tracking.tenantId,
      trackingLinkId: tracking.trackingLinkId,
      campaignId: tracking.campaignId,
      contentItemId: tracking.contentItemId,
      platform: tracking.platform,
      visitorIp: input.visitorIp ?? null,
      userAgent: input.userAgent ?? null,
      referer: input.referer ?? null,
      queryString: input.queryString ?? null,
      isBot,
    },
    select: {
      id: true,
      isBot: true,
      campaignId: true,
      contentItemId: true,
      platform: true,
    },
  });

  return {
    tracking,
    clickEvent,
  };
}

export function getVisitorIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for");

  if (!forwarded) {
    return null;
  }

  return forwarded.split(",")[0]?.trim() || null;
}
