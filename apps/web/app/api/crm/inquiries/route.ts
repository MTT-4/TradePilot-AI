import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { routeErrorToResponse } from "@/server/api/errors";
import { listCrmInquiries } from "@/server/crm/service";

export const GET = auth(async (request) => {
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
      MembershipRole.SALES,
    );
    const { searchParams } = new URL(request.url);

    return Response.json(
      await listCrmInquiries({
        tenantContext: context,
        filters: Object.fromEntries(searchParams.entries()),
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
