import {
  MembershipRole,
  MembershipStatus,
} from "@prisma/client";
import { auth } from "@/auth";
import {
  errorJson,
  parseJsonBody,
  routeErrorToResponse,
} from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { updateTenantMembership } from "@/server/auth/member-admin";
import { z } from "zod";

const updateMemberSchema = z
  .object({
    role: z
      .enum(["owner", "admin", "operator", "sales", "viewer"])
      .transform((value) => value.toUpperCase() as MembershipRole)
      .optional(),
    status: z
      .enum(["invited", "active", "suspended"])
      .transform((value) => value.toUpperCase() as MembershipStatus)
      .optional(),
  })
  .refine((value) => value.role || value.status, {
    message: "At least one of role or status must be provided.",
    path: ["role"],
  });

export const PATCH = auth(async (request, routeContext) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return errorJson(401, "UNAUTHENTICATED", "Login required.");
    }

    const input = await parseJsonBody(request, updateMemberSchema);
    const { context: tenantContext } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.ADMIN,
    );
    const params = await routeContext.params;
    const updatedMembership = await updateTenantMembership({
      tenantContext,
      actorUserId: userId,
      memberId: params.id,
      role: input.role,
      status: input.status,
    });

    return Response.json(updatedMembership);
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
