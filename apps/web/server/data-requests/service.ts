import {
  DataRequestStatus,
  DataRequestType,
  Prisma,
} from "@prisma/client";
import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import { hasMinimumRole } from "@/server/auth/rbac";
import { getPrismaClient } from "@/server/db/prisma";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import type { TenantContext } from "@/server/db/tenant-context";

const createDataRequestSchema = z.object({
  type: z.enum(["export", "delete"]),
  scope: z.record(z.string(), z.unknown()).optional(),
});

const listDataRequestsStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "rejected",
]);

const resolveDataRequestSchema = z.object({
  status: z.enum(["completed", "rejected"]).default("completed"),
});

function assertDataRequestAccess(role: TenantContext["role"]) {
  if (!hasMinimumRole(role, "ADMIN")) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Data export and deletion requests require admin role or higher.",
    );
  }
}

function toPrismaDataRequestType(type: z.infer<typeof createDataRequestSchema>["type"]) {
  return type.toUpperCase() as DataRequestType;
}

function toPrismaDataRequestStatus(
  status: z.infer<typeof listDataRequestsStatusSchema>,
) {
  return status.toUpperCase() as DataRequestStatus;
}

function toApiDataRequestStatus(status: DataRequestStatus) {
  return status.toLowerCase();
}

function toApiDataRequestType(type: DataRequestType) {
  return type.toLowerCase();
}

async function createAuditLog(params: {
  tenantId: string;
  actorUserId?: string;
  action: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await getPrismaClient().auditLog.create({
    data: {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: "data_request",
      entityId: params.entityId,
      metadata: params.metadata,
    },
  });
}

export async function listDataRequests(params: {
  tenantContext: TenantContext;
  status?: "pending" | "processing" | "completed" | "rejected";
}) {
  assertDataRequestAccess(params.tenantContext.role);

  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const status = params.status
    ? toPrismaDataRequestStatus(listDataRequestsStatusSchema.parse(params.status))
    : undefined;
  const items = await tenantPrisma.dataRequest.findMany({
    where: {
      status,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      type: true,
      status: true,
      scope: true,
      requestedByUserId: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return {
    items: items.map((item) => ({
      id: item.id,
      type: toApiDataRequestType(item.type),
      status: toApiDataRequestStatus(item.status),
      scope: item.scope,
      requestedByUserId: item.requestedByUserId,
      completedAt: item.completedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
  };
}

export async function createDataRequest(params: {
  tenantContext: TenantContext;
  requestedByUserId?: string;
  input: unknown;
}) {
  assertDataRequestAccess(params.tenantContext.role);

  const input = createDataRequestSchema.parse(params.input);
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const created = await tenantPrisma.dataRequest.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      requestedByUserId:
        params.requestedByUserId ?? params.tenantContext.userId,
      type: toPrismaDataRequestType(input.type),
      status: DataRequestStatus.PENDING,
      scope: (input.scope ?? null) as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      type: true,
      status: true,
      scope: true,
      requestedByUserId: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.requestedByUserId ?? params.tenantContext.userId,
    action: "data_request_created",
    entityId: created.id,
    metadata: {
      type: toApiDataRequestType(created.type),
      scope: created.scope,
    },
  });

  return {
    id: created.id,
    type: toApiDataRequestType(created.type),
    status: toApiDataRequestStatus(created.status),
    scope: created.scope,
    requestedByUserId: created.requestedByUserId,
    completedAt: created.completedAt?.toISOString() ?? null,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

export async function resolveDataRequest(params: {
  tenantContext: TenantContext;
  requestId: string;
  resolvedByUserId?: string;
  input?: unknown;
}) {
  assertDataRequestAccess(params.tenantContext.role);

  const input = resolveDataRequestSchema.parse(params.input ?? {});
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const request = await tenantPrisma.dataRequest.findUnique({
    where: {
      id: params.requestId,
    },
    select: {
      id: true,
      type: true,
      status: true,
      scope: true,
      requestedByUserId: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!request) {
    throw new ApiError(404, "NOT_FOUND", "Data request not found.");
  }

  if (
    request.status !== DataRequestStatus.PENDING &&
    request.status !== DataRequestStatus.PROCESSING
  ) {
    throw new ApiError(409, "CONFLICT", "Data request has already been resolved.");
  }

  const nextStatus = input.status === "completed"
    ? DataRequestStatus.COMPLETED
    : DataRequestStatus.REJECTED;
  const updated = await tenantPrisma.dataRequest.update({
    where: {
      id: params.requestId,
    },
    data: {
      status: nextStatus,
      completedAt: new Date(),
    },
    select: {
      id: true,
      type: true,
      status: true,
      scope: true,
      requestedByUserId: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.resolvedByUserId ?? params.tenantContext.userId,
    action: "data_request_resolved",
    entityId: updated.id,
    metadata: {
      status: toApiDataRequestStatus(updated.status),
      type: toApiDataRequestType(updated.type),
    },
  });

  return {
    id: updated.id,
    type: toApiDataRequestType(updated.type),
    status: toApiDataRequestStatus(updated.status),
    scope: updated.scope,
    requestedByUserId: updated.requestedByUserId,
    completedAt: updated.completedAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}
