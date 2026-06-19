import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { ApiError, parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { updateContentItem } from "@/server/content-packs/service";
import { z } from "zod";

const requestSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  body: z.string().trim().min(1).max(4000).optional(),
  plannedAt: z.string().datetime().nullable().optional(),
  ownerUserId: z.string().min(1).nullable().optional(),
});

export const PATCH = auth(async (request, routeContext) => {
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
    const input = await parseJsonBody(request, requestSchema);
    const params = await routeContext.params;

    return Response.json(
      await updateContentItem({
        tenantContext: context,
        itemId: params.id,
        requestedByUserId: userId,
        input,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
