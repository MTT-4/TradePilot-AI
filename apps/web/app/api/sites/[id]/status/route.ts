import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { ApiError, parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { setSiteProjectOffline } from "@/server/sites/service";

const requestSchema = z.object({
  status: z.literal("offline"),
});

export const POST = auth(async (request, routeContext) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      throw new ApiError(401, "UNAUTHENTICATED", "Login required.");
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.OPERATOR,
    );
    await parseJsonBody(request, requestSchema);
    const params = await routeContext.params;

    return Response.json(
      await setSiteProjectOffline({
        tenantContext: context,
        siteId: params.id,
        requestedByUserId: userId,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
