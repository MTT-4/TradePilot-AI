import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { routeErrorToResponse } from "@/server/api/errors";
import { convertCurrency } from "@/server/currency/service";

// 汇率换算（参考，mock）。GET /api/skills/currency-rate?from=USD&to=EUR&amount=100
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

    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? "USD";
    const to = url.searchParams.get("to") ?? "USD";
    const amountRaw = url.searchParams.get("amount");
    const amount = amountRaw == null ? undefined : Number(amountRaw);
    if (amountRaw != null && Number.isNaN(amount)) {
      return Response.json(
        { error: { code: "VALIDATION", message: "amount must be a number.", details: {} } },
        { status: 400 },
      );
    }

    const result = convertCurrency({ from, to, amount });
    return Response.json(result, { status: 200 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
