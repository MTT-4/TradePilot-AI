import { MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { ApiError, parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { hybridSearchKnowledgeChunks } from "@/server/kb/service";

const searchRequestSchema = z.object({
  query: z.string().trim().min(1).max(1000),
  limit: z.number().int().min(1).max(10).optional(),
  allowInternalOnly: z.boolean().optional(),
  filters: z
    .object({
      product: z.string().trim().min(1).max(120).optional(),
      market: z.string().trim().min(1).max(120).optional(),
    })
    .optional(),
});

function assertInternalOnlyAccess(request: Request, allowInternalOnly: boolean) {
  if (!allowInternalOnly) {
    return;
  }

  const routeHint = request.headers.get("x-tradepilot-internal-route");

  if (routeHint !== "local_qwen") {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "allowInternalOnly is restricted to internal local_qwen retrieval paths.",
    );
  }
}

export const POST = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      throw new ApiError(401, "UNAUTHENTICATED", "Login required.");
    }

    const { context } = await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.VIEWER,
    );
    const input = await parseJsonBody(request, searchRequestSchema);
    assertInternalOnlyAccess(request, input.allowInternalOnly ?? false);

    return Response.json(
      await hybridSearchKnowledgeChunks({
        tenantContext: context,
        userId,
        query: input.query,
        limit: input.limit,
        allowInternalOnly: input.allowInternalOnly,
        product: input.filters?.product,
        market: input.filters?.market,
      }),
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
