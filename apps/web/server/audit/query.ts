import type { TenantContext } from "@/server/db/tenant-context";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import { normalizeLimit } from "@/server/skills/access";

/**
 * Tool: audit_log（审计日志查询，只读）
 * 纯本地、纯新增：读现有 AuditLog 表（basic_log 写入的也在内）。不修改 data-requests 现有模块。
 */
export async function listAuditLogs(params: {
  tenantContext: TenantContext;
  action?: string;
  entityType?: string;
  limit?: number;
}) {
  const prisma = getTenantPrisma(params.tenantContext);
  const take = normalizeLimit(params.limit, 50, 200);

  const rows = await prisma.auditLog.findMany({
    where: {
      ...(params.action ? { action: params.action } : {}),
      ...(params.entityType ? { entityType: params.entityType } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      actorUserId: true,
      metadata: true,
      createdAt: true,
    },
  });

  return {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actorUserId: r.actorUserId,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
