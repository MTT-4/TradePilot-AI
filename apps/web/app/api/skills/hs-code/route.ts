import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { routeErrorToResponse } from "@/server/api/errors";
import { COMPLIANCE_DISCLAIMER, suggestHsCode } from "@/server/compliance/rules";

// HS Code 候选（参考）。GET /api/skills/hs-code?q=led+panel+light
export const GET = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;
    if (!userId) {
      return Response.json(
        { error: { code: "UNAUTHENTICATED", message: "Login required.", details: {} } },
        { status: 401 },
      );
    }

    await requireTenantAccess(request.headers, userId, MembershipRole.SALES);

    const q = new URL(request.url).searchParams.get("q") ?? "";
    if (!q.trim()) {
      return Response.json(
        { error: { code: "VALIDATION", message: "q is required.", details: {} } },
        { status: 400 },
      );
    }

    return Response.json(
      { query: q, candidates: suggestHsCode(q), disclaimer: COMPLIANCE_DISCLAIMER },
      { status: 200 },
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
