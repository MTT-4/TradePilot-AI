import { Prisma } from "@prisma/client";
import type { TenantContext } from "@/server/db/tenant-context";
import { TenantContextError } from "@/server/db/errors";
import { getPrismaClient } from "@/server/db/prisma";
import {
  getDelegateName,
  isTenantScopedModel,
} from "@/server/db/tenant-models";

type AnyArgs = Record<string, unknown> | undefined;
type AnyDelegate = Record<string, (...args: unknown[]) => Promise<unknown>>;

function mergeWhere(args: AnyArgs, tenantId: string) {
  return {
    ...(args ?? {}),
    where: {
      ...(((args ?? {}).where as Record<string, unknown> | undefined) ?? {}),
      tenantId,
    },
  };
}

function assertTenantContext(
  context: TenantContext | null | undefined,
): TenantContext {
  if (!context) {
    throw new TenantContextError(
      500,
      "TENANT_CONTEXT_REQUIRED",
      "Tenant-scoped Prisma access requires tenant context.",
    );
  }

  return context;
}

function withTenantData(data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => withTenantData(item, tenantId));
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  const incomingTenantId = payload.tenantId;

  if (incomingTenantId && incomingTenantId !== tenantId) {
    throw new TenantContextError(
      403,
      "FORBIDDEN",
      "Tenant mismatch in write payload.",
    );
  }

  return {
    ...payload,
    tenantId,
  };
}

function getBaseDelegate(model: Prisma.ModelName): AnyDelegate {
  const delegateName = getDelegateName(model);
  return (getPrismaClient() as unknown as Record<string, AnyDelegate>)[
    delegateName
  ] as AnyDelegate;
}

async function runTenantScopedOperation(params: {
  model: Prisma.ModelName;
  operation: string;
  args: AnyArgs;
  query: (args: AnyArgs) => Promise<unknown>;
  context: TenantContext;
}) {
  const { model, operation, args, query, context } = params;
  const baseDelegate = getBaseDelegate(model);

  switch (operation) {
    case "findMany":
    case "findFirst":
    case "count":
    case "aggregate":
    case "groupBy":
    case "findFirstOrThrow":
      return query(mergeWhere(args, context.tenantId));
    case "findUnique":
      return baseDelegate.findFirst(mergeWhere(args, context.tenantId));
    case "findUniqueOrThrow": {
      const record = await baseDelegate.findFirst(
        mergeWhere(args, context.tenantId),
      );

      if (!record) {
        throw new TenantContextError(404, "NOT_FOUND", "Record not found.");
      }

      return record;
    }
    case "create":
      return query({
        ...(args ?? {}),
        data: withTenantData((args ?? {}).data, context.tenantId),
      });
    case "createMany":
      return query({
        ...(args ?? {}),
        data: withTenantData((args ?? {}).data, context.tenantId),
      });
    case "updateMany":
      return query({
        ...(args ?? {}),
        where: mergeWhere(args, context.tenantId).where,
        data: withTenantData((args ?? {}).data, context.tenantId),
      });
    case "deleteMany":
      return query({
        ...(args ?? {}),
        where: mergeWhere(args, context.tenantId).where,
      });
    case "update": {
      const existing = await baseDelegate.findFirst(
        mergeWhere(args, context.tenantId),
      );

      if (!existing || typeof existing !== "object" || !("id" in existing)) {
        throw new TenantContextError(404, "NOT_FOUND", "Record not found.");
      }

      return baseDelegate.update({
        where: { id: (existing as { id: string }).id },
        data: withTenantData((args ?? {}).data, context.tenantId),
      });
    }
    case "delete": {
      const existing = await baseDelegate.findFirst(
        mergeWhere(args, context.tenantId),
      );

      if (!existing || typeof existing !== "object" || !("id" in existing)) {
        throw new TenantContextError(404, "NOT_FOUND", "Record not found.");
      }

      return baseDelegate.delete({
        where: { id: (existing as { id: string }).id },
      });
    }
    case "upsert": {
      const existing = await baseDelegate.findFirst(
        mergeWhere(args, context.tenantId),
      );

      if (existing && typeof existing === "object" && "id" in existing) {
        return baseDelegate.update({
          where: { id: (existing as { id: string }).id },
          data: withTenantData((args ?? {}).update, context.tenantId),
        });
      }

      return baseDelegate.create({
        data: withTenantData((args ?? {}).create, context.tenantId),
      });
    }
    default:
      return query(args);
  }
}

export function getTenantPrisma(context: TenantContext | null | undefined) {
  const tenantContext = assertTenantContext(context);
  const prisma = getPrismaClient();

  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isTenantScopedModel(model)) {
            return query(args);
          }

          return runTenantScopedOperation({
            model,
            operation,
            args: args as AnyArgs,
            query: query as (args: AnyArgs) => Promise<unknown>,
            context: tenantContext,
          });
        },
      },
    },
  });
}
