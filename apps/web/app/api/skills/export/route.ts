import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { routeErrorToResponse } from "@/server/api/errors";
import { EXPORT_TYPES, buildExport, type ExportType } from "@/server/exports/service";
import { parsePositiveIntegerParam } from "@/server/skills/access";

// 数据导出（ADMIN，写审计）。GET /api/skills/export?type=leads|inquiries|activities&limit=
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
    const type = params.get("type") ?? "";
    if (!EXPORT_TYPES.includes(type as ExportType)) {
      return Response.json(
        {
          error: {
            code: "VALIDATION",
            message: `type must be one of: ${EXPORT_TYPES.join(", ")}.`,
            details: {},
          },
        },
        { status: 400 },
      );
    }
    const limit = parsePositiveIntegerParam(params.get("limit"), "limit");
    const result = await buildExport({
      tenantContext: context,
      userId,
      type: type as ExportType,
      limit,
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
