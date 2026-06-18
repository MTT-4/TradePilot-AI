import type { MembershipRole } from "@prisma/client";
import { getPrismaClient } from "@/server/db/prisma";
import { TenantContextError } from "@/server/db/errors";

export type TenantContext = {
  tenantId: string;
  userId: string;
  role: MembershipRole;
};

type AuditFailureInput = {
  tenantId: string;
  userEmail: string;
  reason: string;
};

async function writeUnauthorizedAuditLog({
  tenantId,
  userEmail,
  reason,
}: AuditFailureInput) {
  const prisma = getPrismaClient();
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });

  if (!tenant) {
    return;
  }

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "tenant_access_denied",
      entityType: "tenant_membership",
      metadata: {
        userEmail,
        reason,
      },
    },
  });
}

export async function resolveTenantContext(
  headers: Headers,
): Promise<TenantContext> {
  const tenantId = headers.get("x-tenant-id");
  const userEmail = headers.get("x-user-email");

  if (!tenantId) {
    throw new TenantContextError(
      400,
      "VALIDATION",
      "Missing X-Tenant-Id header.",
    );
  }

  if (!userEmail) {
    throw new TenantContextError(
      401,
      "UNAUTHENTICATED",
      "Missing x-user-email header for internal probe request.",
    );
  }

  const prisma = getPrismaClient();
  const membership = await prisma.membership.findFirst({
    where: {
      tenantId,
      status: "ACTIVE",
      user: {
        email: userEmail,
      },
    },
    select: {
      tenantId: true,
      role: true,
      userId: true,
    },
  });

  if (!membership) {
    await writeUnauthorizedAuditLog({
      tenantId,
      userEmail,
      reason: "membership_not_found",
    });

    throw new TenantContextError(
      403,
      "FORBIDDEN",
      "User does not belong to the requested tenant.",
    );
  }

  return {
    tenantId: membership.tenantId,
    userId: membership.userId,
    role: membership.role,
  };
}
