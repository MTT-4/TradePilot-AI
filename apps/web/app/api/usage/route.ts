import { MembershipRole, Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { errorJson, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";

function toDecimalString(value: Prisma.Decimal | null | undefined) {
  return value ? value.toString() : "0";
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

    const [balanceAggregate, recent] = await Promise.all([
      tenantPrisma.creditLedger.aggregate({
        _sum: {
          deltaCredits: true,
        },
      }),
      tenantPrisma.modelInvocation.findMany({
        orderBy: {
          createdAt: "desc",
        },
        take: 20,
        select: {
          id: true,
          route: true,
          taskType: true,
          modelName: true,
          containsPii: true,
          tokensInput: true,
          tokensOutput: true,
          latencyMs: true,
          costUsd: true,
          createdAt: true,
        },
      }),
    ]);

    const totalTokensInput = recent.reduce((sum, item) => sum + (item.tokensInput ?? 0), 0);
    const totalTokensOutput = recent.reduce((sum, item) => sum + (item.tokensOutput ?? 0), 0);
    const totalLatency = recent.reduce((sum, item) => sum + (item.latencyMs ?? 0), 0);
    const totalCostUsd = recent.reduce(
      (sum, item) => sum + Number(item.costUsd?.toString() ?? "0"),
      0,
    );
    const piiInvocationCount = recent.filter((item) => item.containsPii).length;
    const routeBreakdown = Object.entries(
      recent.reduce<Record<string, number>>((acc, item) => {
        const key = item.route.toLowerCase();
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    ).map(([route, count]) => ({
      route,
      count,
    }));

    return Response.json({
      creditsBalance: toDecimalString(balanceAggregate._sum.deltaCredits),
      summary: {
        recentInvocationCount: recent.length,
        piiInvocationCount,
        totalTokensInput,
        totalTokensOutput,
        averageLatencyMs: recent.length > 0 ? Math.round(totalLatency / recent.length) : 0,
        totalCostUsd: totalCostUsd.toFixed(4),
        routeBreakdown,
      },
      recent: recent.map((item) => ({
        id: item.id,
        route: item.route.toLowerCase(),
        taskType: item.taskType.toLowerCase(),
        modelName: item.modelName,
        containsPii: item.containsPii,
        tokensInput: item.tokensInput,
        tokensOutput: item.tokensOutput,
        latencyMs: item.latencyMs,
        costUsd: toDecimalString(item.costUsd),
        createdAt: item.createdAt,
      })),
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
