import { z } from "zod";
import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { ApiError, parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { reviewKnowledgeCard } from "@/server/kb/service";

const reviewActionSchema = z
  .object({
    action: z.enum(["approve", "correct"]),
    correctedText: z.string().trim().min(1).optional(),
    sensitivity: z.enum(["public", "internal_only"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "correct" && !value.correctedText?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "correctedText is required when action is correct.",
        path: ["correctedText"],
      });
    }
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
    const input = await parseJsonBody(request, reviewActionSchema);
    const params = await routeContext.params;

    return Response.json(
      await reviewKnowledgeCard({
        tenantContext: context,
        reviewId: params.id,
        reviewedByUserId: userId,
        action: input.action,
        correctedText: input.correctedText,
        sensitivity: input.sensitivity,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
