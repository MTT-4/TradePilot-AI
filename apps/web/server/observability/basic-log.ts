import { Prisma } from "@prisma/client";
import { getPrismaClient } from "@/server/db/prisma";

/**
 * Tool: basic_log（基础日志）
 * 纯本地、纯新增：把 skill/tool 的关键事件写进现有 AuditLog 表，不接任何第三方监控。
 * 供本地新增的 skill 复用，统一一个落点；不外发任何数据。
 */
export async function logSkillEvent(params: {
  tenantId: string;
  actorUserId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType ?? "skill_event",
      entityId: params.entityId ?? params.action,
      metadata: params.metadata,
    },
  });
}
