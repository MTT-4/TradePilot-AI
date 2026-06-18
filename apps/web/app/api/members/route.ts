import {
  MembershipRole,
  MembershipStatus,
  type MembershipStatus as MembershipStatusType,
} from "@prisma/client";
import { auth } from "@/auth";
import {
  errorJson,
  parseJsonBody,
  routeErrorToResponse,
  ApiError,
} from "@/server/api/errors";
import { getPrismaClient } from "@/server/db/prisma";
import { requireTenantAccess } from "@/server/auth/access";
import {
  INVITED_PASSWORD_PLACEHOLDER,
} from "@/server/auth/service";
import { toApiRole } from "@/server/auth/rbac";
import { z } from "zod";

const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z
    .enum(["owner", "admin", "operator", "sales", "viewer"])
    .transform((value) => value.toUpperCase() as MembershipRole),
});

function toApiStatus(status: MembershipStatusType) {
  return status.toLowerCase();
}

export const GET = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return errorJson(401, "UNAUTHENTICATED", "Login required.");
    }

    const { tenantPrisma } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.ADMIN,
    );

    const members = await tenantPrisma.membership.findMany({
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    return Response.json({
      items: members.map((member) => ({
        id: member.id,
        role: toApiRole(member.role),
        status: toApiStatus(member.status),
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
        user: member.user,
      })),
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});

export const POST = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return errorJson(401, "UNAUTHENTICATED", "Login required.");
    }

    const input = await parseJsonBody(request, inviteMemberSchema);
    const { tenantPrisma, context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.ADMIN,
    );
    const prisma = getPrismaClient();
    const normalizedEmail = input.email.trim().toLowerCase();

    const user =
      (await prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
        select: {
          id: true,
          email: true,
          name: true,
        },
      })) ??
      (await prisma.user.create({
        data: {
          email: normalizedEmail,
          name: normalizedEmail.split("@")[0] || "invited-user",
          passwordHash: INVITED_PASSWORD_PLACEHOLDER,
        },
        select: {
          id: true,
          email: true,
          name: true,
        },
      }));

    const existingMembership = await tenantPrisma.membership.findFirst({
      where: {
        userId: user.id,
      },
      select: {
        id: true,
      },
    });

    if (existingMembership) {
      throw new ApiError(
        409,
        "CONFLICT",
        "This user is already a member of the requested tenant.",
      );
    }

    const membership = await tenantPrisma.membership.create({
      data: {
        tenantId: context.tenantId,
        userId: user.id,
        role: input.role,
        status: MembershipStatus.INVITED,
      },
      select: {
        id: true,
        role: true,
        status: true,
      },
    });

    return Response.json(
      {
        memberId: membership.id,
        role: toApiRole(membership.role),
        status: toApiStatus(membership.status),
      },
      { status: 201 },
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
