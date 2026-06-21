import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { ApiError, parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { createContentPackGenerationRequest } from "@/server/content-packs/service";
import { z } from "zod";

const requestSchema = z.object({
  campaignId: z.string().min(1).optional(),
  topic: z.string().trim().min(1).max(160),
  market: z.string().trim().min(1).max(120).optional(),
  locales: z.array(z.enum(["en", "ar", "ru", "fr", "de", "pt"])).min(1).max(6),
  platforms: z
    .array(
      z.enum([
        "linkedin",
        "facebook",
        "instagram",
        "reels",
        "tiktok",
        "youtube",
        "shorts",
        "vk_clips",
        "rutube",
      ]),
    )
    .min(1)
    .max(9)
    .optional(),
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

    return Response.json(
      await createContentPackGenerationRequest({
        tenantContext: context,
        requestedByUserId: userId,
        input,
      }),
      { status: 202 },
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
