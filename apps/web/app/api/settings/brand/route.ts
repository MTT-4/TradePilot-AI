import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { errorJson, parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { brandKitUpdateSchema, upsertBrandKitSettings } from "@/server/settings/service";

export const PATCH = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return errorJson(401, "UNAUTHENTICATED", "Login required.");
    }

    const input = await parseJsonBody(request, brandKitUpdateSchema);
    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.ADMIN,
    );

    return Response.json(
      await upsertBrandKitSettings({
        tenantContext: context,
        actorUserId: userId,
        input,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
