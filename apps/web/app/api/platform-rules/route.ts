import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { ApiError, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { listPlatformRules } from "@/server/content-packs/service";

export const GET = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      throw new ApiError(401, "UNAUTHENTICATED", "Login required.");
    }

    await requireTenantAccess(request.headers, userId, MembershipRole.VIEWER);

    return Response.json(await listPlatformRules());
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
