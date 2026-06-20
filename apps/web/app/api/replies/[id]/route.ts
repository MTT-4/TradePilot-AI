import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { errorJson, parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import {
  getReplyDetail,
  updateReplyDraft,
  updateReplyDraftSchema,
} from "@/server/replies/service";

export const GET = auth(async (request, routeContext) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return errorJson(401, "UNAUTHENTICATED", "Login required.");
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.SALES,
    );
    const params = await routeContext.params;

    return Response.json(
      await getReplyDetail({
        tenantContext: context,
        replyId: params.id,
        requestedByUserId: userId,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});

export const PATCH = auth(async (request, routeContext) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return errorJson(401, "UNAUTHENTICATED", "Login required.");
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.SALES,
    );
    const params = await routeContext.params;
    const input = await parseJsonBody(request, updateReplyDraftSchema);

    return Response.json(
      await updateReplyDraft({
        tenantContext: context,
        replyId: params.id,
        requestedByUserId: userId,
        input,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
