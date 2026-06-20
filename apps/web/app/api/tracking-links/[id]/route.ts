import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import {
  updateTrackingLink,
  updateTrackingLinkSchema,
} from "@/server/tracking/service";

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
      MembershipRole.OPERATOR,
    );
    const input = await parseJsonBody(request, updateTrackingLinkSchema);
    const params = await routeContext.params;
    const result = await updateTrackingLink({
      tenantContext: context,
      trackingLinkId: params.id,
      input,
    });

    return Response.json(result);
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
