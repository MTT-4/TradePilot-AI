import type { MembershipRole } from "@prisma/client";
import { ApiError } from "@/server/api/errors";

const ROLE_RANK: Record<MembershipRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  OPERATOR: 2,
  SALES: 1,
  VIEWER: 0,
};

export function hasMinimumRole(
  role: MembershipRole,
  minimumRole: MembershipRole,
) {
  return ROLE_RANK[role] >= ROLE_RANK[minimumRole];
}

export function assertMinimumRole(
  role: MembershipRole,
  minimumRole: MembershipRole,
) {
  if (!hasMinimumRole(role, minimumRole)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      `This endpoint requires ${minimumRole.toLowerCase()} role or higher.`,
    );
  }
}

export function toApiRole(role: MembershipRole) {
  return role.toLowerCase();
}
