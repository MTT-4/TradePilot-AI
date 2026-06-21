import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { answerTechAssistant } from "@/server/agents/tech-assistant";

const requestSchema = z.object({
  question: z.string().trim().min(1).max(4000),
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
      MembershipRole.OPERATOR,
    );
    const input = await parseJsonBody(request, requestSchema);
    const result = await answerTechAssistant({
      tenantContext: context,
      userId,
      question: input.question,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
