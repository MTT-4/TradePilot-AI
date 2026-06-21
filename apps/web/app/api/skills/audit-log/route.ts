import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { routeErrorToResponse } from "@/server/api/errors";
import { listAuditLogs } from "@/server/audit/query";
import { parsePositiveIntegerParam } from "@/server/skills/access";

// 审计日志查询（ADMIN）。GET /api/skills/audit-log?action=&entityType=&limit=
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
    const params = new URL(request.url).searchParams;
    const limit = parsePositiveIntegerParam(params.get("limit"), "limit");
    const result = await listAuditLogs({
      tenantContext: context,
      action: params.get("action") ?? undefined,
      entityType: params.get("entityType") ?? undefined,
      limit,
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
