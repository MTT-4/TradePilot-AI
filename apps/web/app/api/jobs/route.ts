import { JobStatus, JobType, MembershipRole } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/server/auth/access";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { enqueueTenantJob, listTenantJobs } from "@/server/jobs/service";

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

const listJobsQuerySchema = z.object({
  status: z
    .enum(["queued", "running", "retrying", "succeeded", "failed"])
    .transform((value) => value.toUpperCase() as JobStatus)
    .optional(),
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
    .transform((value) => value.toUpperCase() as JobType)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const GET = auth(async (request) => {
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
      MembershipRole.VIEWER,
    );
    const parsed = listJobsQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    const jobs = await listTenantJobs(context, parsed);

    return Response.json({
      items: jobs.map((job) => ({
        id: job.id,
        type: job.type.toLowerCase(),
        status: job.status.toLowerCase(),
        progress: job.progress,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        error: job.error,
        input: job.input,
        output: job.output,
        requestedByUserId: job.requestedByUserId,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
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
