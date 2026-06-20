import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { routeErrorToResponse } from "@/server/api/errors";
import { listNotifications } from "@/server/notifications/service";

const statusSchema = z.enum(["unread", "read", "archived"]);

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
      MembershipRole.VIEWER,
    );
    const url = new URL(request.url);
    const rawStatus = url.searchParams.get("status");
    const status = rawStatus ? statusSchema.parse(rawStatus) : undefined;

    return Response.json(
      await listNotifications({
        tenantContext: context,
        status,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
