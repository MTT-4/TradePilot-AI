import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { routeErrorToResponse } from "@/server/api/errors";
import { dashboardRangeSchema, getDashboardSummary } from "@/server/dashboard/service";

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

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.VIEWER,
    );
    const url = new URL(request.url);
    const range = dashboardRangeSchema.parse(
      (url.searchParams.get("range") ?? "week").toLowerCase(),
    );

    return Response.json(
      await getDashboardSummary({
        tenantContext: context,
        range,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
