import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { routeErrorToResponse } from "@/server/api/errors";
import { productHotspot, salesFunnel, teamPerformance } from "@/server/analytics/service";

// 管理分析（ADMIN）。GET /api/skills/analytics?report=funnel|hotspot|team
export const GET = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;
    if (!userId) {
      return Response.json(
        { error: { code: "UNAUTHENTICATED", message: "Login required.", details: {} } },
        { status: 401 },
      );
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.ADMIN,
    );
    const report = new URL(request.url).searchParams.get("report") ?? "funnel";

    let result: unknown;
    if (report === "hotspot") result = await productHotspot(context);
    else if (report === "team") result = await teamPerformance(context);
    else result = await salesFunnel(context);

    return Response.json({ report, data: result }, { status: 200 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
