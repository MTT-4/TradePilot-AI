import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { referenceKnowledge } from "@/server/kb/knowledge-reference";

const requestSchema = z.object({
  query: z.string().min(1),
  requiredFields: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

export const POST = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      return Response.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Login required.",
            details: {},
          },
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
    const result = await referenceKnowledge({
      tenantContext: context,
      userId,
      query: input.query,
      requiredFields: input.requiredFields,
      limit: input.limit,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
