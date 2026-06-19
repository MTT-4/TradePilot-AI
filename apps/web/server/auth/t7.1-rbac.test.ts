import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  MediaType,
  Platform,
  PublishStatus,
  SiteStatus,
  type Prisma,
} from "@prisma/client";
import { getPrismaClient } from "@/server/db/prisma";
import type { TenantContext } from "@/server/db/tenant-context";
import { requestContentItemPublish } from "@/server/content-packs/service";
import { requestReplyDraft } from "@/server/replies/service";
import {
  approveHitlTask,
  requestSitePublish,
} from "@/server/sites/service";

const prisma = getPrismaClient();

let ownerContext: TenantContext;
let salesContext: TenantContext;
let adminContext: TenantContext;
let operatorContext: TenantContext;
let viewerContext: TenantContext;
let seedSiteTemplate: Awaited<ReturnType<typeof loadSeedSiteTemplate>>;
let contentPackId = "";
let inquiryId = "";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createReplyFetchMock() {
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
        });
      }

      return jsonResponse({
        model: process.env.LOCAL_QWEN_MODEL,
        choices: [
          {
            message: {
              content:
                "Thanks for your inquiry. We can share the proposal after confirming your volume and target market.",
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
    throw new Error("Seed site template missing.");
  }

  return site;
}

async function createRoleMembership(params: {
  tenantId: string;
  role: "ADMIN" | "OPERATOR" | "VIEWER";
  email: string;
}) {
  const user = await prisma.user.create({
    data: {
      email: params.email,
      name: `${params.role} User`,
      passwordHash: `${params.role.toLowerCase()}-seed-hash`,
    },
    select: {
      id: true,
    },
  });

  return prisma.membership.create({
    data: {
      tenantId: params.tenantId,
      userId: user.id,
      role: params.role,
      status: "ACTIVE",
    },
    select: {
      tenantId: true,
      userId: true,
      role: true,
    },
  });
}

async function createSiteClone(tag: string) {
  const siteProject = await prisma.siteProject.create({
    data: {
      tenantId: ownerContext.tenantId,
      createdByUserId: ownerContext.userId,
      name: `RBAC site ${tag}`,
      slug: `rbac-site-${tag}`,
      market: seedSiteTemplate.market,
      product: seedSiteTemplate.product,
      style: seedSiteTemplate.style,
      cta: seedSiteTemplate.cta,
      defaultLocale: seedSiteTemplate.defaultLocale,
      status: SiteStatus.DRAFT,
    },
    select: {
      id: true,
    },
  });
  const siteVersion = await prisma.siteVersion.create({
    data: {
      tenantId: ownerContext.tenantId,
      siteProjectId: siteProject.id,
      createdByUserId: ownerContext.userId,
      versionNumber: 1,
      snapshot: seedSiteTemplate.currentVersion!.snapshot as Prisma.InputJsonValue,
      note: `${seedSiteTemplate.currentVersion!.note ?? "RBAC clone"} ${tag}`,
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
        slug: `${page.slug}-${tag}`.slice(0, 120),
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
        urlPath: `/site/rbac-site-${tag}/${locale.locale.toLowerCase()}`,
        translatedContent: locale.translatedContent as Prisma.InputJsonValue,
        seoTitle: locale.seoTitle,
        seoDescription: locale.seoDescription,
        geoMetadata: locale.geoMetadata as Prisma.InputJsonValue,
        publishStatus: PublishStatus.PENDING,
      },
    });
  }

  return siteProject.id;
}

beforeAll(async () => {
  process.env.LOCAL_QWEN_BASE_URL = "https://mock.local-qwen.test/v1";
  process.env.LOCAL_QWEN_MODEL = "qwen-mock";
  process.env.LOCAL_BGE_BASE_URL = "https://mock.local-bge.test/v1";
  process.env.LOCAL_BGE_MODEL = "bge-mock";

  const [ownerMembership, salesMembership, contentPack, inquiry, siteTemplate] =
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
      prisma.inquiry.findFirst({
        where: {
          tenant: {
            slug: "shenghai-machinery",
          },
          sourceType: "FORM",
        },
        orderBy: {
          createdAt: "asc",
        },
        select: {
          id: true,
        },
      }),
      loadSeedSiteTemplate(),
    ]);

  if (!ownerMembership || !salesMembership || !contentPack || !inquiry) {
    throw new Error("Seed data missing for T7.1 RBAC tests.");
  }

  ownerContext = ownerMembership;
  salesContext = salesMembership;
  contentPackId = contentPack.id;
  inquiryId = inquiry.id;
  seedSiteTemplate = siteTemplate;

  [adminContext, operatorContext, viewerContext] = await Promise.all([
    createRoleMembership({
      tenantId: ownerContext.tenantId,
      role: "ADMIN",
      email: `admin-${Date.now()}@tradepilot.local`,
    }),
    createRoleMembership({
      tenantId: ownerContext.tenantId,
      role: "OPERATOR",
      email: `operator-${Date.now()}@tradepilot.local`,
    }),
    createRoleMembership({
      tenantId: ownerContext.tenantId,
      role: "VIEWER",
      email: `viewer-rbac-${Date.now()}@tradepilot.local`,
    }),
  ]);
});

describe("T7.1 RBAC matrix", () => {
  it("allows only owner/admin to approve site publish tasks", async () => {
    const siteId = await createSiteClone(`${Date.now()}`);
    const task = await requestSitePublish({
      tenantContext: ownerContext,
      siteId,
      requestedByUserId: ownerContext.userId,
    });

    await expect(
      approveHitlTask({
        tenantContext: operatorContext,
        hitlTaskId: task.hitlTaskId,
        approvedByUserId: operatorContext.userId,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });

    const approved = await approveHitlTask({
      tenantContext: adminContext,
      hitlTaskId: task.hitlTaskId,
      approvedByUserId: adminContext.userId,
    });

    expect(approved.status).toBe("approved");
  });

  it("allows operator to approve content publish but blocks sales", async () => {
    const item = await prisma.contentItem.create({
      data: {
        tenantId: ownerContext.tenantId,
        contentPackId,
        ownerUserId: salesContext.userId,
        platform: Platform.LINKEDIN,
        locale: "EN",
        mediaType: MediaType.IMAGE,
        title: `rbac-content-${Date.now()}`,
        body: "RBAC content publish test",
        spec: {
          ratio: "1.91:1",
        },
        publishStatus: PublishStatus.PENDING,
      },
      select: {
        id: true,
      },
    });

    const task = await requestContentItemPublish({
      tenantContext: ownerContext,
      itemId: item.id,
      requestedByUserId: ownerContext.userId,
    });

    await expect(
      approveHitlTask({
        tenantContext: salesContext,
        hitlTaskId: task.hitlTaskId,
        approvedByUserId: salesContext.userId,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });

    const approved = await approveHitlTask({
      tenantContext: operatorContext,
      hitlTaskId: task.hitlTaskId,
      approvedByUserId: operatorContext.userId,
    });

    expect(approved.status).toBe("approved");
  });

  it("allows sales to approve reply send but blocks viewer", async () => {
    const drafted = await requestReplyDraft({
      tenantContext: salesContext,
      requestedByUserId: salesContext.userId,
      input: {
        inquiryId,
      },
      fetchImpl: createReplyFetchMock(),
    });

    await expect(
      approveHitlTask({
        tenantContext: viewerContext,
        hitlTaskId: drafted.hitlTaskId,
        approvedByUserId: viewerContext.userId,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });

    const approved = await approveHitlTask({
      tenantContext: salesContext,
      hitlTaskId: drafted.hitlTaskId,
      approvedByUserId: salesContext.userId,
    });

    expect(approved.status).toBe("approved");
  });
});
