import { beforeAll, describe, expect, it, vi } from "vitest";
import { MediaType, Platform, PublishStatus } from "@prisma/client";
import { GET as trackingRedirectGET } from "@/app/t/[slug]/route";
import { resolveTaskHref } from "@/app/_components/hitl-meta";
import { requestContentItemPublish } from "@/server/content-packs/service";
import { getDashboardSummary } from "@/server/dashboard/service";
import { getPrismaClient } from "@/server/db/prisma";
import type { TenantContext } from "@/server/db/tenant-context";
import { submitPublicLeadForm } from "@/server/leads/service";
import { listNotifications } from "@/server/notifications/service";
import { requestReplyDraft } from "@/server/replies/service";
import {
  getPublicSiteLocalePageData,
  requestSitePublish,
} from "@/server/sites/service";
import { approveHitlTask } from "@/server/sites/service";

const prisma = getPrismaClient();

let ownerContext: TenantContext;
let salesContext: TenantContext;
let contentPackId = "";
let tenantSlug = "";
let siteSlug = "";
let trackingSlug = "";
let trackingLinkId = "";
let contentItemId = "";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createLocalReplyFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;

    if (url.startsWith(process.env.LOCAL_BGE_BASE_URL!)) {
      return jsonResponse({
        model: process.env.LOCAL_BGE_MODEL,
        data: [
          {
            embedding: Array.from({ length: 1024 }, (_, index) =>
              Number((((index % 11) + 1) / 100).toFixed(4)),
            ),
          },
        ],
        usage: {
          prompt_tokens: 12,
        },
      });
    }

    if (url.startsWith(process.env.LOCAL_QWEN_BASE_URL!)) {
      const isClassifierCall =
        typeof body === "object" &&
        body !== null &&
        "messages" in body &&
        Array.isArray(body.messages) &&
        typeof body.messages[0]?.content === "string" &&
        body.messages[0].content.includes("Classify whether");

      if (isClassifierCall) {
        return jsonResponse({
          model: process.env.LOCAL_QWEN_MODEL,
          choices: [
            {
              message: {
                content: JSON.stringify({
                  containsPii: true,
                  reason: "reply_inquiry_contains_customer_context",
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 18,
            completion_tokens: 6,
          },
        });
      }

      return jsonResponse({
        model: process.env.LOCAL_QWEN_MODEL,
        choices: [
          {
            message: {
              content:
                "Thanks for your inquiry. We can share the detailed distributor proposal after confirming your volume and market plan.",
            },
          },
        ],
        usage: {
          prompt_tokens: 25,
          completion_tokens: 18,
        },
      });
    }

    if (url.startsWith(process.env.OPENAI_BASE_URL!)) {
      return jsonResponse({
        choices: [
          {
            message: {
              content: "OpenAI fallback should not happen",
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });
}

beforeAll(async () => {
  process.env.OPENAI_BASE_URL = "https://mock.openai.test/v1";
  process.env.OPENAI_MODEL = "gpt-4.1-mini";
  process.env.LOCAL_QWEN_BASE_URL = "https://mock.local-qwen.test/v1";
  process.env.LOCAL_QWEN_MODEL = "qwen-mock";
  process.env.LOCAL_BGE_BASE_URL = "https://mock.local-bge.test/v1";
  process.env.LOCAL_BGE_MODEL = "bge-mock";
  process.env.OPENAI_API_KEY = "openai-test-key";

  const [ownerMembership, salesMembership, contentPack, tenant, site, tracking] =
    await Promise.all([
    prisma.membership.findFirst({
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
    }),
    prisma.membership.findFirst({
      where: {
        tenant: {
          slug: "shenghai-machinery",
        },
        user: {
          email: "sales-a@tradepilot.local",
        },
        status: "ACTIVE",
      },
      select: {
        tenantId: true,
        userId: true,
        role: true,
      },
    }),
    prisma.contentPack.findFirst({
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
    }),
    prisma.tenant.findUnique({
      where: {
        slug: "shenghai-machinery",
      },
      select: {
        slug: true,
      },
    }),
    prisma.siteProject.findFirst({
      where: {
        tenant: {
          slug: "shenghai-machinery",
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        slug: true,
      },
    }),
    prisma.trackingLink.findFirst({
      where: {
        tenant: {
          slug: "shenghai-machinery",
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        slug: true,
        id: true,
        contentItemId: true,
      },
    }),
  ]);

  if (!ownerMembership || !salesMembership || !contentPack || !tenant || !site || !tracking) {
    throw new Error(
      "Seed data missing. Run `npm run prisma:seed` before T6.1/T6.2 tests.",
    );
  }

  ownerContext = ownerMembership;
  salesContext = salesMembership;
  contentPackId = contentPack.id;
  tenantSlug = tenant.slug;
  siteSlug = site.slug;
  trackingSlug = tracking.slug;
  trackingLinkId = tracking.id;
  contentItemId = tracking.contentItemId;
});

describe("T6.1 workspace + T6.2 notifications/hitl", () => {
  it("deduplicates content publish requests, exposes them in notifications, and approves through HITL", async () => {
    const item = await prisma.contentItem.create({
      data: {
        tenantId: ownerContext.tenantId,
        contentPackId,
        ownerUserId: salesContext.userId,
        platform: Platform.LINKEDIN,
        locale: "EN",
        mediaType: MediaType.IMAGE,
        title: `t6 content publish ${Date.now()}`,
        body: "Fresh publish request for T6 validation.",
        spec: {
          ratio: "1.91:1",
        },
        publishStatus: PublishStatus.PENDING,
      },
      select: {
        id: true,
      },
    });

    const requested = await requestContentItemPublish({
      tenantContext: ownerContext,
      itemId: item.id,
      requestedByUserId: ownerContext.userId,
    });
    const reused = await requestContentItemPublish({
      tenantContext: ownerContext,
      itemId: item.id,
      requestedByUserId: ownerContext.userId,
    });

    expect(requested.reused).toBe(false);
    expect(reused.reused).toBe(true);
    expect(reused.hitlTaskId).toBe(requested.hitlTaskId);

    const notifications = await listNotifications({
      tenantContext: ownerContext,
    });
    const pendingNotification = notifications.items.find(
      (entry) =>
        entry.type === "hitl_pending" &&
        entry.payload &&
        typeof entry.payload === "object" &&
        !Array.isArray(entry.payload) &&
        "hitlTaskId" in entry.payload &&
        entry.payload.hitlTaskId === requested.hitlTaskId,
    );

    expect(pendingNotification?.title).toBe("内容待审批");
    expect(pendingNotification?.linkUrl).toBe(`/design?itemId=${item.id}`);
    expect(notifications.unreadCount).toBeGreaterThanOrEqual(1);

    await approveHitlTask({
      tenantContext: ownerContext,
      hitlTaskId: requested.hitlTaskId,
      approvedByUserId: ownerContext.userId,
    });

    const [publishedItem, approvedTask] = await Promise.all([
      prisma.contentItem.findUniqueOrThrow({
        where: {
          id: item.id,
        },
        select: {
          publishStatus: true,
          publishedAt: true,
        },
      }),
      prisma.hitlTask.findUniqueOrThrow({
        where: {
          id: requested.hitlTaskId,
        },
        select: {
          status: true,
        },
      }),
    ]);

    expect(publishedItem.publishStatus).toBe(PublishStatus.PUBLISHED);
    expect(publishedItem.publishedAt).toBeTruthy();
    expect(approvedTask.status).toBe("APPROVED");
  });

  it("returns dashboard source attribution and drilldown routes for site, content, and reply tasks", async () => {
    const summary = await getDashboardSummary({
      tenantContext: ownerContext,
      range: "week",
    });

    expect(
      summary.sourceAttribution.some(
        (item) =>
          item.platform === "linkedin" &&
          item.content.includes("linkedin distributor content") &&
          item.count >= 1,
      ),
    ).toBe(true);

    expect(
      resolveTaskHref({
        type: "site_publish",
        entityId: "site-123",
        payload: {
          siteId: "site-123",
        },
      }),
    ).toBe("/sites?siteId=site-123");
    expect(
      resolveTaskHref({
        type: "content_publish",
        entityId: "content-123",
        payload: {},
      }),
    ).toBe("/design?itemId=content-123");
    expect(
      resolveTaskHref({
        type: "reply_send",
        entityId: "reply-123",
        payload: {
          inquiryId: "inq-123",
        },
      }),
    ).toBe("/replies");
  });

  it("covers the closed loop from publish approval to tracked inquiry, reply approval, and dashboard drilldown", async () => {
    const siteProject = await prisma.siteProject.findFirstOrThrow({
      where: {
        tenantId: ownerContext.tenantId,
        slug: siteSlug,
      },
      select: {
        id: true,
      },
    });
    const sitePublish = await requestSitePublish({
      tenantContext: ownerContext,
      siteId: siteProject.id,
      requestedByUserId: ownerContext.userId,
    });

    await approveHitlTask({
      tenantContext: ownerContext,
      hitlTaskId: sitePublish.hitlTaskId,
      approvedByUserId: ownerContext.userId,
    });

    const publicPage = await getPublicSiteLocalePageData({
      slug: siteSlug,
      locale: "en",
    });

    expect(publicPage.locale.translatedContent.headline).toBeTruthy();

    const clickResponse = await trackingRedirectGET(
      new Request(
        `http://localhost:3100/t/${trackingSlug}?utm_source=evil&utm_campaign=fake`,
        {
          headers: {
            "user-agent": "Mozilla/5.0",
            referer: "https://linkedin.com/feed/update",
            "x-forwarded-for": "203.0.113.10",
          },
        },
      ) as never,
      {
        params: Promise.resolve({
          slug: trackingSlug,
        }),
      } as never,
    );

    expect(clickResponse.status).toBe(302);
    expect(clickResponse.headers.get("location")).toContain("utm_source=linkedin");

    const clickEvent = await prisma.clickEvent.findFirstOrThrow({
      where: {
        trackingLinkId,
      },
      orderBy: {
        occurredAt: "desc",
      },
      select: {
        contentItemId: true,
        trackingLinkId: true,
        platform: true,
      },
    });

    expect(clickEvent.contentItemId).toBe(contentItemId);
    expect(clickEvent.trackingLinkId).toBe(trackingLinkId);

    const formResult = await submitPublicLeadForm({
      input: {
        tenantSlug,
        trackingSlug,
        fields: {
          companyName: "T6 Closed Loop Buyer",
          name: "Omar Zahid",
          email: `t6-loop-${Date.now()}@example.com`,
          phone: "+971500000999",
          country: "UAE",
          subject: "Need distributor quote",
          message:
            "Please share distributor pricing, MOQ and delivery timing for UAE.",
          preferredLocale: "en",
        },
      },
      idempotencyKey: `t6-loop-${Date.now()}`,
    });

    const lead = await prisma.lead.findUniqueOrThrow({
      where: {
        id: formResult.leadId,
      },
      select: {
        sourceContentItemId: true,
        trackingLinkId: true,
      },
    });

    expect(lead.sourceContentItemId).toBe(contentItemId);
    expect(lead.trackingLinkId).toBe(trackingLinkId);

    const fetchMock = createLocalReplyFetchMock();
    const drafted = await requestReplyDraft({
      tenantContext: ownerContext,
      requestedByUserId: ownerContext.userId,
      input: {
        inquiryId: formResult.inquiryId,
      },
      fetchImpl: fetchMock,
    });

    const beforeApprove = await getDashboardSummary({
      tenantContext: ownerContext,
      range: "week",
    });

    expect(
      beforeApprove.sourceAttribution.some(
        (item) =>
          item.platform === "linkedin" &&
          item.content.includes("linkedin distributor content") &&
          item.count >= 1,
      ),
    ).toBe(true);
    expect(
      beforeApprove.pendingHitl.some(
        (item) => item.type === "reply_send" && item.count >= 1,
      ),
    ).toBe(true);

    await approveHitlTask({
      tenantContext: ownerContext,
      hitlTaskId: drafted.hitlTaskId,
      approvedByUserId: ownerContext.userId,
    });

    const sentReply = await prisma.reply.findUniqueOrThrow({
      where: {
        id: drafted.replyId,
      },
      select: {
        status: true,
        sentAt: true,
      },
    });

    expect(sentReply.status).toBe("SENT");
    expect(sentReply.sentAt).toBeTruthy();

    const afterApprove = await getDashboardSummary({
      tenantContext: ownerContext,
      range: "week",
    });

    expect(afterApprove.replyMedianMinutes).toBeGreaterThanOrEqual(0);
    expect(resolveTaskHref({
      type: "reply_send",
      entityId: drafted.replyId,
      payload: {
        inquiryId: formResult.inquiryId,
      },
    })).toBe("/replies");
  });
});
