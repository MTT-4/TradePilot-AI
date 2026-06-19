import { PublishStatus } from "@prisma/client";
import { z } from "zod";
import { getPrismaClient } from "@/server/db/prisma";
import type { TenantContext } from "@/server/db/tenant-context";

export const dashboardRangeSchema = z.enum(["day", "week", "month"]);

function getRangeStart(range: z.infer<typeof dashboardRangeSchema>) {
  const now = Date.now();

  switch (range) {
    case "day":
      return new Date(now - 24 * 60 * 60 * 1000);
    case "week":
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "month":
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
  }
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

export async function getDashboardSummary(params: {
  tenantContext: TenantContext;
  range: z.infer<typeof dashboardRangeSchema>;
}) {
  const range = dashboardRangeSchema.parse(params.range);
  const prisma = getPrismaClient();
  const startAt = getRangeStart(range);
  const [
    inquiriesCount,
    leadsCount,
    opportunitiesCount,
    replies,
    pendingPublish,
    pendingHitlTasks,
    attributedInquiries,
  ] = await Promise.all([
    prisma.inquiry.count({
      where: {
        tenantId: params.tenantContext.tenantId,
        createdAt: {
          gte: startAt,
        },
      },
    }),
    prisma.lead.count({
      where: {
        tenantId: params.tenantContext.tenantId,
        createdAt: {
          gte: startAt,
        },
      },
    }),
    prisma.opportunity.count({
      where: {
        tenantId: params.tenantContext.tenantId,
        createdAt: {
          gte: startAt,
        },
      },
    }),
    prisma.reply.findMany({
      where: {
        tenantId: params.tenantContext.tenantId,
        status: "SENT",
        sentAt: {
          gte: startAt,
        },
      },
      select: {
        sentAt: true,
        inquiry: {
          select: {
            createdAt: true,
          },
        },
      },
    }),
    prisma.contentItem.count({
      where: {
        tenantId: params.tenantContext.tenantId,
        publishStatus: PublishStatus.PENDING,
      },
    }),
    prisma.hitlTask.findMany({
      where: {
        tenantId: params.tenantContext.tenantId,
        status: "PENDING",
      },
      select: {
        type: true,
      },
    }),
    prisma.inquiry.findMany({
      where: {
        tenantId: params.tenantContext.tenantId,
        createdAt: {
          gte: startAt,
        },
        lead: {
          sourceContentItemId: {
            not: null,
          },
        },
      },
      select: {
        lead: {
          select: {
            sourceContentItemId: true,
            sourceContentItem: {
              select: {
                title: true,
                platform: true,
              },
            },
          },
        },
      },
    }),
  ]);
  const pendingHitl = new Map<string, number>();

  for (const task of pendingHitlTasks) {
    const key = task.type.toLowerCase();
    pendingHitl.set(key, (pendingHitl.get(key) ?? 0) + 1);
  }

  const sourceAttribution = new Map<
    string,
    { platform: string; content: string; count: number }
  >();

  for (const inquiry of attributedInquiries) {
    const platform =
      inquiry.lead.sourceContentItem?.platform.toLowerCase() ?? "unknown";
    const content =
      inquiry.lead.sourceContentItem?.title ??
      inquiry.lead.sourceContentItemId ??
      "unknown";
    const key = `${platform}:${content}`;
    const current = sourceAttribution.get(key);

    if (current) {
      current.count += 1;
    } else {
      sourceAttribution.set(key, {
        platform,
        content,
        count: 1,
      });
    }
  }

  return {
    loopStats: {
      leadsCount,
      opportunitiesCount,
      repliesSentCount: replies.length,
    },
    inquiriesCount,
    pendingPublish,
    pendingHitl: Array.from(pendingHitl.entries()).map(([type, count]) => ({
      type,
      count,
    })),
    replyMedianMinutes: median(
      replies
        .filter((reply) => reply.sentAt)
        .map((reply) =>
          Math.max(
            0,
            Math.round(
              (reply.sentAt!.getTime() - reply.inquiry.createdAt.getTime()) /
                60000,
            ),
          ),
        ),
    ),
    sourceAttribution: Array.from(sourceAttribution.values()).sort(
      (a, b) => b.count - a.count,
    ),
  };
}
