import type { TenantContext } from "@/server/db/tenant-context";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import { inquiryAnalysisSchema } from "@/server/leads/inquiry-detection";

/**
 * Skills: sales_funnel_analysis / product_hotspot_analysis / team_performance_analysis
 * 纯本地、纯新增、只读现有表。不修改 dashboard 等现有文件（如需并入 UI 另行批准）。
 */

export async function salesFunnel(tenantContext: TenantContext) {
  const prisma = getTenantPrisma(tenantContext);
  const [leadsByStatus, inquiries, replies, oppsByStage] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.inquiry.count(),
    prisma.reply.count(),
    prisma.opportunity.groupBy({ by: ["stage"], _count: { _all: true } }),
  ]);

  return {
    leads_by_status: leadsByStatus.map((r) => ({
      status: r.status.toLowerCase(),
      count: r._count._all,
    })),
    inquiries_total: inquiries,
    replies_total: replies,
    opportunities_by_stage: oppsByStage.map((r) => ({
      stage: r.stage.toLowerCase(),
      count: r._count._all,
    })),
  };
}

export async function productHotspot(tenantContext: TenantContext, topN = 10) {
  const prisma = getTenantPrisma(tenantContext);
  const rows = await prisma.inquiry.findMany({
    select: { rawPayload: true },
    take: 1000,
    orderBy: { createdAt: "desc" },
  });

  const tally = new Map<string, number>();
  for (const row of rows) {
    const raw =
      row.rawPayload && typeof row.rawPayload === "object"
        ? (row.rawPayload as Record<string, unknown>)
        : {};
    const analysisRaw = raw.analysis;
    if (!analysisRaw || typeof analysisRaw !== "object") continue;
    const parsed = inquiryAnalysisSchema.safeParse(analysisRaw);
    if (!parsed.success) continue;
    const product = parsed.data.product_interest.trim().toLowerCase();
    if (!product) continue;
    tally.set(product, (tally.get(product) ?? 0) + 1);
  }

  const top = Array.from(tally.entries())
    .map(([product, count]) => ({ product, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);

  return { analyzed_inquiries: rows.length, top_products: top };
}

export async function teamPerformance(tenantContext: TenantContext) {
  const prisma = getTenantPrisma(tenantContext);
  const [leadsByOwner, repliesByCreator, activitiesByActor] = await Promise.all([
    prisma.lead.groupBy({ by: ["ownerUserId"], _count: { _all: true } }),
    prisma.reply.groupBy({ by: ["createdByUserId"], _count: { _all: true } }),
    prisma.crmActivity.groupBy({ by: ["actorUserId"], _count: { _all: true } }),
  ]);

  const byUser = new Map<string, { leads: number; replies: number; activities: number }>();
  const bump = (id: string | null, key: "leads" | "replies" | "activities", n: number) => {
    if (!id) return;
    const cur = byUser.get(id) ?? { leads: 0, replies: 0, activities: 0 };
    cur[key] += n;
    byUser.set(id, cur);
  };
  leadsByOwner.forEach((r) => bump(r.ownerUserId, "leads", r._count._all));
  repliesByCreator.forEach((r) => bump(r.createdByUserId, "replies", r._count._all));
  activitiesByActor.forEach((r) => bump(r.actorUserId, "activities", r._count._all));

  const userIds = Array.from(byUser.keys());
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return {
    members: userIds.map((id) => ({
      userId: id,
      name: nameById.get(id) ?? "",
      ...byUser.get(id)!,
    })),
    note: "指标仅供参考，回复/跟进计数不等同绩效结论。",
  };
}
