import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { generateFollowUpPlan } from "@/server/follow-up/scheduler";

const requestSchema = z.object({
  leadId: z.string().min(1).optional(),
  inquiryId: z.string().min(1).optional(),
  offsets: z.array(z.number().int().positive()).max(10).optional(),
  persist: z.boolean().optional(),
  startDate: z.string().optional(),
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
    const result = await generateFollowUpPlan({
      tenantContext: context,
      userId,
      input,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
