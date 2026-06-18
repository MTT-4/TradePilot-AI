import { auth } from "@/auth";
import { errorJson, routeErrorToResponse } from "@/server/api/errors";
import { getPrismaClient } from "@/server/db/prisma";
import { listUserMemberships } from "@/server/auth/service";

export const GET = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return errorJson(401, "UNAUTHENTICATED", "Login required.");
    }

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        twoFactorEnabled: true,
      },
    });

    if (!user) {
      return errorJson(401, "UNAUTHENTICATED", "Login required.");
    }

    const memberships = await listUserMemberships(userId);
    const requestedTenantId = request.headers.get("x-tenant-id");
    const currentTenant =
      memberships.find(
        (membership) =>
          membership.tenantId === requestedTenantId &&
          membership.status === "active",
      ) ??
      memberships.find((membership) => membership.status === "active") ??
      null;

    return Response.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        twoFactorEnabled: user.twoFactorEnabled,
      },
      memberships,
      currentTenant,
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
