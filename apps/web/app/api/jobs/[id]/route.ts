import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { routeErrorToResponse } from "@/server/api/errors";
import { getTenantJobById } from "@/server/jobs/service";

export const GET = auth(async (request, routeContext) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return Response.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Login required.",
            details: {},
          },
        },
        { status: 401 },
      );
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.VIEWER,
    );
    const params = await routeContext.params;
    const job = await getTenantJobById(context, params.id);

    return Response.json({
      status: job.status.toLowerCase(),
      progress: job.progress,
      error: job.error,
      type: job.type.toLowerCase(),
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      output: job.output,
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
