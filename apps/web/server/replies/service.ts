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

export const updateReplyDraftSchema = z.object({
  draftText: z.string().trim().min(1).max(8000),
});

export const rejectReplySchema = z.object({
  reason: z.string().trim().max(240).optional(),
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

async function getAccessibleReplyOrThrow(params: {
  tenantContext: TenantContext;
  replyId: string;
}) {
  const prisma = getPrismaClient();
  const reply = await prisma.reply.findFirst({
    where: {
      id: params.replyId,
      tenantId: params.tenantContext.tenantId,
    },
    select: {
      id: true,
      status: true,
      route: true,
      draftText: true,
      finalText: true,
      citations: true,
      createdAt: true,
      updatedAt: true,
      sentAt: true,
      inquiry: {
        select: {
          id: true,
          subject: true,
          body: true,
          fromEmail: true,
          fromName: true,
          sourceType: true,
          createdAt: true,
          lead: {
            select: {
              id: true,
              ownerUserId: true,
              companyName: true,
              preferredLocale: true,
              contact: {
                select: {
                  name: true,
                  email: true,
                  preferredLocale: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!reply) {
    throw new ApiError(404, "NOT_FOUND", "Reply not found.");
  }

  if (
    params.tenantContext.role === "SALES" &&
    reply.inquiry.lead.ownerUserId !== params.tenantContext.userId
  ) {
    throw new ApiError(403, "FORBIDDEN", "Sales users can only access their own replies.");
  }

  return reply;
}

async function getPendingReplyTask(params: {
  tenantId: string;
  replyId: string;
}) {
  const prisma = getPrismaClient();
  return prisma.hitlTask.findFirst({
    where: {
      tenantId: params.tenantId,
      type: HitlTaskType.REPLY_SEND,
      entityType: "reply",
      entityId: params.replyId,
      status: HitlStatus.PENDING,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      payload: true,
    },
  });
}

function toReplyDetailResponse(params: {
  reply: Awaited<ReturnType<typeof getAccessibleReplyOrThrow>>;
  hitlTaskId: string | null;
  translatedBody?: string | null;
}) {
  const preferredLocale =
    params.reply.inquiry.lead.contact?.preferredLocale ??
    params.reply.inquiry.lead.preferredLocale ??
    null;

  return {
    reply: {
      id: params.reply.id,
      status: params.reply.status.toLowerCase(),
      route: params.reply.route.toLowerCase(),
      draftText: params.reply.draftText,
      finalText: params.reply.finalText,
      citations:
        Array.isArray(params.reply.citations) ? params.reply.citations : [],
      hitlTaskId: params.hitlTaskId,
      createdAt: params.reply.createdAt.toISOString(),
      updatedAt: params.reply.updatedAt.toISOString(),
      sentAt: params.reply.sentAt?.toISOString() ?? null,
      inquiry: {
        id: params.reply.inquiry.id,
        subject: params.reply.inquiry.subject,
        body: params.reply.inquiry.body,
        translatedBody: params.translatedBody ?? null,
        fromEmail: params.reply.inquiry.fromEmail,
        fromName: params.reply.inquiry.fromName,
        sourceType: params.reply.inquiry.sourceType.toLowerCase(),
        createdAt: params.reply.inquiry.createdAt.toISOString(),
        lead: {
          id: params.reply.inquiry.lead.id,
          companyName: params.reply.inquiry.lead.companyName,
          preferredLocale: preferredLocale?.toLowerCase() ?? null,
          contactName: params.reply.inquiry.lead.contact?.name ?? null,
          contactEmail: params.reply.inquiry.lead.contact?.email ?? null,
        },
      },
    },
  };
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
          company: inquiry.lead.companyName ?? null,
          leadName: inquiry.lead.contact?.name ?? inquiry.fromName ?? null,
          inquiryPreview: inquiry.body.slice(0, 220),
          draftText: reply.draftText,
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

export async function getReplyDetail(params: {
  tenantContext: TenantContext;
  replyId: string;
  requestedByUserId?: string;
  fetchImpl?: typeof fetch;
  includeTranslation?: boolean;
}) {
  if (!hasMinimumRole(params.tenantContext.role, "SALES")) {
    throw new ApiError(403, "FORBIDDEN", "Reply review requires sales role or higher.");
  }

  const reply = await getAccessibleReplyOrThrow({
    tenantContext: params.tenantContext,
    replyId: params.replyId,
  });
  const task = await getPendingReplyTask({
    tenantId: params.tenantContext.tenantId,
    replyId: params.replyId,
  });

  let translatedBody: string | null = null;

  if (params.includeTranslation !== false) {
    try {
      const gateway = createModelGateway({
        fetchImpl: params.fetchImpl,
      });
      const translation = await gateway.translate({
        tenantContext: params.tenantContext,
        userId: params.requestedByUserId,
        taskType: ModelTaskType.TRANSLATE,
        sensitivity: KnowledgeSensitivity.INTERNAL_ONLY,
        text: reply.inquiry.body,
        sourceLocale: reply.inquiry.lead.contact?.preferredLocale?.toLowerCase() ?? "auto",
        targetLocale: "zh-CN",
        requestSummary: `reply inquiry translation ${reply.inquiry.id}`,
      });

      translatedBody = translation.text.trim();
    } catch {
      translatedBody = null;
    }
  }

  return toReplyDetailResponse({
    reply,
    hitlTaskId: task?.id ?? null,
    translatedBody,
  });
}

export async function updateReplyDraft(params: {
  tenantContext: TenantContext;
  replyId: string;
  requestedByUserId?: string;
  input: unknown;
}) {
  if (!hasMinimumRole(params.tenantContext.role, "SALES")) {
    throw new ApiError(403, "FORBIDDEN", "Reply editing requires sales role or higher.");
  }

  const input = parseSchemaOrThrow(updateReplyDraftSchema, params.input);
  const reply = await getAccessibleReplyOrThrow({
    tenantContext: params.tenantContext,
    replyId: params.replyId,
  });

  if (reply.status !== ReplyStatus.PENDING_APPROVAL) {
    throw new ApiError(409, "CONFLICT", "Only pending approval replies can be edited.");
  }

  const pendingTask = await getPendingReplyTask({
    tenantId: params.tenantContext.tenantId,
    replyId: params.replyId,
  });

  const prisma = getPrismaClient();
  await prisma.reply.update({
    where: {
      id: reply.id,
    },
    data: {
      draftText: input.draftText.trim(),
    },
  });

  if (pendingTask) {
    const existingPayload =
      pendingTask.payload && typeof pendingTask.payload === "object" && !Array.isArray(pendingTask.payload)
        ? (pendingTask.payload as Record<string, unknown>)
        : {};

    await prisma.hitlTask.update({
      where: {
        id: pendingTask.id,
      },
      data: {
        payload: {
          ...existingPayload,
          draftText: input.draftText.trim(),
        },
      },
    });
  }

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.requestedByUserId,
    action: "reply_draft_updated",
    entityType: "reply",
    entityId: reply.id,
    metadata: {
      before: {
        draftText: reply.draftText,
      },
      after: {
        draftText: input.draftText.trim(),
      },
    },
  });

  return getReplyDetail({
    tenantContext: params.tenantContext,
    replyId: params.replyId,
    requestedByUserId: params.requestedByUserId,
    includeTranslation: false,
  });
}

export async function rejectReplyDraft(params: {
  tenantContext: TenantContext;
  replyId: string;
  rejectedByUserId?: string;
  input?: unknown;
}) {
  if (!hasMinimumRole(params.tenantContext.role, "SALES")) {
    throw new ApiError(403, "FORBIDDEN", "Reply rejection requires sales role or higher.");
  }

  const input = parseSchemaOrThrow(rejectReplySchema, params.input ?? {});
  const reply = await getAccessibleReplyOrThrow({
    tenantContext: params.tenantContext,
    replyId: params.replyId,
  });

  if (reply.status !== ReplyStatus.PENDING_APPROVAL) {
    throw new ApiError(409, "CONFLICT", "Only pending approval replies can be rejected.");
  }

  const pendingTask = await getPendingReplyTask({
    tenantId: params.tenantContext.tenantId,
    replyId: params.replyId,
  });

  const prisma = getPrismaClient();
  await prisma.reply.update({
    where: {
      id: reply.id,
    },
    data: {
      status: ReplyStatus.REJECTED,
    },
  });

  if (pendingTask) {
    await prisma.hitlTask.update({
      where: {
        id: pendingTask.id,
      },
      data: {
        status: HitlStatus.REJECTED,
        rejectedByUserId: params.rejectedByUserId,
        reason: input.reason?.trim() || "reply_rejected_by_reviewer",
        resolvedAt: new Date(),
      },
    });

    await createAuditLog({
      tenantId: params.tenantContext.tenantId,
      actorUserId: params.rejectedByUserId,
      action: "hitl_task_rejected",
      entityType: "reply",
      entityId: reply.id,
      metadata: {
        hitlTaskId: pendingTask.id,
        reason: input.reason?.trim() || null,
      },
    });
  }

  await createAuditLog({
    tenantId: params.tenantContext.tenantId,
    actorUserId: params.rejectedByUserId,
    action: "reply_rejected",
    entityType: "reply",
    entityId: reply.id,
    metadata: {
      inquiryId: reply.inquiry.id,
      reason: input.reason?.trim() || null,
      hitlTaskId: pendingTask?.id ?? null,
    },
  });

  return {
    replyId: reply.id,
    status: "rejected",
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
