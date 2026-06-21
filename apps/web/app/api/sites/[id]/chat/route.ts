import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { ApiError, parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { applySiteChatUpdate } from "@/server/sites/service";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  assetIds: z.array(z.string().trim().min(1)).max(24).optional(),
  knowledgeDocumentIds: z.array(z.string().trim().min(1)).max(24).optional(),
  referenceBrandKit: z.boolean().optional(),
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
      await applySiteChatUpdate({
        tenantContext: context,
        siteId: params.id,
        message: input.message,
        requestedByUserId: userId,
        assetIds: input.assetIds,
        knowledgeDocumentIds: input.knowledgeDocumentIds,
        referenceBrandKit: input.referenceBrandKit,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
