import { MembershipRole, NotificationStatus } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { errorJson, parseJsonBody, routeErrorToResponse, ApiError } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";

const notificationActionSchema = z.object({
  action: z.enum(["read", "archive"]),
});

export const PATCH = auth(async (request, context) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return errorJson(401, "UNAUTHENTICATED", "Login required.");
    }

    const params = await context.params;
    const notificationId = params.id;

    if (!notificationId || notificationId.startsWith("hitl-")) {
      throw new ApiError(400, "VALIDATION", "Derived HITL notifications cannot be mutated.");
    }

    const input = await parseJsonBody(request, notificationActionSchema);
    const { context: tenantContext, tenantPrisma } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.VIEWER,
    );

    const existing = await tenantPrisma.notification.findUnique({
      where: {
        id: notificationId,
      },
      select: {
        id: true,
        status: true,
        readAt: true,
      },
    });

    if (!existing) {
      throw new ApiError(404, "NOT_FOUND", "Notification not found.");
    }

    const status =
      input.action === "archive" ? NotificationStatus.ARCHIVED : NotificationStatus.READ;
    const readAt = existing.readAt ?? new Date();

    const updated = await tenantPrisma.notification.update({
      where: {
        id: existing.id,
      },
      data: {
        status,
        readAt,
      },
      select: {
        id: true,
        status: true,
        readAt: true,
      },
    });

    await tenantPrisma.auditLog.create({
      data: {
        tenantId: tenantContext.tenantId,
        actorUserId: userId,
        action: input.action === "archive" ? "notification_archived" : "notification_read",
        entityType: "notification",
        entityId: existing.id,
        metadata: {
          before: {
            status: existing.status.toLowerCase(),
            readAt: existing.readAt?.toISOString() ?? null,
          },
          after: {
            status: updated.status.toLowerCase(),
            readAt: updated.readAt?.toISOString() ?? null,
          },
        },
      },
    });

    return Response.json({
      id: updated.id,
      status: updated.status.toLowerCase(),
      readAt: updated.readAt?.toISOString() ?? null,
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
