import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import {
  parseJsonBody,
  routeErrorToResponse,
  ApiError,
} from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import {
  createDataRequest,
  listDataRequests,
} from "@/server/data-requests/service";

const requestSchema = z.object({
  type: z.enum(["export", "delete"]),
  scope: z.record(z.string(), z.unknown()).optional(),
});

const statusSchema = z.enum(["pending", "processing", "completed", "rejected"]);

export const GET = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      throw new ApiError(401, "UNAUTHENTICATED", "Login required.");
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.ADMIN,
    );
    const { searchParams } = new URL(request.url);
    const rawStatus = searchParams.get("status");
    const status = rawStatus ? statusSchema.parse(rawStatus) : undefined;

    return Response.json(
      await listDataRequests({
        tenantContext: context,
        status,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});

export const POST = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      throw new ApiError(401, "UNAUTHENTICATED", "Login required.");
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.ADMIN,
    );
    const input = await parseJsonBody(request, requestSchema);
    const created = await createDataRequest({
      tenantContext: context,
      requestedByUserId: userId,
      input,
    });

    return Response.json(created, { status: 201 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
