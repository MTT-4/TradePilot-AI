import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { listNotifications } from "@/server/notifications/service";
import { getResolvedModelPolicy } from "@/server/settings/service";

export const GET = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return Response.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Login required.",
            details: {},
          },
        },
        { status: 401 },
      );
    }

    const { context, tenantPrisma } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.ADMIN,
    );

    const [brandKit, sitePortfolio, notifications, modelPolicy] = await Promise.all([
      tenantPrisma.brandKit.findFirst({
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
          updatedAt: true,
        },
      }),
      tenantPrisma.siteProject.findMany({
        select: {
          id: true,
          status: true,
          locales: {
            select: {
              id: true,
            },
          },
        },
      }),
      listNotifications({
        tenantContext: context,
      }),
      getResolvedModelPolicy(context),
    ]);

    return Response.json({
      brandKit: brandKit
        ? {
            id: brandKit.id,
            name: brandKit.name,
            companyName: brandKit.companyName,
            primaryColor: brandKit.primaryColor,
            secondaryColor: brandKit.secondaryColor,
            logoUrl: brandKit.logoUrl,
            tone:
              brandKit.metadata &&
              typeof brandKit.metadata === "object" &&
              !Array.isArray(brandKit.metadata) &&
              typeof (brandKit.metadata as Record<string, unknown>).tone === "string"
                ? ((brandKit.metadata as Record<string, unknown>).tone as string)
                : null,
            updatedAt: brandKit.updatedAt.toISOString(),
          }
        : null,
      sitePortfolio: {
        totalSites: sitePortfolio.length,
        publishedSites: sitePortfolio.filter((item) => item.status === "PUBLISHED").length,
        localeCount: sitePortfolio.reduce((sum, item) => sum + item.locales.length, 0),
      },
      notifications: {
        unreadCount: notifications.unreadCount,
        pendingApprovals: notifications.items.filter((item) => item.type === "hitl_pending")
          .length,
      },
      modelPolicy,
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
