import {
  JobType,
  KnowledgeSensitivity,
  ModelTaskType,
  Prisma,
} from "@prisma/client";
import { z } from "zod";
import { parseJsonBody, routeErrorToResponse } from "@/server/api/errors";
import { resolveTenantContext } from "@/server/db/tenant-context";
import { createModelGateway } from "@/server/model-gateway";

const knowledgeChunkSchema = z.object({
  text: z.string().min(1),
  sensitivity: z
    .enum(["public", "internal_only"])
    .transform((value) => value.toUpperCase() as KnowledgeSensitivity),
  sourceCitation: z.string().optional(),
});

const llmProbeSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("invoke"),
    prompt: z.string().min(1),
    systemPrompt: z.string().optional(),
    requestSummary: z.string().optional(),
    sensitivity: z
      .enum(["public", "internal_only"])
      .transform((value) => value.toUpperCase() as KnowledgeSensitivity)
      .optional(),
    knowledgeChunks: z.array(knowledgeChunkSchema).optional(),
    queueOnLocalFailure: z
      .object({
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
        idempotencyKey: z.string().optional(),
        input: z.record(z.string(), z.unknown()),
      })
      .optional(),
  }),
  z.object({
    operation: z.literal("translate"),
    text: z.string().min(1),
    targetLocale: z.string().min(2),
    sourceLocale: z.string().optional(),
    requestSummary: z.string().optional(),
    sensitivity: z
      .enum(["public", "internal_only"])
      .transform((value) => value.toUpperCase() as KnowledgeSensitivity)
      .optional(),
    knowledgeChunks: z.array(knowledgeChunkSchema).optional(),
    queueOnLocalFailure: z
      .object({
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
        idempotencyKey: z.string().optional(),
        input: z.record(z.string(), z.unknown()),
      })
      .optional(),
  }),
  z.object({
    operation: z.literal("embed"),
    text: z.string().min(1),
    requestSummary: z.string().optional(),
    sensitivity: z
      .enum(["public", "internal_only"])
      .transform((value) => value.toUpperCase() as KnowledgeSensitivity)
      .optional(),
    queueOnLocalFailure: z
      .object({
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
        idempotencyKey: z.string().optional(),
        input: z.record(z.string(), z.unknown()),
      })
      .optional(),
  }),
]);

export async function POST(request: Request) {
  try {
    const tenantContext = await resolveTenantContext(request.headers);
    const input = await parseJsonBody(request, llmProbeSchema);
    const gateway = createModelGateway();
    const queueOnLocalFailure = input.queueOnLocalFailure
      ? {
          ...input.queueOnLocalFailure,
          input: input.queueOnLocalFailure.input as Prisma.InputJsonValue,
        }
      : undefined;

    if (input.operation === "invoke") {
      const result = await gateway.invoke({
        tenantContext,
        userId: tenantContext.userId,
        taskType: ModelTaskType.GENERATE,
        prompt: input.prompt,
        systemPrompt: input.systemPrompt,
        requestSummary: input.requestSummary,
        sensitivity: input.sensitivity,
        knowledgeChunks: input.knowledgeChunks,
        queueOnLocalFailure,
      });

      return Response.json(result);
    }

    if (input.operation === "translate") {
      const result = await gateway.translate({
        tenantContext,
        userId: tenantContext.userId,
        taskType: ModelTaskType.TRANSLATE,
        text: input.text,
        targetLocale: input.targetLocale,
        sourceLocale: input.sourceLocale,
        requestSummary: input.requestSummary,
        sensitivity: input.sensitivity,
        knowledgeChunks: input.knowledgeChunks,
        queueOnLocalFailure,
      });

      return Response.json(result);
    }

    if (input.operation === "embed") {
      const result = await gateway.embed({
        tenantContext,
        userId: tenantContext.userId,
        taskType: ModelTaskType.EMBED,
        text: input.text,
        requestSummary: input.requestSummary,
        sensitivity: input.sensitivity,
        queueOnLocalFailure,
      });

      if (!result) {
        throw new Error("Embed probe returned no result.");
      }

      const embeddingLength = result.embedding.length;

      return Response.json({
        ...result,
        embeddingLength,
      });
    }

    return Response.json(
      {
        error: {
          code: "VALIDATION",
          message: "Unsupported probe operation.",
          details: {},
        },
      },
      { status: 400 },
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
