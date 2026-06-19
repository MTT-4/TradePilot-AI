import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { updateOpportunityStage, updateOpportunityStageSchema } from "@/server/crm/service";

export const PATCH = auth(async (request, routeContext) => {
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
    const input = await parseJsonBody(request, updateOpportunityStageSchema);
    const params = await routeContext.params;
    const result = await updateOpportunityStage({
      tenantContext: context,
      opportunityId: params.id,
      input,
    });

    return Response.json(result);
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
