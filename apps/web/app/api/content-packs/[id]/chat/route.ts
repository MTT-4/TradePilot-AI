import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { ApiError, parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { applyContentPackChatUpdate } from "@/server/content-packs/service";
import { z } from "zod";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(1200),
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
    const input = await parseJsonBody(request, requestSchema);
    const params = await routeContext.params;

    return Response.json(
      await applyContentPackChatUpdate({
        tenantContext: context,
        packId: params.id,
        requestedByUserId: userId,
        input,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
