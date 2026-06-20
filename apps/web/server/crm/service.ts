import {
  CrmActivityType,
  LeadStatus,
  OpportunityStage,
  Prisma,
  type MembershipRole,
} from "@prisma/client";
import { ZodError, z } from "zod";
import { ApiError } from "@/server/api/errors";
import { getPrismaClient } from "@/server/db/prisma";
import type { TenantContext } from "@/server/db/tenant-context";

const leadStatusSchema = z
  .enum(["new", "contacted", "following", "won", "lost"])
  .transform((value) => value.toUpperCase() as LeadStatus);

const opportunityStageSchema = z
  .enum(["new", "contacted", "quoted", "won", "lost"])
  .transform((value) => value.toUpperCase() as OpportunityStage);

const crmActivityTypeSchema = z
  .enum(["note", "stage_change", "follow_up", "email", "reply_sent"])
  .transform((value) => value.toUpperCase() as CrmActivityType);

export const listCrmLeadsFiltersSchema = z.object({
  score: z.enum(["a", "b", "c"]).optional(),
  status: z.enum(["new", "contacted", "following", "won", "lost"]).optional(),
  source: z.enum(["form", "email"]).optional(),
});

export const listCrmInquiriesFiltersSchema = z.object({
  leadId: z.string().min(1).optional(),
  source: z.enum(["form", "email"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const updateCrmLeadSchema = z.object({
  ownerUserId: z.string().min(1).nullable().optional(),
  status: z
    .enum(["new", "contacted", "following", "won", "lost"])
    .optional(),
  followUpDueAt: z.string().datetime().nullable().optional(),
});

export const listCrmOpportunitiesFiltersSchema = z.object({
  stage: z.enum(["new", "contacted", "quoted", "won", "lost"]).optional(),
});

export const listCrmActivitiesFiltersSchema = z
  .object({
    leadId: z.string().min(1).optional(),
    opportunityId: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine((value) => value.leadId || value.opportunityId, {
    message: "leadId or opportunityId is required.",
    path: ["leadId"],
  });

export const updateOpportunityStageSchema = z.object({
  stage: z.enum(["new", "contacted", "quoted", "won", "lost"]),
});

export const createCrmActivitySchema = z
  .object({
    leadId: z.string().min(1).optional(),
    opportunityId: z.string().min(1).optional(),
    type: z.enum(["note", "stage_change", "follow_up", "email", "reply_sent"]),
    body: z.string().trim().min(1).max(4000),
  })
  .refine((value) => value.leadId || value.opportunityId, {
    message: "leadId or opportunityId is required.",
    path: ["leadId"],
  });

type UpdateCrmLeadInput = z.infer<typeof updateCrmLeadSchema>;
type UpdateOpportunityStageInput = z.infer<typeof updateOpportunityStageSchema>;
type CreateCrmActivityInput = z.infer<typeof createCrmActivitySchema>;

function parseSchemaOrThrow<T>(schema: z.ZodType<T>, input: unknown) {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError(
        400,
        "VALIDATION",
        "Request body validation failed.",
        error.flatten(),
      );
    }

    throw error;
  }
}

function getSalesScopedLeadWhere(context: TenantContext) {
  return context.role === "SALES" ? { ownerUserId: context.userId } : {};
}

async function ensureAssignableOwner(params: {
  tenantId: string;
  ownerUserId: string | null | undefined;
  actorRole: MembershipRole;
  actorUserId: string;
}) {
  if (params.ownerUserId === undefined) {
    return undefined;
  }

  if (params.actorRole === "SALES" && params.ownerUserId !== params.actorUserId) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Sales users can only assign leads to themselves.",
    );
  }

  if (params.ownerUserId === null) {
    return null;
  }

  const prisma = getPrismaClient();
  const membership = await prisma.membership.findFirst({
    where: {
      tenantId: params.tenantId,
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

async function getAccessibleLeadOrThrow(params: {
  tenantContext: TenantContext;
  leadId: string;
}) {
  const prisma = getPrismaClient();
  const lead = await prisma.lead.findFirst({
    where: {
      id: params.leadId,
      tenantId: params.tenantContext.tenantId,
    },
    select: {
      id: true,
      ownerUserId: true,
      trackingLinkId: true,
      sourceContentItemId: true,
      campaignId: true,
    },
  });

  if (!lead) {
    throw new ApiError(404, "NOT_FOUND", "Lead not found.");
  }

  if (
    params.tenantContext.role === "SALES" &&
    lead.ownerUserId !== params.tenantContext.userId
  ) {
    throw new ApiError(403, "FORBIDDEN", "Sales users can only access their own leads.");
  }

  return lead;
}

async function getAccessibleOpportunityOrThrow(params: {
  tenantContext: TenantContext;
  opportunityId: string;
}) {
  const prisma = getPrismaClient();
  const opportunity = await prisma.opportunity.findFirst({
    where: {
      id: params.opportunityId,
      tenantId: params.tenantContext.tenantId,
    },
    select: {
      id: true,
      leadId: true,
      ownerUserId: true,
      stage: true,
      lead: {
        select: {
          ownerUserId: true,
        },
      },
    },
  });

  if (!opportunity) {
    throw new ApiError(404, "NOT_FOUND", "Opportunity not found.");
  }

  if (params.tenantContext.role === "SALES") {
    const ownedBySales =
      opportunity.ownerUserId === params.tenantContext.userId ||
      opportunity.lead.ownerUserId === params.tenantContext.userId;

    if (!ownedBySales) {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Sales users can only access their own opportunities.",
      );
    }
  }

  return opportunity;
}

export async function listCrmLeads(params: {
  tenantContext: TenantContext;
  filters?: unknown;
}) {
  const filters = parseSchemaOrThrow(listCrmLeadsFiltersSchema, params.filters ?? {});
  const prisma = getPrismaClient();
  const where: Prisma.LeadWhereInput = {
    tenantId: params.tenantContext.tenantId,
    ...getSalesScopedLeadWhere(params.tenantContext),
    ...(filters.score ? { score: filters.score.toUpperCase() as "A" | "B" | "C" } : {}),
    ...(filters.status
      ? { status: leadStatusSchema.parse(filters.status) }
      : {}),
    ...(filters.source
      ? {
          inquiries: {
            some: {
              sourceType: filters.source.toUpperCase() as "FORM" | "EMAIL",
            },
          },
        }
      : {}),
  };
  const leads = await prisma.lead.findMany({
    where,
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      ownerUserId: true,
      companyName: true,
      country: true,
      status: true,
      score: true,
      scoreReason: true,
      followUpDueAt: true,
      firstSeenAt: true,
      lastContactAt: true,
      trackingLinkId: true,
      sourceContentItemId: true,
      campaignId: true,
      contact: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          whatsapp: true,
        },
      },
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
          platform: true,
          utmSource: true,
          utmMedium: true,
          utmCampaign: true,
        },
      },
      sourceContentItem: {
        select: {
          id: true,
          title: true,
          platform: true,
        },
      },
      inquiries: {
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          sourceType: true,
          subject: true,
          createdAt: true,
        },
      },
    },
  });

  return {
    items: leads.map((lead) => ({
      id: lead.id,
      ownerUserId: lead.ownerUserId,
      companyName: lead.companyName,
      country: lead.country,
      status: lead.status.toLowerCase(),
      score: lead.score?.toLowerCase() ?? null,
      scoreReason: lead.scoreReason,
      followUpDueAt: lead.followUpDueAt?.toISOString() ?? null,
      firstSeenAt: lead.firstSeenAt.toISOString(),
      lastContactAt: lead.lastContactAt?.toISOString() ?? null,
      contact: lead.contact,
      owner: lead.owner,
      sourceAttribution: {
        campaignId: lead.campaignId,
        contentItemId: lead.sourceContentItemId,
        trackingLinkId: lead.trackingLinkId,
        platform: lead.trackingLink?.platform.toLowerCase() ?? lead.sourceContentItem?.platform.toLowerCase() ?? null,
        contentTitle: lead.sourceContentItem?.title ?? null,
        trackingSlug: lead.trackingLink?.slug ?? null,
        utmSource: lead.trackingLink?.utmSource ?? null,
        utmMedium: lead.trackingLink?.utmMedium ?? null,
        utmCampaign: lead.trackingLink?.utmCampaign ?? null,
      },
      latestInquiry: lead.inquiries[0]
        ? {
            id: lead.inquiries[0].id,
            sourceType: lead.inquiries[0].sourceType.toLowerCase(),
            subject: lead.inquiries[0].subject,
            createdAt: lead.inquiries[0].createdAt.toISOString(),
          }
        : null,
      inquiryCount: lead.inquiries.length,
    })),
  };
}

export async function getCrmLeadDetail(params: {
  tenantContext: TenantContext;
  leadId: string;
}) {
  await getAccessibleLeadOrThrow(params);
  const prisma = getPrismaClient();
  const lead = await prisma.lead.findFirstOrThrow({
    where: {
      id: params.leadId,
      tenantId: params.tenantContext.tenantId,
    },
    select: {
      id: true,
      ownerUserId: true,
      companyName: true,
      country: true,
      status: true,
      score: true,
      scoreReason: true,
      followUpDueAt: true,
      firstSeenAt: true,
      lastContactAt: true,
      trackingLinkId: true,
      sourceContentItemId: true,
      campaignId: true,
      contact: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          whatsapp: true,
          preferredLocale: true,
        },
      },
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
          platform: true,
          targetUrl: true,
          utmSource: true,
          utmMedium: true,
          utmCampaign: true,
          utmContent: true,
        },
      },
      sourceContentItem: {
        select: {
          id: true,
          title: true,
          body: true,
          platform: true,
        },
      },
      inquiries: {
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          sourceType: true,
          subject: true,
          body: true,
          fromEmail: true,
          fromName: true,
          createdAt: true,
        },
      },
      opportunities: {
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          name: true,
          stage: true,
          valueAmount: true,
          currency: true,
          followUpDueAt: true,
        },
      },
    },
  });

  return {
    lead: {
      id: lead.id,
      ownerUserId: lead.ownerUserId,
      companyName: lead.companyName,
      country: lead.country,
      status: lead.status.toLowerCase(),
      score: lead.score?.toLowerCase() ?? null,
      scoreReason: lead.scoreReason,
      followUpDueAt: lead.followUpDueAt?.toISOString() ?? null,
      firstSeenAt: lead.firstSeenAt.toISOString(),
      lastContactAt: lead.lastContactAt?.toISOString() ?? null,
      contact: lead.contact,
      owner: lead.owner,
      sourceAttribution: {
        campaignId: lead.campaignId,
        contentItemId: lead.sourceContentItemId,
        trackingLinkId: lead.trackingLinkId,
        platform: lead.trackingLink?.platform.toLowerCase() ?? lead.sourceContentItem?.platform.toLowerCase() ?? null,
        contentTitle: lead.sourceContentItem?.title ?? null,
        contentBody: lead.sourceContentItem?.body ?? null,
        trackingSlug: lead.trackingLink?.slug ?? null,
        targetUrl: lead.trackingLink?.targetUrl ?? null,
        utmSource: lead.trackingLink?.utmSource ?? null,
        utmMedium: lead.trackingLink?.utmMedium ?? null,
        utmCampaign: lead.trackingLink?.utmCampaign ?? null,
        utmContent: lead.trackingLink?.utmContent ?? null,
      },
      inquiries: lead.inquiries.map((inquiry) => ({
        id: inquiry.id,
        sourceType: inquiry.sourceType.toLowerCase(),
        subject: inquiry.subject,
        body: inquiry.body,
        fromEmail: inquiry.fromEmail,
        fromName: inquiry.fromName,
        createdAt: inquiry.createdAt.toISOString(),
      })),
      opportunities: lead.opportunities.map((opportunity) => ({
        id: opportunity.id,
        name: opportunity.name,
        stage: opportunity.stage.toLowerCase(),
        valueAmount: opportunity.valueAmount?.toString() ?? null,
        currency: opportunity.currency,
        followUpDueAt: opportunity.followUpDueAt?.toISOString() ?? null,
      })),
    },
  };
}

export async function listCrmInquiries(params: {
  tenantContext: TenantContext;
  filters?: unknown;
}) {
  const filters = parseSchemaOrThrow(listCrmInquiriesFiltersSchema, params.filters ?? {});

  if (filters.leadId) {
    await getAccessibleLeadOrThrow({
      tenantContext: params.tenantContext,
      leadId: filters.leadId,
    });
  }

  const prisma = getPrismaClient();
  const where: Prisma.InquiryWhereInput = {
    tenantId: params.tenantContext.tenantId,
    ...(params.tenantContext.role === "SALES"
      ? {
          lead: {
            ownerUserId: params.tenantContext.userId,
          },
        }
      : {}),
    ...(filters.leadId ? { leadId: filters.leadId } : {}),
    ...(filters.source
      ? {
          sourceType: filters.source.toUpperCase() as "FORM" | "EMAIL",
        }
      : {}),
  };

  const inquiries = await prisma.inquiry.findMany({
    where,
    orderBy: {
      createdAt: "desc",
    },
    take: filters.limit ?? 40,
    select: {
      id: true,
      sourceType: true,
      subject: true,
      body: true,
      fromEmail: true,
      fromName: true,
      createdAt: true,
      lead: {
        select: {
          id: true,
          companyName: true,
          country: true,
          status: true,
          ownerUserId: true,
          contact: {
            select: {
              name: true,
              email: true,
            },
          },
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          trackingLink: {
            select: {
              slug: true,
              platform: true,
            },
          },
          sourceContentItem: {
            select: {
              title: true,
              platform: true,
            },
          },
        },
      },
      replies: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        select: {
          id: true,
          status: true,
          sentAt: true,
          updatedAt: true,
        },
      },
    },
  });

  return {
    items: inquiries.map((inquiry) => ({
      id: inquiry.id,
      sourceType: inquiry.sourceType.toLowerCase(),
      subject: inquiry.subject,
      bodyPreview: inquiry.body.slice(0, 220),
      fromEmail: inquiry.fromEmail,
      fromName: inquiry.fromName,
      createdAt: inquiry.createdAt.toISOString(),
      lead: {
        id: inquiry.lead.id,
        companyName: inquiry.lead.companyName,
        country: inquiry.lead.country,
        status: inquiry.lead.status.toLowerCase(),
        ownerUserId: inquiry.lead.ownerUserId,
        contactName: inquiry.lead.contact?.name ?? null,
        contactEmail: inquiry.lead.contact?.email ?? null,
        owner: inquiry.lead.owner,
      },
      sourceAttribution: {
        platform:
          inquiry.lead.trackingLink?.platform.toLowerCase() ??
          inquiry.lead.sourceContentItem?.platform.toLowerCase() ??
          null,
        contentTitle: inquiry.lead.sourceContentItem?.title ?? null,
        trackingSlug: inquiry.lead.trackingLink?.slug ?? null,
      },
      latestReply: inquiry.replies[0]
        ? {
            id: inquiry.replies[0].id,
            status: inquiry.replies[0].status.toLowerCase(),
            sentAt: inquiry.replies[0].sentAt?.toISOString() ?? null,
            updatedAt: inquiry.replies[0].updatedAt.toISOString(),
          }
        : null,
    })),
  };
}

export async function updateCrmLead(params: {
  tenantContext: TenantContext;
  leadId: string;
  input: UpdateCrmLeadInput;
}) {
  await getAccessibleLeadOrThrow({
    tenantContext: params.tenantContext,
    leadId: params.leadId,
  });
  const input = parseSchemaOrThrow(updateCrmLeadSchema, params.input);
  const prisma = getPrismaClient();
  const ownerUserId = await ensureAssignableOwner({
    tenantId: params.tenantContext.tenantId,
    ownerUserId: input.ownerUserId,
    actorRole: params.tenantContext.role,
    actorUserId: params.tenantContext.userId,
  });
  const updated = await prisma.lead.update({
    where: {
      id: params.leadId,
    },
    data: {
      ownerUserId,
      status: input.status ? leadStatusSchema.parse(input.status) : undefined,
      followUpDueAt:
        input.followUpDueAt === undefined
          ? undefined
          : input.followUpDueAt
            ? new Date(input.followUpDueAt)
            : null,
    },
    select: {
      id: true,
      ownerUserId: true,
      status: true,
      followUpDueAt: true,
    },
  });

  return {
    lead: {
      id: updated.id,
      ownerUserId: updated.ownerUserId,
      status: updated.status.toLowerCase(),
      followUpDueAt: updated.followUpDueAt?.toISOString() ?? null,
    },
  };
}

export async function listCrmOpportunities(params: {
  tenantContext: TenantContext;
  filters?: unknown;
}) {
  const filters = parseSchemaOrThrow(
    listCrmOpportunitiesFiltersSchema,
    params.filters ?? {},
  );
  const prisma = getPrismaClient();
  const where: Prisma.OpportunityWhereInput = {
    tenantId: params.tenantContext.tenantId,
    ...(filters.stage
      ? { stage: opportunityStageSchema.parse(filters.stage) }
      : {}),
    ...(params.tenantContext.role === "SALES"
      ? {
          OR: [
            { ownerUserId: params.tenantContext.userId },
            { lead: { ownerUserId: params.tenantContext.userId } },
          ],
        }
      : {}),
  };
  const opportunities = await prisma.opportunity.findMany({
    where,
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      leadId: true,
      ownerUserId: true,
      name: true,
      stage: true,
      valueAmount: true,
      currency: true,
      followUpDueAt: true,
      closedAt: true,
      lead: {
        select: {
          companyName: true,
          ownerUserId: true,
        },
      },
      owner: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return {
    items: opportunities.map((opportunity) => ({
      id: opportunity.id,
      leadId: opportunity.leadId,
      ownerUserId: opportunity.ownerUserId,
      companyName: opportunity.lead.companyName,
      name: opportunity.name,
      stage: opportunity.stage.toLowerCase(),
      valueAmount: opportunity.valueAmount?.toString() ?? null,
      currency: opportunity.currency,
      followUpDueAt: opportunity.followUpDueAt?.toISOString() ?? null,
      closedAt: opportunity.closedAt?.toISOString() ?? null,
      owner: opportunity.owner,
    })),
  };
}

export async function listCrmActivities(params: {
  tenantContext: TenantContext;
  filters: unknown;
}) {
  const filters = parseSchemaOrThrow(listCrmActivitiesFiltersSchema, params.filters);

  if (filters.leadId) {
    await getAccessibleLeadOrThrow({
      tenantContext: params.tenantContext,
      leadId: filters.leadId,
    });
  }

  if (filters.opportunityId) {
    await getAccessibleOpportunityOrThrow({
      tenantContext: params.tenantContext,
      opportunityId: filters.opportunityId,
    });
  }

  const prisma = getPrismaClient();
  const items = await prisma.crmActivity.findMany({
    where: {
      tenantId: params.tenantContext.tenantId,
      ...(filters.leadId ? { leadId: filters.leadId } : {}),
      ...(filters.opportunityId ? { opportunityId: filters.opportunityId } : {}),
    },
    orderBy: {
      createdAt: "desc",
    },
    take: filters.limit ?? 20,
    select: {
      id: true,
      leadId: true,
      opportunityId: true,
      type: true,
      body: true,
      createdAt: true,
      actor: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return {
    items: items.map((activity) => ({
      id: activity.id,
      leadId: activity.leadId,
      opportunityId: activity.opportunityId,
      type: activity.type.toLowerCase(),
      body: activity.body,
      createdAt: activity.createdAt.toISOString(),
      actor: activity.actor,
    })),
  };
}

export async function updateOpportunityStage(params: {
  tenantContext: TenantContext;
  opportunityId: string;
  input: UpdateOpportunityStageInput;
}) {
  const opportunity = await getAccessibleOpportunityOrThrow({
    tenantContext: params.tenantContext,
    opportunityId: params.opportunityId,
  });
  const input = parseSchemaOrThrow(updateOpportunityStageSchema, params.input);
  const nextStage = opportunityStageSchema.parse(input.stage);
  const prisma = getPrismaClient();
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.opportunity.update({
      where: {
        id: params.opportunityId,
      },
      data: {
        stage: nextStage,
      },
      select: {
        id: true,
        leadId: true,
        stage: true,
      },
    });
    await tx.crmActivity.create({
      data: {
        tenantId: params.tenantContext.tenantId,
        leadId: changed.leadId,
        opportunityId: changed.id,
        actorUserId: params.tenantContext.userId,
        type: CrmActivityType.STAGE_CHANGE,
        body: `Opportunity stage changed from ${opportunity.stage.toLowerCase()} to ${changed.stage.toLowerCase()}.`,
        metadata: {
          previousStage: opportunity.stage.toLowerCase(),
          nextStage: changed.stage.toLowerCase(),
        },
      },
    });

    return changed;
  });

  return {
    opportunity: {
      id: updated.id,
      leadId: updated.leadId,
      stage: updated.stage.toLowerCase(),
    },
  };
}

export async function createCrmActivity(params: {
  tenantContext: TenantContext;
  input: CreateCrmActivityInput;
}) {
  const input = parseSchemaOrThrow(createCrmActivitySchema, params.input);

  if (input.leadId) {
    await getAccessibleLeadOrThrow({
      tenantContext: params.tenantContext,
      leadId: input.leadId,
    });
  }

  if (input.opportunityId) {
    await getAccessibleOpportunityOrThrow({
      tenantContext: params.tenantContext,
      opportunityId: input.opportunityId,
    });
  }

  const prisma = getPrismaClient();
  const activity = await prisma.crmActivity.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      leadId: input.leadId ?? null,
      opportunityId: input.opportunityId ?? null,
      actorUserId: params.tenantContext.userId,
      type: crmActivityTypeSchema.parse(input.type),
      body: input.body,
    },
    select: {
      id: true,
      leadId: true,
      opportunityId: true,
      type: true,
      body: true,
      createdAt: true,
    },
  });

  return {
    activity: {
      id: activity.id,
      leadId: activity.leadId,
      opportunityId: activity.opportunityId,
      type: activity.type.toLowerCase(),
      body: activity.body,
      createdAt: activity.createdAt.toISOString(),
    },
  };
}
