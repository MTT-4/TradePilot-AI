import { beforeAll, describe, expect, it } from "vitest";
import { Platform } from "@prisma/client";
import { GET as trackingRedirectGET } from "@/app/t/[slug]/route";
import { getPrismaClient } from "@/server/db/prisma";
import type { TenantContext } from "@/server/db/tenant-context";
import {
  createTrackingLink,
  resolveTrackingAttributionBySlug,
} from "@/server/tracking/service";

const prisma = getPrismaClient();

let tenantContextA: TenantContext;
let existingTrackingSlug = "";
let existingTrackingLinkId = "";
let existingCampaignId = "";
let existingContentItemId = "";
let existingPlatform: Platform;
let existingTargetUrl = "";
let existingUtmSource = "";
let existingUtmMedium = "";
let existingUtmCampaign = "";
let existingUtmContent = "";
let contentPackId = "";

beforeAll(async () => {
  const membership = await prisma.membership.findFirst({
    where: {
      tenant: {
        slug: "shenghai-machinery",
      },
      user: {
        email: "owner-a@tradepilot.local",
      },
      status: "ACTIVE",
    },
    select: {
      tenantId: true,
      userId: true,
      role: true,
    },
  });
  const firstTrackingLink = await prisma.trackingLink.findFirst({
    where: {
      tenant: {
        slug: "shenghai-machinery",
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      slug: true,
      campaignId: true,
      contentItemId: true,
      platform: true,
      targetUrl: true,
      utmSource: true,
      utmMedium: true,
      utmCampaign: true,
      utmContent: true,
    },
  });
  const contentPack = await prisma.contentPack.findFirst({
    where: {
      tenant: {
        slug: "shenghai-machinery",
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
    },
  });

  if (!membership || !firstTrackingLink || !contentPack) {
    throw new Error(
      "Seed data missing. Run `npm run prisma:seed` before T0.6 tracking tests.",
    );
  }

  tenantContextA = membership;
  existingTrackingSlug = firstTrackingLink.slug;
  existingTrackingLinkId = firstTrackingLink.id;
  existingCampaignId = firstTrackingLink.campaignId ?? "";
  existingContentItemId = firstTrackingLink.contentItemId;
  existingPlatform = firstTrackingLink.platform;
  existingTargetUrl = firstTrackingLink.targetUrl;
  existingUtmSource = firstTrackingLink.utmSource;
  existingUtmMedium = firstTrackingLink.utmMedium;
  existingUtmCampaign = firstTrackingLink.utmCampaign;
  existingUtmContent = firstTrackingLink.utmContent ?? "";
  contentPackId = contentPack.id;
});

describe("T0.6 tracking service", () => {
  it("creates a tracking link and resolves attribution", async () => {
    const contentItem = await prisma.contentItem.create({
      data: {
        tenantId: tenantContextA.tenantId,
        contentPackId,
        ownerUserId: tenantContextA.userId,
        platform: "LINKEDIN",
        locale: "EN",
        mediaType: "IMAGE",
        title: "tracking test content",
        body: "Tracking service creation probe",
        spec: {
          ratio: "1.91:1",
        },
        publishStatus: "PENDING",
      },
      select: {
        id: true,
      },
    });

    const trackingLink = await createTrackingLink(tenantContextA, {
      contentItemId: contentItem.id,
      targetUrl: "https://example.com/products/ts-75?foo=1",
      utmCampaign: "middle-east-ts-75",
      utmContent: "launch-post",
    });

    expect(trackingLink.slug).toMatch(/^shenghai-m-linkedin-[a-z0-9_-]+$/);
    expect(trackingLink.resolvedUrl).toContain("utm_source=linkedin");
    expect(trackingLink.resolvedUrl).toContain("utm_medium=social");
    expect(trackingLink.resolvedUrl).toContain("utm_campaign=middle-east-ts-75");
    expect(trackingLink.resolvedUrl).toContain("utm_content=launch-post");

    const attribution = await resolveTrackingAttributionBySlug(trackingLink.slug);

    expect(attribution).toMatchObject({
      trackingLinkId: trackingLink.id,
      contentItemId: contentItem.id,
      platform: "LINKEDIN",
      targetUrl: "https://example.com/products/ts-75?foo=1",
    });
  });

  it("R3.1 writes click_event from the server-side tracking link and redirects", async () => {
    const beforeCount = await prisma.clickEvent.count({
      where: {
        trackingLinkId: existingTrackingLinkId,
      },
    });

    const response = await trackingRedirectGET(
      new Request(`http://localhost:3100/t/${existingTrackingSlug}`, {
        headers: {
          "user-agent": "Mozilla/5.0",
          referer: "https://linkedin.com/feed/update",
          "x-forwarded-for": "203.0.113.9",
        },
      }) as never,
      {
        params: Promise.resolve({
          slug: existingTrackingSlug,
        }),
      } as never,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `${existingTargetUrl}?utm_source=${existingUtmSource}&utm_medium=${existingUtmMedium}&utm_campaign=${existingUtmCampaign}&utm_content=${existingUtmContent}`,
    );

    const afterCount = await prisma.clickEvent.count({
      where: {
        trackingLinkId: existingTrackingLinkId,
      },
    });

    expect(afterCount).toBe(beforeCount + 1);

    const latestClick = await prisma.clickEvent.findFirstOrThrow({
      where: {
        trackingLinkId: existingTrackingLinkId,
      },
      orderBy: {
        occurredAt: "desc",
      },
      select: {
        campaignId: true,
        contentItemId: true,
        platform: true,
        visitorIp: true,
        referer: true,
        isBot: true,
      },
    });

    expect(latestClick).toMatchObject({
      campaignId: existingCampaignId,
      contentItemId: existingContentItemId,
      platform: existingPlatform,
      visitorIp: "203.0.113.9",
      referer: "https://linkedin.com/feed/update",
      isBot: false,
    });
  });

  it("R3.2 ignores tampered UTM query params and keeps server attribution authoritative", async () => {
    const response = await trackingRedirectGET(
      new Request(
        `http://localhost:3100/t/${existingTrackingSlug}?utm_source=hacker&utm_campaign=fake&utm_medium=spam`,
        {
          headers: {
            "user-agent": "Mozilla/5.0",
          },
        },
      ) as never,
      {
        params: Promise.resolve({
          slug: existingTrackingSlug,
        }),
      } as never,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `${existingTargetUrl}?utm_source=${existingUtmSource}&utm_medium=${existingUtmMedium}&utm_campaign=${existingUtmCampaign}&utm_content=${existingUtmContent}`,
    );

    const latestClick = await prisma.clickEvent.findFirstOrThrow({
      where: {
        trackingLinkId: existingTrackingLinkId,
      },
      orderBy: {
        occurredAt: "desc",
      },
      select: {
        campaignId: true,
        contentItemId: true,
        platform: true,
        queryString: true,
      },
    });

    expect(latestClick).toMatchObject({
      campaignId: existingCampaignId,
      contentItemId: existingContentItemId,
      platform: existingPlatform,
      queryString: "utm_source=hacker&utm_campaign=fake&utm_medium=spam",
    });
  });
});
