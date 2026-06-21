import { ApiError } from "@/server/api/errors";
import type { TenantContext } from "@/server/db/tenant-context";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import { normalizeLimit } from "@/server/skills/access";
import { logSkillEvent } from "@/server/observability/basic-log";

/**
 * Tool: export（数据导出，只读 + 审计）
 * 纯本地、纯新增：读现有表导出为结构化行，导出动作写 AuditLog。不修改现有 content-packs export。
 */

export const EXPORT_TYPES = ["leads", "inquiries", "activities"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

export async function buildExport(params: {
  tenantContext: TenantContext;
  userId?: string;
  type: ExportType;
  limit?: number;
}) {
  const prisma = getTenantPrisma(params.tenantContext);
  const tid = params.tenantContext.tenantId;
  const take = normalizeLimit(params.limit, 500, 5000);

  let rows: Record<string, unknown>[];
  switch (params.type) {
    case "leads":
      rows = (
        await prisma.lead.findMany({
          take,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            companyName: true,
            country: true,
            status: true,
            score: true,
            createdAt: true,
          },
        })
      ).map((r) => ({
        id: r.id,
        company: r.companyName ?? "",
        country: r.country ?? "",
        status: r.status.toLowerCase(),
        score: r.score ?? "",
        createdAt: r.createdAt.toISOString(),
      }));
      break;
    case "inquiries":
      rows = (
        await prisma.inquiry.findMany({
          take,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            subject: true,
            fromEmail: true,
            sourceType: true,
            leadId: true,
            createdAt: true,
          },
        })
      ).map((r) => ({
        id: r.id,
        subject: r.subject ?? "",
        fromEmail: r.fromEmail ?? "",
        source: r.sourceType.toLowerCase(),
        leadId: r.leadId,
        createdAt: r.createdAt.toISOString(),
      }));
      break;
    case "activities":
      rows = (
        await prisma.crmActivity.findMany({
          take,
          orderBy: { createdAt: "desc" },
          select: { id: true, leadId: true, type: true, body: true, createdAt: true },
        })
      ).map((r) => ({
        id: r.id,
        leadId: r.leadId ?? "",
        type: r.type.toLowerCase(),
        body: r.body,
        createdAt: r.createdAt.toISOString(),
      }));
      break;
    default:
      throw new ApiError(400, "VALIDATION", "Unknown export type.");
  }

  // 导出是敏感操作：写审计日志。
  await logSkillEvent({
    tenantId: tid,
    actorUserId: params.userId,
    action: "data_exported",
    entityType: "export",
    entityId: params.type,
    metadata: { type: params.type, count: rows.length },
  });

  return { type: params.type, count: rows.length, rows };
}
