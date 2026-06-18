import { JobType, MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { enqueueTenantJob } from "@/server/jobs/service";

const enqueueJobSchema = z.object({
  type: z
    .enum([
      "parse_document",
      "embed_document",
      "generate_site",
      "translate_site",
      "generate_content_pack",
      "generate_reply",
      "import_inbound_email",
    ])
    .transform((value) => value.toUpperCase() as JobType),
  input: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
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
      MembershipRole.OPERATOR,
    );
    const input = await parseJsonBody(request, enqueueJobSchema);
    const result = await enqueueTenantJob({
      tenantContext: context,
      requestedByUserId: userId,
      type: input.type,
      input: input.input,
      idempotencyKey: input.idempotencyKey,
      maxAttempts: input.maxAttempts,
    });

    return Response.json(result, { status: 202 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
