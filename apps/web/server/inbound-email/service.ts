import { createHash } from "node:crypto";
import {
  InboundEmailStatus,
  InquirySourceType,
  LeadStatus,
  LocaleCode,
  Prisma,
} from "@prisma/client";
import { ZodError, z } from "zod";
import { ApiError } from "@/server/api/errors";
import { getPrismaClient } from "@/server/db/prisma";

const inboundEmailAttachmentSchema = z.object({
  name: z.string().trim().min(1).max(240),
  contentType: z.string().trim().min(1).max(120).optional(),
  url: z.string().url().optional(),
});

export const inboundEmailWebhookSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(120),
  provider: z.string().trim().min(1).max(80),
  externalMessageId: z.string().trim().min(1).max(255).optional(),
  fromEmail: z.string().trim().email().max(160),
  fromName: z.string().trim().min(1).max(120).optional(),
  subject: z.string().trim().min(1).max(240).optional(),
  body: z.string().trim().min(1).max(12_000),
  attachments: z.array(inboundEmailAttachmentSchema).max(12).optional(),
  receivedAt: z.string().datetime().optional(),
});

export type InboundEmailWebhookInput = z.infer<typeof inboundEmailWebhookSchema>;

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function buildInboundEmailDedupeHash(params: {
  tenantId: string;
  provider: string;
  externalMessageId?: string;
  fromEmail: string;
  subject?: string;
  body: string;
}) {
  const canonical = params.externalMessageId?.trim()
    ? `message:${params.tenantId}:${params.provider.toLowerCase()}:${params.externalMessageId.trim()}`
    : JSON.stringify({
        tenantId: params.tenantId,
        provider: params.provider.trim().toLowerCase(),
        fromEmail: normalizeEmail(params.fromEmail),
        subject: params.subject?.trim().toLowerCase() ?? null,
        body: params.body.trim().toLowerCase(),
      });

  return createHash("sha256").update(canonical).digest("hex");
}

function isSpamInboundEmail(input: {
  fromEmail: string;
  subject?: string;
  body: string;
}) {
  const haystack = `${input.subject ?? ""}\n${input.body}`.toLowerCase();
  const spamSignals = [
    "viagra",
    "casino",
    "loan approval",
    "crypto investment",
    "free bitcoin",
    "seo service",
    "guest post",
    "backlink",
    "work from home",
    "earn $",
  ];

  if (spamSignals.some((signal) => haystack.includes(signal))) {
    return true;
  }

  const urlMatches = haystack.match(/https?:\/\//g);

  if ((urlMatches?.length ?? 0) >= 4) {
    return true;
  }

  return input.fromEmail.toLowerCase().endsWith("@example-spam.test");
}

async function getOrCreateEmailContact(params: {
  tenantId: string;
  fromEmail: string;
  fromName?: string;
}) {
  const prisma = getPrismaClient();
  const email = normalizeEmail(params.fromEmail);
  const existing = await prisma.contact.findFirst({
    where: {
      tenantId: params.tenantId,
      email,
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return prisma.contact.update({
      where: {
        id: existing.id,
      },
      data: {
        email,
        name: params.fromName ?? undefined,
      },
      select: {
        id: true,
      },
    });
  }

  return prisma.contact.create({
    data: {
      tenantId: params.tenantId,
      email,
      name: params.fromName ?? null,
    },
    select: {
      id: true,
    },
  });
}

export async function ingestInboundEmail(params: {
  input: unknown;
  idempotencyKey?: string | null;
}) {
  let input: InboundEmailWebhookInput;

  try {
    input = inboundEmailWebhookSchema.parse(params.input);
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

  const prisma = getPrismaClient();
  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: input.tenantSlug,
    },
    select: {
      id: true,
      defaultLocale: true,
    },
  });

  if (!tenant) {
    throw new ApiError(404, "NOT_FOUND", "Tenant not found.");
  }

  const dedupeHash = buildInboundEmailDedupeHash({
    tenantId: tenant.id,
    provider: input.provider,
    externalMessageId: input.externalMessageId,
    fromEmail: input.fromEmail,
    subject: input.subject,
    body: input.body,
  });

  const existing = await prisma.inboundEmail.findFirst({
    where: {
      tenantId: tenant.id,
      OR: [
        ...(params.idempotencyKey
          ? [{ idempotencyKey: params.idempotencyKey.trim() }]
          : []),
        { dedupeHash },
      ],
    },
    select: {
      id: true,
      leadId: true,
      status: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (existing) {
    return {
      inboundEmailId: existing.id,
      leadId: existing.leadId ?? null,
      status: existing.status.toLowerCase(),
      reused: true,
    };
  }

  const spam = isSpamInboundEmail(input);
  const normalizedEmail = normalizeEmail(input.fromEmail);

  if (spam) {
    const inboundEmail = await prisma.inboundEmail.create({
      data: {
        tenantId: tenant.id,
        provider: input.provider,
        externalMessageId: input.externalMessageId ?? null,
        idempotencyKey: params.idempotencyKey?.trim() || null,
        dedupeHash,
        fromEmail: normalizedEmail,
        fromName: input.fromName ?? null,
        subject: input.subject ?? null,
        body: input.body,
        attachments: (input.attachments ?? []) as Prisma.InputJsonValue,
        status: InboundEmailStatus.SPAM,
      },
      select: {
        id: true,
        status: true,
      },
    });

    return {
      inboundEmailId: inboundEmail.id,
      leadId: null,
      status: inboundEmail.status.toLowerCase(),
      reused: false,
    };
  }

  const contact = await getOrCreateEmailContact({
    tenantId: tenant.id,
    fromEmail: normalizedEmail,
    fromName: input.fromName,
  });
  const existingLead = await prisma.lead.findFirst({
    where: {
      tenantId: tenant.id,
      contactId: contact.id,
    },
    orderBy: {
      firstSeenAt: "desc",
    },
    select: {
      id: true,
    },
  });

  const result = await prisma.$transaction(async (tx) => {
    const lead =
      existingLead
        ? await tx.lead.update({
            where: {
              id: existingLead.id,
            },
            data: {
              lastContactAt: new Date(),
            },
            select: {
              id: true,
            },
          })
        : await tx.lead.create({
            data: {
              tenantId: tenant.id,
              contactId: contact.id,
              companyName: null,
              country: null,
              preferredLocale: tenant.defaultLocale as LocaleCode,
              status: LeadStatus.NEW,
              dedupeHash: null,
              lastContactAt: new Date(),
            },
            select: {
              id: true,
            },
          });
    const inboundEmail = await tx.inboundEmail.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        provider: input.provider,
        externalMessageId: input.externalMessageId ?? null,
        idempotencyKey: params.idempotencyKey?.trim() || null,
        dedupeHash,
        fromEmail: normalizedEmail,
        fromName: input.fromName ?? null,
        subject: input.subject ?? null,
        body: input.body,
        attachments: (input.attachments ?? []) as Prisma.InputJsonValue,
        status: InboundEmailStatus.PROCESSED,
      },
      select: {
        id: true,
        status: true,
      },
    });
    await tx.inquiry.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        inboundEmailId: inboundEmail.id,
        sourceType: InquirySourceType.EMAIL,
        subject: input.subject ?? null,
        body: input.body,
        fromEmail: normalizedEmail,
        fromName: input.fromName ?? null,
        rawPayload: input as Prisma.InputJsonValue,
      },
    });

    return {
      inboundEmailId: inboundEmail.id,
      leadId: lead.id,
      status: inboundEmail.status.toLowerCase(),
      reused: false,
    };
  });

  return result;
}
