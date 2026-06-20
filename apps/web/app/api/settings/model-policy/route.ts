import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { errorJson, parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import {
  getResolvedModelPolicy,
  modelPolicySchema,
  upsertModelPolicy,
} from "@/server/settings/service";

export const GET = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return errorJson(401, "UNAUTHENTICATED", "Login required.");
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.ADMIN,
    );

    return Response.json(await getResolvedModelPolicy(context));
  } catch (error) {
    return routeErrorToResponse(error);
  }
});

export const PATCH = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return errorJson(401, "UNAUTHENTICATED", "Login required.");
    }

    const input = await parseJsonBody(request, modelPolicySchema);
    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.ADMIN,
    );

    return Response.json(
      await upsertModelPolicy({
        tenantContext: context,
        actorUserId: userId,
        input,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
