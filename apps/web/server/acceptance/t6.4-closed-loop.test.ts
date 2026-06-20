import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  MediaType,
  Platform,
  Prisma,
  PublishStatus,
  SiteStatus,
} from "@prisma/client";
import { GET as probeLeadsGET } from "@/app/api/_probe/leads/route";
import { resolveTaskHref } from "@/app/_components/hitl-meta";
import { GET as trackingRedirectGET } from "@/app/t/[slug]/route";
import { getPrismaClient } from "@/server/db/prisma";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import { resolveTenantContext, type TenantContext } from "@/server/db/tenant-context";
import { getDashboardSummary } from "@/server/dashboard/service";
import { submitPublicLeadForm } from "@/server/leads/service";
import { requestReplyDraft } from "@/server/replies/service";
import {
  approveHitlTask,
  getPublicSiteLocalePageData,
  listHitlTasks,
  requestSitePublish,
} from "@/server/sites/service";

const prisma = getPrismaClient();

const ACCEPTANCE_CONTENT_TEMPLATES = [
  { platform: Platform.LINKEDIN, mediaType: MediaType.IMAGE, ratio: "1.91:1" },
  { platform: Platform.FACEBOOK, mediaType: MediaType.IMAGE, ratio: "1:1" },
  { platform: Platform.INSTAGRAM, mediaType: MediaType.IMAGE, ratio: "4:5" },
  { platform: Platform.REELS, mediaType: MediaType.VIDEO_SCRIPT, ratio: "9:16" },
  { platform: Platform.TIKTOK, mediaType: MediaType.VIDEO_SCRIPT, ratio: "9:16" },
  { platform: Platform.YOUTUBE, mediaType: MediaType.VIDEO_SCRIPT, ratio: "16:9" },
  { platform: Platform.SHORTS, mediaType: MediaType.VIDEO_SCRIPT, ratio: "9:16" },
  { platform: Platform.VK_CLIPS, mediaType: MediaType.VIDEO_SCRIPT, ratio: "9:16" },
  { platform: Platform.RUTUBE, mediaType: MediaType.VIDEO_SCRIPT, ratio: "16:9" },
] as const;

let ownerContext: TenantContext;
let salesContext: TenantContext;
let tenantAId = "";
let tenantBId = "";
let tenantSlug = "";
let seedLeadId = "";
let seedSiteTemplate: Awaited<ReturnType<typeof loadSeedSiteTemplate>>;
let seedCampaignId: string | null = null;

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
                "Thanks for your inquiry. We can share the distributor proposal after confirming your market rollout plan and expected monthly volume.",
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

async function loadSeedSiteTemplate() {
  const site = await prisma.siteProject.findFirst({
    where: {
      tenant: {
        slug: "shenghai-machinery",
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      name: true,
      market: true,
      product: true,
      style: true,
      cta: true,
      defaultLocale: true,
      pages: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
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
          locale: true,
          direction: true,
          translatedContent: true,
          seoTitle: true,
          seoDescription: true,
          geoMetadata: true,
        },
      },
      currentVersion: {
        select: {
          snapshot: true,
          note: true,
        },
      },
    },
  });

  if (!site || !site.currentVersion) {
    throw new Error("Seeded site template missing for T6.4 acceptance test.");
  }

  return site;
}

beforeAll(async () => {
  process.env.OPENAI_BASE_URL = "https://mock.openai.test/v1";
  process.env.OPENAI_MODEL = "gpt-4.1-mini";
  process.env.LOCAL_QWEN_BASE_URL = "https://mock.local-qwen.test/v1";
  process.env.LOCAL_QWEN_MODEL = "qwen-mock";
  process.env.LOCAL_BGE_BASE_URL = "https://mock.local-bge.test/v1";
  process.env.LOCAL_BGE_MODEL = "bge-mock";
  process.env.OPENAI_API_KEY = "openai-test-key";

  const [
    ownerMembership,
    salesMembership,
    tenantA,
    tenantB,
    seedLead,
    siteTemplate,
    seedCampaign,
  ] = await Promise.all([
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
    prisma.tenant.findUnique({
      where: {
        slug: "shenghai-machinery",
      },
      select: {
        id: true,
        slug: true,
      },
    }),
    prisma.tenant.findUnique({
      where: {
        slug: "control-company",
      },
      select: {
        id: true,
      },
    }),
    prisma.lead.findFirst({
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
    loadSeedSiteTemplate(),
    prisma.campaign.findFirst({
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
  ]);

  if (!ownerMembership || !salesMembership || !tenantA || !tenantB || !seedLead) {
    throw new Error("Seed data missing. Run `npm run prisma:seed` before T6.4.");
  }

  ownerContext = ownerMembership;
  salesContext = salesMembership;
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;
  tenantSlug = tenantA.slug;
  seedLeadId = seedLead.id;
  seedSiteTemplate = siteTemplate;
  seedCampaignId = seedCampaign?.id ?? null;
});

describe("T6.4 four-role closed-loop acceptance", () => {
  it("passes the 18-step Middle East acquisition script end to end", async () => {
    const tag = `t64-${Date.now()}`;

    // 1. 初始化租户 A/B -> R1 全绿
    const deniedResponse = await probeLeadsGET(
      new Request(`http://localhost:3100/api/_probe/leads`, {
        headers: {
          "x-tenant-id": tenantAId,
          "x-user-email": "sales-b@tradepilot.local",
        },
      }) as never,
    );
    expect(deniedResponse.status).toBe(403);

    const hiddenResponse = await probeLeadsGET(
      new Request(`http://localhost:3100/api/_probe/leads?leadId=${seedLeadId}`, {
        headers: {
          "x-tenant-id": tenantBId,
          "x-user-email": "sales-b@tradepilot.local",
        },
      }) as never,
    );
    expect(hiddenResponse.status).toBe(404);

    const tenantBContext = await resolveTenantContext(
      new Headers({
        "x-tenant-id": tenantBId,
        "x-user-email": "sales-b@tradepilot.local",
      }),
    );
    const tenantBChunks = await getTenantPrisma(tenantBContext).knowledgeChunk.findMany({
      where: {
        text: {
          contains: "7.5 bar pressure",
        },
      },
      select: {
        id: true,
      },
    });
    expect(tenantBChunks).toEqual([]);

    // 2-4. 文档、审核、向量隔离
    const [documents, reviews, chunks] = await Promise.all([
      prisma.knowledgeDocument.findMany({
        where: {
          tenantId: ownerContext.tenantId,
        },
        select: {
          title: true,
          sensitivity: true,
          status: true,
        },
      }),
      prisma.knowledgeReview.findMany({
        where: {
          tenantId: ownerContext.tenantId,
        },
        select: {
          status: true,
          sensitivity: true,
        },
      }),
      prisma.knowledgeChunk.findMany({
        where: {
          tenantId: ownerContext.tenantId,
        },
        select: {
          namespace: true,
          sensitivity: true,
          text: true,
        },
      }),
    ]);

    expect(documents.some((item) => item.title === "Air Compressor Product Manual")).toBe(true);
    expect(documents.some((item) => item.title === "Internal Quotation Sheet")).toBe(true);
    expect(reviews.some((item) => item.status === "APPROVED" && item.sensitivity === "PUBLIC")).toBe(true);
    expect(
      reviews.some(
        (item) => item.status === "APPROVED" && item.sensitivity === "INTERNAL_ONLY",
      ),
    ).toBe(true);
    expect(
      chunks.every((item) => item.namespace === `tenant:${ownerContext.tenantId}`),
    ).toBe(true);

    // 5-7. 生成多语站点、预览 EN/AR/RU、走 HITL 上线
    const siteProject = await prisma.siteProject.create({
      data: {
        tenantId: ownerContext.tenantId,
        createdByUserId: ownerContext.userId,
        name: `${seedSiteTemplate.name} ${tag}`,
        slug: `${tag}-site`,
        market: seedSiteTemplate.market,
        product: seedSiteTemplate.product,
        style: seedSiteTemplate.style,
        cta: seedSiteTemplate.cta,
        defaultLocale: seedSiteTemplate.defaultLocale,
        status: SiteStatus.DRAFT,
      },
      select: {
        id: true,
        slug: true,
      },
    });
    const siteVersion = await prisma.siteVersion.create({
      data: {
        tenantId: ownerContext.tenantId,
        siteProjectId: siteProject.id,
        createdByUserId: ownerContext.userId,
        versionNumber: 1,
        snapshot: seedSiteTemplate.currentVersion!.snapshot as Prisma.InputJsonValue,
        note: `${seedSiteTemplate.currentVersion!.note ?? "Acceptance clone"} ${tag}`,
      },
      select: {
        id: true,
      },
    });
    await prisma.siteProject.update({
      where: {
        id: siteProject.id,
      },
      data: {
        currentVersionId: siteVersion.id,
      },
    });
    for (const page of seedSiteTemplate.pages) {
      await prisma.sitePage.create({
        data: {
          tenantId: ownerContext.tenantId,
          siteProjectId: siteProject.id,
          pageType: page.pageType,
          title: page.title,
          slug: page.slug,
          isHomepage: page.isHomepage,
          content: page.content as Prisma.InputJsonValue,
        },
      });
    }
    for (const locale of seedSiteTemplate.locales) {
      await prisma.siteLocale.create({
        data: {
          tenantId: ownerContext.tenantId,
          siteProjectId: siteProject.id,
          locale: locale.locale,
          direction: locale.direction,
          urlPath: `/site/${siteProject.slug}/${locale.locale.toLowerCase()}`,
          translatedContent: locale.translatedContent as Prisma.InputJsonValue,
          seoTitle: locale.seoTitle,
          seoDescription: locale.seoDescription,
          geoMetadata: locale.geoMetadata as Prisma.InputJsonValue,
          publishStatus: PublishStatus.PENDING,
        },
      });
    }

    const [previewEn, previewAr, previewRu] = await Promise.all([
      getPublicSiteLocalePageData({
        slug: siteProject.slug,
        locale: "en",
        allowDraft: true,
      }),
      getPublicSiteLocalePageData({
        slug: siteProject.slug,
        locale: "ar",
        allowDraft: true,
      }),
      getPublicSiteLocalePageData({
        slug: siteProject.slug,
        locale: "ru",
        allowDraft: true,
      }),
    ]);

    expect(previewEn.locale.translatedContent.headline).toBeTruthy();
    expect(previewAr.locale.direction).toBe("rtl");
    expect(previewRu.locale.translatedContent.headline).toBeTruthy();
    expect(JSON.stringify(previewEn.locale.translatedContent)).not.toContain(
      "Distributor floor price",
    );

    const sitePublish = await requestSitePublish({
      tenantContext: ownerContext,
      siteId: siteProject.id,
      requestedByUserId: ownerContext.userId,
    });
    const pendingSiteTasks = await listHitlTasks({
      tenantContext: ownerContext,
      status: "pending",
    });
    expect(
      pendingSiteTasks.items.some((item) => item.id === sitePublish.hitlTaskId),
    ).toBe(true);

    await approveHitlTask({
      tenantContext: ownerContext,
      hitlTaskId: sitePublish.hitlTaskId,
      approvedByUserId: ownerContext.userId,
    });

    const livePage = await getPublicSiteLocalePageData({
      slug: siteProject.slug,
      locale: "ar",
    });
    expect(livePage.project.status).toBe("published");
    expect(livePage.locale.direction).toBe("rtl");

    // 8-10. 生成 9 平台内容、追踪链接、手动标记已发
    const contentPack = await prisma.contentPack.create({
      data: {
        tenantId: ownerContext.tenantId,
        campaignId: seedCampaignId,
        createdByUserId: ownerContext.userId,
        title: `Middle East closed loop ${tag}`,
        topic: "Middle East distributor acquisition",
        market: "Middle East",
        locales: ["EN"] as Prisma.InputJsonValue,
        status: "READY",
      },
      select: {
        id: true,
      },
    });

    const clonedItems: Array<{
      id: string;
      title: string;
      platform: Platform;
      mediaType: MediaType;
      trackingSlug: string;
      trackingLinkId: string;
    }> = [];

    for (const [index, template] of ACCEPTANCE_CONTENT_TEMPLATES.entries()) {
      const createdItem = await prisma.contentItem.create({
        data: {
          tenantId: ownerContext.tenantId,
          contentPackId: contentPack.id,
          ownerUserId: salesContext.userId,
          platform: template.platform,
          locale: "EN",
          mediaType: template.mediaType,
          title: `${template.platform.toLowerCase()} distributor content ${tag}`,
          body: `Acceptance content item ${index + 1} for ${template.platform}.\nAcceptance run ${tag}.`,
          spec: {
            ratio: template.ratio,
            exportChecklist: true,
          } as Prisma.InputJsonValue,
          publishStatus: index === 0 ? PublishStatus.PUBLISHED : PublishStatus.PENDING,
          publishedAt: index === 0 ? new Date() : null,
          plannedAt: new Date(Date.now() + index * 3_600_000),
        },
        select: {
          id: true,
          title: true,
          platform: true,
          mediaType: true,
        },
      });
      const tracking = await prisma.trackingLink.create({
        data: {
          tenantId: ownerContext.tenantId,
          campaignId: seedCampaignId,
          contentItemId: createdItem.id,
          platform: template.platform,
          slug: `${tag}-${template.platform.toLowerCase()}-${index + 1}`,
          targetUrl: `https://tradepilot.local/${siteProject.slug}`,
          utmSource: template.platform.toLowerCase(),
          utmMedium: "social",
          utmCampaign: `campaign-${tag}`,
          utmContent: `item-${index + 1}`,
        },
        select: {
          id: true,
          slug: true,
        },
      });

      clonedItems.push({
        id: createdItem.id,
        title: createdItem.title ?? `${createdItem.platform.toLowerCase()} ${tag}`,
        platform: createdItem.platform,
        mediaType: createdItem.mediaType,
        trackingSlug: tracking.slug,
        trackingLinkId: tracking.id,
      });
    }

    expect(clonedItems).toHaveLength(9);
    expect(
      clonedItems.filter((item) => item.mediaType === MediaType.VIDEO_SCRIPT).length,
    ).toBeGreaterThanOrEqual(5);
    expect(clonedItems.every((item) => item.trackingSlug.startsWith(tag))).toBe(true);

    // 11-14. 点击、表单询盘、归因、去重进管道
    const primaryItem = clonedItems[0]!;
    const clickResponse = await trackingRedirectGET(
      new Request(
        `http://localhost:3100/t/${primaryItem.trackingSlug}?utm_source=evil&utm_campaign=fake`,
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
          slug: primaryItem.trackingSlug,
        }),
      } as never,
    );
    expect(clickResponse.status).toBe(302);
    expect(clickResponse.headers.get("location")).toContain("utm_source=linkedin");

    const clickEvent = await prisma.clickEvent.findFirstOrThrow({
      where: {
        trackingLinkId: primaryItem.trackingLinkId,
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
    expect(clickEvent.contentItemId).toBe(primaryItem.id);
    expect(clickEvent.trackingLinkId).toBe(primaryItem.trackingLinkId);

    const leadEmail = `${tag}@example.com`;
    const firstForm = await submitPublicLeadForm({
      input: {
        tenantSlug,
        trackingSlug: primaryItem.trackingSlug,
        fields: {
          companyName: "T6.4 Closed Loop Buyer",
          name: "Omar Zahid",
          email: leadEmail,
          phone: "+971500000999",
          country: "UAE",
          subject: "Need distributor quote",
          message:
            "Please share distributor pricing, MOQ and delivery timing for UAE.",
          preferredLocale: "en",
        },
      },
      idempotencyKey: `${tag}-form`,
    });
    const secondForm = await submitPublicLeadForm({
      input: {
        tenantSlug,
        trackingSlug: primaryItem.trackingSlug,
        fields: {
          companyName: "T6.4 Closed Loop Buyer",
          name: "Omar Zahid",
          email: leadEmail,
          phone: "+971500000999",
          country: "UAE",
          subject: "Need distributor quote",
          message:
            "Please share distributor pricing, MOQ and delivery timing for UAE.",
          preferredLocale: "en",
        },
      },
      idempotencyKey: `${tag}-form`,
    });

    expect(firstForm.reused).toBe(false);
    expect(secondForm.reused).toBe(true);
    expect(secondForm.leadId).toBe(firstForm.leadId);

    await prisma.lead.update({
      where: {
        id: firstForm.leadId,
      },
      data: {
        ownerUserId: salesContext.userId,
      },
    });

    const lead = await prisma.lead.findUniqueOrThrow({
      where: {
        id: firstForm.leadId,
      },
      select: {
        sourceContentItemId: true,
        trackingLinkId: true,
        ownerUserId: true,
        score: true,
      },
    });
    expect(lead.sourceContentItemId).toBe(primaryItem.id);
    expect(lead.trackingLinkId).toBe(primaryItem.trackingLinkId);
    expect(lead.ownerUserId).toBe(salesContext.userId);
    expect(lead.score).toBeTruthy();

    // 15-16. 本地 Qwen 首响、审批发送
    const fetchMock = createLocalReplyFetchMock();
    const drafted = await requestReplyDraft({
      tenantContext: salesContext,
      requestedByUserId: salesContext.userId,
      input: {
        inquiryId: firstForm.inquiryId,
      },
      fetchImpl: fetchMock,
    });

    const pendingReply = await prisma.reply.findUniqueOrThrow({
      where: {
        id: drafted.replyId,
      },
      select: {
        status: true,
        route: true,
        sentAt: true,
      },
    });
    expect(pendingReply.status).toBe("PENDING_APPROVAL");
    expect(pendingReply.route).toBe("LOCAL_QWEN");
    expect(pendingReply.sentAt).toBeNull();

    await approveHitlTask({
      tenantContext: salesContext,
      hitlTaskId: drafted.hitlTaskId,
      approvedByUserId: salesContext.userId,
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

    // 17-18. dashboard 归因 + 工作台下钻
    const summary = await getDashboardSummary({
      tenantContext: ownerContext,
      range: "week",
    });
    expect(
      summary.sourceAttribution.some(
        (item) =>
          item.platform === "linkedin" &&
          item.content.includes(tag) &&
          item.count >= 1,
      ),
    ).toBe(true);
    expect(summary.replyMedianMinutes).toBeGreaterThanOrEqual(0);

    expect(
      resolveTaskHref({
        type: "site_publish",
        entityId: siteProject.id,
        payload: {
          siteId: siteProject.id,
        },
      }),
    ).toBe(`/sites?siteId=${siteProject.id}`);
    expect(
      resolveTaskHref({
        type: "content_publish",
        entityId: primaryItem.id,
        payload: {},
      }),
    ).toBe(`/design?itemId=${primaryItem.id}`);
    expect(
      resolveTaskHref({
        type: "reply_send",
        entityId: drafted.replyId,
        payload: {
          inquiryId: firstForm.inquiryId,
        },
      }),
    ).toBe(`/crm?inquiryId=${firstForm.inquiryId}`);
  });
});
