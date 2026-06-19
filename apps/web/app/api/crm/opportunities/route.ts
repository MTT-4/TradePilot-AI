import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { routeErrorToResponse } from "@/server/api/errors";
import { listCrmOpportunities } from "@/server/crm/service";

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
      MembershipRole.SALES,
    );
    const url = new URL(request.url);
    const result = await listCrmOpportunities({
      tenantContext: context,
      filters: {
        stage: url.searchParams.get("stage") ?? undefined,
      },
    });

    return Response.json(result);
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
