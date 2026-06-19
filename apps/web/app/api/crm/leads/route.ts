import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { routeErrorToResponse } from "@/server/api/errors";
import { listCrmLeads } from "@/server/crm/service";

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
    const result = await listCrmLeads({
      tenantContext: context,
      filters: {
        score: url.searchParams.get("score") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        source: url.searchParams.get("source") ?? undefined,
      },
    });

    return Response.json(result);
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
