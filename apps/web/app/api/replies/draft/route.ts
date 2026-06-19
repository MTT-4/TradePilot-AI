import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requestReplyDraft } from "@/server/replies/service";

const requestSchema = z.object({
  inquiryId: z.string().min(1),
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
    const result = await requestReplyDraft({
      tenantContext: context,
      requestedByUserId: userId,
      input,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
