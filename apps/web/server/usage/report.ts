import type { TenantContext } from "@/server/db/tenant-context";
import { getTenantPrisma } from "@/server/db/tenant-prisma";

/**
 * Tool: billing_usage（用量计量，只读）
 * 纯本地、纯新增：基于现有 ModelInvocation 统计 AI 调用量，不接 Stripe、不修改现有 usage 模块。
 */
export async function usageReport(tenantContext: TenantContext) {
  const prisma = getTenantPrisma(tenantContext);

  const [byRoute, byTask, totals] = await Promise.all([
    prisma.modelInvocation.groupBy({
      by: ["route"],
      _count: { _all: true },
      _sum: { tokensInput: true, tokensOutput: true },
    }),
    prisma.modelInvocation.groupBy({
      by: ["taskType"],
      _count: { _all: true },
    }),
    prisma.modelInvocation.aggregate({
      _count: { _all: true },
      _sum: { tokensInput: true, tokensOutput: true, costUsd: true },
    }),
  ]);

  return {
    total_invocations: totals._count._all,
    total_tokens_input: totals._sum.tokensInput ?? 0,
    total_tokens_output: totals._sum.tokensOutput ?? 0,
    total_cost_usd: totals._sum.costUsd ? Number(totals._sum.costUsd) : 0,
    by_route: byRoute.map((r) => ({
      route: r.route.toLowerCase(),
      count: r._count._all,
      tokens_input: r._sum.tokensInput ?? 0,
      tokens_output: r._sum.tokensOutput ?? 0,
    })),
    by_task: byTask.map((r) => ({
      task: r.taskType.toLowerCase(),
      count: r._count._all,
    })),
  };
}
