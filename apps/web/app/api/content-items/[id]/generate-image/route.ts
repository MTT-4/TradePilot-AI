import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { ApiError, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { generateContentItemImageAssets } from "@/server/content-packs/service";

const requestSchema = z.object({
  mode: z
    .enum(["text_to_image", "image_to_image", "background_swap"])
    .default("text_to_image"),
  backgroundStyle: z.string().trim().min(1).max(120).optional(),
  referenceLabel: z.string().trim().min(1).max(120).optional(),
});

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
    const rawBody = await request.text();
    const input = requestSchema.parse(
      rawBody ? JSON.parse(rawBody) : {},
    );
    const params = await routeContext.params;

    return Response.json(
      await generateContentItemImageAssets({
        tenantContext: context,
        itemId: params.id,
        requestedByUserId: userId,
        input,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
