import {
  HitlStatus,
  HitlTaskType,
  JobType,
  KnowledgeSensitivity,
  ModelTaskType,
  Prisma,
  ReplyStatus,
} from "@prisma/client";
import { ZodError, z } from "zod";
import { ApiError } from "@/server/api/errors";
import { hasMinimumRole } from "@/server/auth/rbac";
import { getPrismaClient } from "@/server/db/prisma";
import type { TenantContext } from "@/server/db/tenant-context";
import { hybridSearchKnowledgeChunks } from "@/server/kb/service";
import { createModelGateway } from "@/server/model-gateway";

const requestReplyDraftSchema = z.object({
  inquiryId: z.string().min(1),
});

function parseSchemaOrThrow<T>(schema: z.ZodType<T>, input: unknown) {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError(
        400,
        "VALIDATION",
        "Request body validation failed.",
        error.flatten(),
      );
    }

    throw error;
  }
}

async function createAuditLog(params: {
  tenantId: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const prisma = getPrismaClient();

  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata,
    },
  });
}

async function getAccessibleInquiryOrThrow(params: {
  tenantContext: TenantContext;
  inquiryId: string;
}) {
  const prisma = getPrismaClient();
  const inquiry = await prisma.inquiry.findFirst({
    where: {
      id: params.inquiryId,
      tenantId: params.tenantContext.tenantId,
    },
    select: {
      id: true,
      subject: true,
      body: true,
      fromEmail: true,
      fromName: true,
      createdAt: true,
      lead: {
        select: {
          id: true,
          ownerUserId: true,
          preferredLocale: true,
          companyName: true,
          contact: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!inquiry) {
    throw new ApiError(404, "NOT_FOUND", "Inquiry not found.");
  }

  if (
    params.tenantContext.role === "SALES" &&
    inquiry.lead.ownerUserId !== params.tenantContext.userId
  ) {
    throw new ApiError(403, "FORBIDDEN", "Sales users can only access their own inquiries.");
  }

  return inquiry;
}

export async function requestReplyDraft(params: {
  tenantContext: TenantContext;
  requestedByUserId?: string;
  input: unknown;
  fetchImpl?: typeof fetch;
}) {
  const input = parseSchemaOrThrow(requestReplyDraftSchema, params.input);
  const inquiry = await getAccessibleInquiryOrThrow({
    tenantContext: params.tenantContext,
    inquiryId: input.inquiryId,
  });
  const knowledgeSearch = await hybridSearchKnowledgeChunks({
    tenantContext: params.tenantContext,
    userId: params.requestedByUserId,
    query: [inquiry.subject ?? "", inquiry.body].filter(Boolean).join("\n"),
    allowInternalOnly: true,
    limit: 4,
    fetchImpl: params.fetchImpl,
  });
  const knowledgeItems = knowledgeSearch.items;
  const gateway = createModelGateway({
    fetchImpl: params.fetchImpl,
  });
  const preferredLocale = inquiry.lead.preferredLocale?.toLowerCase() ?? "en";
  const draftResult = await gateway.invoke({
    tenantContext: params.tenantContext,
    userId: params.requestedByUserId,
    taskType: ModelTaskType.GENERATE,
    systemPrompt:
      "You are a B2B export sales assistant. Draft a concise first reply grounded only in the attached knowledge context. Do not invent pricing, lead times, or certifications that are not present in the knowledge. Ask for clarification when required. Return plain text only.",
    prompt: [
      `Reply locale: ${preferredLocale}`,
      `Buyer company: ${inquiry.lead.companyName ?? "unknown"}`,
      `Buyer contact: ${inquiry.lead.contact?.name ?? inquiry.fromName ?? "unknown"}`,
      `Buyer email: ${inquiry.fromEmail ?? inquiry.lead.contact?.email ?? "unknown"}`,
      `Inquiry subject: ${inquiry.subject ?? "N/A"}`,
      `Inquiry body: ${inquiry.body}`,
      "Draft a professional first response and mention that further commercial details can follow after confirmation when the knowledge context does not contain them.",
    ].join("\n"),
    requestSummary: `reply draft ${input.inquiryId}`,
    knowledgeChunks: knowledgeItems.map((item) => ({
      text: item.text,
      sensitivity: item.sensitivity.toUpperCase() as KnowledgeSensitivity,
      sourceCitation: item.sourceCitation,
    })),
    queueOnLocalFailure: {
      type: JobType.GENERATE_REPLY,
      idempotencyKey: `reply-draft:${params.tenantContext.tenantId}:${input.inquiryId}`,
      input: {
        inquiryId: input.inquiryId,
      },
    },
  });
  const prisma = getPrismaClient();
  const created = await prisma.$transaction(async (tx) => {
    const reply = await tx.reply.create({
      data: {
        tenantId: params.tenantContext.tenantId,
        inquiryId: inquiry.id,
        createdByUserId: params.requestedByUserId,
        modelInvocationId: draftResult.invocationId,
        status: ReplyStatus.DRAFT,
        route: draftResult.route,
        draftText: draftResult.text.trim(),
        citations: knowledgeItems
          .filter((item) => item.sourceCitation)
          .slice(0, 4)
          .map((item) => ({
            sourceCitation: item.sourceCitation,
            excerpt: item.text.slice(0, 220),
          })) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        draftText: true,
        citations: true,
      },
    });
    const hitlTask = await tx.hitlTask.create({
      data: {
        tenantId: params.tenantContext.tenantId,
        requestedByUserId: params.requestedByUserId,
        type: HitlTaskType.REPLY_SEND,
        status: HitlStatus.PENDING,
        entityType: "reply",
        entityId: reply.id,
        payload: {
          replyId: reply.id,
          inquiryId: inquiry.id,
        },
      },
      select: {
        id: true,
      },
    });
    await tx.reply.update({
      where: {
        id: reply.id,
      },
      data: {
        status: ReplyStatus.PENDING_APPROVAL,
      },
    });

    return {
      replyId: reply.id,
      draftText: reply.draftText,
      citations: reply.citations,
      hitlTaskId: hitlTask.id,
    };
  });

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.requestedByUserId,
    action: "reply_draft_created",
    entityType: "reply",
    entityId: created.replyId,
    metadata: {
      inquiryId: inquiry.id,
      hitlTaskId: created.hitlTaskId,
    },
  });
  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.requestedByUserId,
    action: "reply_send_requested",
    entityType: "reply",
    entityId: created.replyId,
    metadata: {
      inquiryId: inquiry.id,
      hitlTaskId: created.hitlTaskId,
    },
  });

  return {
    replyId: created.replyId,
    draftText: created.draftText,
    citations: created.citations,
    hitlTaskId: created.hitlTaskId,
  };
}

export async function approveReplySendTask(params: {
  tenantContext: TenantContext;
  hitlTaskId: string;
  replyId: string;
  approvedByUserId?: string;
}) {
  if (!hasMinimumRole(params.tenantContext.role, "SALES")) {
    throw new ApiError(403, "FORBIDDEN", "Reply send approval requires sales role or higher.");
  }

  const prisma = getPrismaClient();
  const reply = await prisma.reply.findFirst({
    where: {
      id: params.replyId,
      tenantId: params.tenantContext.tenantId,
    },
    select: {
      id: true,
      status: true,
      draftText: true,
      inquiryId: true,
    },
  });

  if (!reply) {
    throw new ApiError(404, "NOT_FOUND", "Reply not found.");
  }

  if (reply.status !== ReplyStatus.PENDING_APPROVAL) {
    throw new ApiError(409, "CONFLICT", "Reply is not pending approval.");
  }

  await prisma.reply.update({
    where: {
      id: reply.id,
    },
    data: {
      status: ReplyStatus.SENT,
      approvedByUserId: params.approvedByUserId,
      finalText: reply.draftText,
      sentAt: new Date(),
    },
  });

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.approvedByUserId,
    action: "reply_sent",
    entityType: "reply",
    entityId: reply.id,
    metadata: {
      inquiryId: reply.inquiryId,
      hitlTaskId: params.hitlTaskId,
    },
  });
}
