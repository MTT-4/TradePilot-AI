import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import {
  getQuotationRule,
  quotationRuleSchema,
  updateQuotationRule,
} from "@/server/quotation/rules";

function unauthenticated() {
  return Response.json(
    { error: { code: "UNAUTHENTICATED", message: "Login required.", details: {} } },
    { status: 401 },
  );
}

// 读取当前报价规则（SALES 及以上）。
export const GET = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;
    if (!userId) return unauthenticated();

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.SALES,
    );
    const rule = await getQuotationRule(context);
    return Response.json(rule, { status: 200 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});

// 更新报价规则（仅 ADMIN 及以上，写审计日志）。
export const PUT = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;
    if (!userId) return unauthenticated();

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.ADMIN,
    );
    const input = await parseJsonBody(request, quotationRuleSchema);
    const rule = await updateQuotationRule({
      tenantContext: context,
      actorUserId: userId,
      input,
    });
    return Response.json(rule, { status: 200 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
