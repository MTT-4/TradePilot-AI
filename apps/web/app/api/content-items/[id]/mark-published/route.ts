import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { ApiError, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { markContentItemPublished } from "@/server/content-packs/service";

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
    const params = await routeContext.params;

    return Response.json(
      await markContentItemPublished({
        tenantContext: context,
        itemId: params.id,
        requestedByUserId: userId,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
