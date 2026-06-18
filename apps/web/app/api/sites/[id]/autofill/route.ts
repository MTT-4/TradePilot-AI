import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { ApiError, parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import {
  generateSiteAutofillCandidates,
  requestSitePublish,
  updateAutofillCandidate,
} from "@/server/sites/service";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("generate"),
  }),
  z.object({
    action: z.literal("update"),
    candidateId: z.string().min(1),
    title: z.string().trim().min(1).max(160).optional(),
    summary: z.string().trim().min(1).max(320).optional(),
    body: z.string().trim().min(1).max(1600).optional(),
  }),
  z.object({
    action: z.literal("confirm"),
    candidateId: z.string().min(1),
  }),
]);

export const POST = auth(async (request, routeContext) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      throw new ApiError(401, "UNAUTHENTICATED", "Login required.");
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.OPERATOR,
    );
    const input = await parseJsonBody(request, requestSchema);
    const params = await routeContext.params;

    if (input.action === "generate") {
      return Response.json(
        await generateSiteAutofillCandidates({
          tenantContext: context,
          siteId: params.id,
          requestedByUserId: userId,
        }),
      );
    }

    if (input.action === "update") {
      return Response.json(
        await updateAutofillCandidate({
          tenantContext: context,
          siteId: params.id,
          candidateId: input.candidateId,
          requestedByUserId: userId,
          title: input.title,
          summary: input.summary,
          body: input.body,
        }),
      );
    }

    return Response.json(
      await requestSitePublish({
        tenantContext: context,
        siteId: params.id,
        requestedByUserId: userId,
        mode: "autofill_candidate",
        candidateId: input.candidateId,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
