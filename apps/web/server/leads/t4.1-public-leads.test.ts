import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Platform } from "@prisma/client";
import { POST as submitPublicLeadFormPOST } from "@/app/api/public/leads/form/route";
import { getPrismaClient } from "@/server/db/prisma";
import type { TenantContext } from "@/server/db/tenant-context";
import { createTrackingLink } from "@/server/tracking/service";
import { resetPublicLeadRateLimitState } from "@/server/leads/rate-limit";

const prisma = getPrismaClient();

let tenantContext: TenantContext;
let tenantSlug = "";
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
      tenant: {
        select: {
          slug: true,
        },
      },
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

  if (!membership || !contentPack) {
    throw new Error(
      "Seed data missing. Run `npm run prisma:seed` before T4.1 lead tests.",
    );
  }

  tenantContext = membership;
  tenantSlug = membership.tenant.slug;
  contentPackId = contentPack.id;
});

beforeEach(() => {
  resetPublicLeadRateLimitState();
});

describe("T4.1 public lead form", () => {
  it("creates lead and inquiry with tracking attribution from a public form submission", async () => {
    const contentItem = await prisma.contentItem.create({
      data: {
        tenantId: tenantContext.tenantId,
        contentPackId,
        ownerUserId: tenantContext.userId,
        platform: Platform.LINKEDIN,
        locale: "EN",
        mediaType: "IMAGE",
        title: `Lead form tracking ${Date.now()}`,
        body: "Public lead form attribution test",
        spec: {
          ratio: "1.91:1",
        },
        publishStatus: "PENDING",
      },
      select: {
        id: true,
      },
    });
    const trackingLink = await createTrackingLink(tenantContext, {
      contentItemId: contentItem.id,
      targetUrl: "https://example.com/products/ts-75",
      utmCampaign: `lead-form-${Date.now()}`,
      utmContent: "hero-form",
    });

    const response = await submitPublicLeadFormPOST(
      new Request("http://localhost:3100/api/public/leads/form", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.24",
        },
        body: JSON.stringify({
          tenantSlug,
          trackingSlug: trackingLink.slug,
          fields: {
            companyName: "Al Noor Trading",
            name: "Hassan Ali",
            email: `buyer-${Date.now()}@example.com`,
            phone: "+971 50 000 0000",
            country: "UAE",
            preferredLocale: "en",
            subject: "TS-75 inquiry",
            message: "Need MOQ, lead time, and distributor pricing.",
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.leadId).toEqual(expect.any(String));
    expect(payload.inquiryId).toEqual(expect.any(String));
    expect(payload.reused).toBe(false);

    const lead = await prisma.lead.findUniqueOrThrow({
      where: {
        id: payload.leadId,
      },
      select: {
        trackingLinkId: true,
        sourceContentItemId: true,
        campaignId: true,
        companyName: true,
        country: true,
        preferredLocale: true,
        inquiries: {
          select: {
            id: true,
            sourceType: true,
            subject: true,
            body: true,
            fromEmail: true,
            fromName: true,
          },
        },
      },
    });

    expect(lead).toMatchObject({
      trackingLinkId: trackingLink.id,
      sourceContentItemId: contentItem.id,
      campaignId: trackingLink.campaignId,
      companyName: "Al Noor Trading",
      country: "UAE",
      preferredLocale: "EN",
    });
    expect(lead.inquiries).toHaveLength(1);
    expect(lead.inquiries[0]).toMatchObject({
      id: payload.inquiryId,
      sourceType: "FORM",
      subject: "TS-75 inquiry",
      body: "Need MOQ, lead time, and distributor pricing.",
      fromEmail: expect.stringContaining("@example.com"),
      fromName: "Hassan Ali",
    });
  });

  it("reuses the same lead for idempotent public form retries", async () => {
    const contentItem = await prisma.contentItem.create({
      data: {
        tenantId: tenantContext.tenantId,
        contentPackId,
        ownerUserId: tenantContext.userId,
        platform: Platform.INSTAGRAM,
        locale: "EN",
        mediaType: "IMAGE",
        title: `Lead form dedupe ${Date.now()}`,
        body: "Public lead form dedupe test",
        spec: {
          ratio: "4:5",
        },
        publishStatus: "PENDING",
      },
      select: {
        id: true,
      },
    });
    const trackingLink = await createTrackingLink(tenantContext, {
      contentItemId: contentItem.id,
      targetUrl: "https://example.com/catalog",
      utmCampaign: `lead-dedupe-${Date.now()}`,
      utmContent: "catalog-form",
    });
    const email = `dedupe-${Date.now()}@example.com`;
    const body = JSON.stringify({
      tenantSlug,
      trackingSlug: trackingLink.slug,
      fields: {
        companyName: "Rimal Equipment",
        name: "Mina Saleh",
        email,
        subject: "Need distributor terms",
        message: "Please share your distributor policy and latest price list.",
      },
    });
    const headers = {
      "content-type": "application/json",
      "idempotency-key": `public-form-${Date.now()}`,
      "x-forwarded-for": "198.51.100.25",
    };

    const first = await submitPublicLeadFormPOST(
      new Request("http://localhost:3100/api/public/leads/form", {
        method: "POST",
        headers,
        body,
      }),
    );
    const second = await submitPublicLeadFormPOST(
      new Request("http://localhost:3100/api/public/leads/form", {
        method: "POST",
        headers,
        body,
      }),
    );
    const firstPayload = await first.json();
    const secondPayload = await second.json();

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(secondPayload.leadId).toBe(firstPayload.leadId);
    expect(secondPayload.reused).toBe(true);

    const leadCount = await prisma.lead.count({
      where: {
        tenantId: tenantContext.tenantId,
        trackingLinkId: trackingLink.id,
        contact: {
          email,
        },
      },
    });
    const inquiryCount = await prisma.inquiry.count({
      where: {
        tenantId: tenantContext.tenantId,
        leadId: firstPayload.leadId,
        sourceType: "FORM",
      },
    });

    expect(leadCount).toBe(1);
    expect(inquiryCount).toBe(1);
  });

  it("returns 429 after the public form rate limit is exceeded for the same IP", async () => {
    const emailBase = `ratelimit-${Date.now()}`;
    let lastResponse: Response | null = null;

    for (let attempt = 0; attempt < 31; attempt += 1) {
      lastResponse = await submitPublicLeadFormPOST(
        new Request("http://localhost:3100/api/public/leads/form", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "198.51.100.26",
            "idempotency-key": `ratelimit-${attempt}`,
          },
          body: JSON.stringify({
            tenantSlug,
            fields: {
              email: `${emailBase}-${attempt}@example.com`,
              message: `rate limit probe ${attempt}`,
            },
          }),
        }),
      );
    }

    expect(lastResponse?.status).toBe(429);

    const payload = await lastResponse!.json();

    expect(payload.error.code).toBe("RATE_LIMITED");
    expect(payload.error.details.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
