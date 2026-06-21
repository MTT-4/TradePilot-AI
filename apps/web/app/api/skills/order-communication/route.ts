import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { ORDER_STAGES, buildOrderMessage } from "@/server/orders/communication";

const requestSchema = z.object({
  stage: z.enum(ORDER_STAGES),
  leadId: z.string().min(1).optional(),
  inquiryId: z.string().min(1).optional(),
  facts: z.record(z.string(), z.string()).optional(),
});

export const POST = auth(async (request) => {
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
      MembershipRole.SALES,
    );
    const input = await parseJsonBody(request, requestSchema);
    const result = await buildOrderMessage({
      tenantContext: context,
      userId,
      input,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
