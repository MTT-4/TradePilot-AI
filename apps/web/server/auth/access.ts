import type { MembershipRole } from "@prisma/client";
import { ApiError } from "@/server/api/errors";
import { getPrismaClient } from "@/server/db/prisma";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import { assertMinimumRole } from "@/server/auth/rbac";

export async function requireTenantAccess(
  headers: Headers,
  userId: string,
  minimumRole?: MembershipRole,
) {
  const tenantId = headers.get("x-tenant-id");

  if (!tenantId) {
    throw new ApiError(400, "VALIDATION", "Missing X-Tenant-Id header.");
  }

  const prisma = getPrismaClient();
  const membership = await prisma.membership.findFirst({
    where: {
      tenantId,
      userId,
      status: "ACTIVE",
    },
    select: {
      tenantId: true,
      userId: true,
      role: true,
    },
  });

  if (!membership) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "User does not belong to the requested tenant.",
    );
  }

  if (minimumRole) {
    assertMinimumRole(membership.role, minimumRole);
  }

  return {
    context: membership,
    tenantPrisma: getTenantPrisma(membership),
  };
}
