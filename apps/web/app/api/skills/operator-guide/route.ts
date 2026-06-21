import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { answerOperatorGuide } from "@/server/agents/operator-guide";

const requestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
});

export const POST = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return Response.json(
        {
          error: { code: "UNAUTHENTICATED", message: "Login required.", details: {} },
        },
        { status: 401 },
      );
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.SALES,
    );
    const input = await parseJsonBody(request, requestSchema);
    const result = await answerOperatorGuide({
      tenantContext: context,
      userId,
      question: input.question,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
