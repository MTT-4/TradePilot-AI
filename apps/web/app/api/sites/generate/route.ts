import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { ApiError, parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { createSiteGenerationRequest } from "@/server/sites/service";

const requestSchema = z.object({
  brief: z.object({
    market: z.string().trim().min(1).max(120),
    product: z.string().trim().min(1).max(120),
    locales: z.array(z.enum(["en", "ar", "ru", "fr", "de", "pt"])).min(1).max(6),
    style: z.string().trim().min(1).max(120),
    cta: z.string().trim().min(1).max(120),
  }),
  assetIds: z.array(z.string().trim().min(1)).max(24).optional(),
  knowledgeDocumentIds: z.array(z.string().trim().min(1)).max(24).optional(),
  referenceBrandKit: z.boolean().optional(),
});

export const POST = auth(async (request) => {
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
    const result = await createSiteGenerationRequest({
      tenantContext: context,
      requestedByUserId: userId,
      brief: input.brief,
      assetIds: input.assetIds,
      knowledgeDocumentIds: input.knowledgeDocumentIds,
      referenceBrandKit: input.referenceBrandKit,
    });

    return Response.json(result, { status: 202 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
