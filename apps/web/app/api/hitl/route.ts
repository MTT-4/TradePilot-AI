import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { ApiError, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { listHitlTasks } from "@/server/sites/service";

const statusSchema = z.enum(["pending", "approved", "rejected", "expired", "cancelled"]);

export const GET = auth(async (request) => {
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
    const { searchParams } = new URL(request.url);
    const rawStatus = searchParams.get("status");
    const status = rawStatus ? statusSchema.parse(rawStatus) : undefined;

    return Response.json(
      await listHitlTasks({
        tenantContext: context,
        status,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
