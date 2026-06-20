import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { errorJson, parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { rejectReplyDraft, rejectReplySchema } from "@/server/replies/service";

export const POST = auth(async (request, routeContext) => {
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
    const input = await parseJsonBody(request, rejectReplySchema);

    return Response.json(
      await rejectReplyDraft({
        tenantContext: context,
        replyId: params.id,
        rejectedByUserId: userId,
        input,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
