import {
  MembershipRole,
  MembershipStatus,
  type MembershipStatus as MembershipStatusType,
} from "@prisma/client";
import { ApiError } from "@/server/api/errors";
import type { TenantContext } from "@/server/db/tenant-context";
import { hasMinimumRole, toApiRole } from "@/server/auth/rbac";
import { getTenantPrisma } from "@/server/db/tenant-prisma";

type UpdateTenantMembershipInput = {
  tenantContext: TenantContext;
  actorUserId: string;
  memberId: string;
  role?: MembershipRole;
  status?: MembershipStatus;
};

function toApiStatus(status: MembershipStatusType) {
  return status.toLowerCase();
}

export async function updateTenantMembership({
  tenantContext,
  actorUserId,
  memberId,
  role,
  status,
}: UpdateTenantMembershipInput) {
  const tenantPrisma = getTenantPrisma(tenantContext);
  const member = await tenantPrisma.membership.findUnique({
    where: {
      id: memberId,
    },
    select: {
      id: true,
      role: true,
      status: true,
    },
  });

  if (!member) {
    throw new ApiError(404, "NOT_FOUND", "Member not found.");
  }

  if (
    tenantContext.role === MembershipRole.ADMIN &&
    (member.role === MembershipRole.OWNER || role === MembershipRole.OWNER)
  ) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only an owner can manage owner memberships.",
    );
  }

  if (
    role &&
    !hasMinimumRole(tenantContext.role, role) &&
    tenantContext.role !== MembershipRole.OWNER
  ) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "You cannot assign a role above your own membership.",
    );
  }

  const updatedMembership = await tenantPrisma.membership.update({
    where: {
      id: member.id,
    },
    data: {
      role,
      status,
    },
    select: {
      id: true,
      role: true,
      status: true,
    },
  });

  await tenantPrisma.auditLog.create({
    data: {
      tenantId: tenantContext.tenantId,
      actorUserId,
      action:
        role && role !== member.role
          ? "membership_role_updated"
          : "membership_status_updated",
      entityType: "membership",
      entityId: member.id,
      metadata: {
        before: {
          role: member.role.toLowerCase(),
          status: member.status.toLowerCase(),
        },
        after: {
          role: updatedMembership.role.toLowerCase(),
          status: updatedMembership.status.toLowerCase(),
        },
      },
    },
  });

  return {
    id: updatedMembership.id,
    role: toApiRole(updatedMembership.role),
    status: toApiStatus(updatedMembership.status),
  };
}
