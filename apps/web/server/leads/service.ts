import { createHash } from "node:crypto";
import {
  InquirySourceType,
  LeadStatus,
  LocaleCode,
  Prisma,
} from "@prisma/client";
import { ZodError, z } from "zod";
import { ApiError } from "@/server/api/errors";
import { getPrismaClient } from "@/server/db/prisma";
import { resolveTrackingAttributionBySlug } from "@/server/tracking/service";

const apiLocaleSchema = z.enum(["en", "ar", "ru", "fr", "de", "pt", "zh"]);

const publicLeadFieldsSchema = z
  .object({
    companyName: z.string().trim().min(1).max(160).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().max(160).optional(),
    phone: z.string().trim().min(3).max(80).optional(),
    whatsapp: z.string().trim().min(3).max(80).optional(),
    country: z.string().trim().min(1).max(120).optional(),
    preferredLocale: apiLocaleSchema.optional(),
    subject: z.string().trim().min(1).max(180).optional(),
    message: z.string().trim().min(1).max(4000),
  })
  .passthrough();

export const publicLeadFormSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(120),
  trackingSlug: z.string().trim().min(1).max(120).optional(),
  fields: publicLeadFieldsSchema,
});

export type PublicLeadFormInput = z.infer<typeof publicLeadFormSchema>;

function normalizeEmail(value: string | undefined) {
  return value?.trim().toLowerCase() || null;
}

function normalizePhone(value: string | undefined) {
  const digits = value?.replace(/[^\d+]+/g, "").trim() || "";

  return digits || null;
}

function toPrismaLocale(
  value: z.infer<typeof apiLocaleSchema> | undefined,
  fallback: LocaleCode,
) {
  return (value?.toUpperCase() as LocaleCode | undefined) ?? fallback;
}

function buildLeadDedupeHash(params: {
  tenantId: string;
  trackingLinkId?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  message: string;
  idempotencyKey?: string | null;
}) {
  const canonical = params.idempotencyKey?.trim()
    ? `idem:${params.tenantId}:${params.idempotencyKey.trim()}`
    : JSON.stringify({
        tenantId: params.tenantId,
        trackingLinkId: params.trackingLinkId ?? null,
        email: params.email ?? null,
        phone: params.phone ?? null,
        companyName: params.companyName?.trim().toLowerCase() ?? null,
        message: params.message.trim().toLowerCase(),
      });

  return createHash("sha256").update(canonical).digest("hex");
}

async function getOrCreateContact(params: {
  tenantId: string;
  fields: z.infer<typeof publicLeadFieldsSchema>;
}) {
  const prisma = getPrismaClient();
  const email = normalizeEmail(params.fields.email);
  const phone = normalizePhone(params.fields.phone);
  const whatsapp = normalizePhone(params.fields.whatsapp);
  const dedupeCandidates = [
    ...(email ? [{ email }] : []),
    ...(phone ? [{ phone }] : []),
    ...(whatsapp ? [{ whatsapp }] : []),
  ];
  const existing =
    dedupeCandidates.length > 0
      ? await prisma.contact.findFirst({
          where: {
            tenantId: params.tenantId,
            OR: dedupeCandidates,
          },
          select: {
            id: true,
          },
        })
      : null;

  if (existing) {
    return prisma.contact.update({
      where: {
        id: existing.id,
      },
      data: {
        companyName: params.fields.companyName ?? undefined,
        name: params.fields.name ?? undefined,
        email: email ?? undefined,
        phone: phone ?? undefined,
        whatsapp: whatsapp ?? undefined,
        country: params.fields.country ?? undefined,
        preferredLocale: params.fields.preferredLocale
          ? (params.fields.preferredLocale.toUpperCase() as LocaleCode)
          : undefined,
      },
      select: {
        id: true,
      },
    });
  }

  return prisma.contact.create({
    data: {
      tenantId: params.tenantId,
      companyName: params.fields.companyName ?? null,
      name: params.fields.name ?? null,
      email,
      phone,
      whatsapp,
      country: params.fields.country ?? null,
      preferredLocale: params.fields.preferredLocale
        ? (params.fields.preferredLocale.toUpperCase() as LocaleCode)
        : null,
    },
    select: {
      id: true,
    },
  });
}

export async function submitPublicLeadForm(params: {
  input: PublicLeadFormInput;
  idempotencyKey?: string | null;
}) {
  let input: PublicLeadFormInput;

  try {
    input = publicLeadFormSchema.parse(params.input);
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

  const tracking = input.trackingSlug
    ? await resolveTrackingAttributionBySlug(input.trackingSlug)
    : null;

  if (tracking && tracking.tenantId !== tenant.id) {
    throw new ApiError(404, "NOT_FOUND", "Tracking link not found.");
  }

  const email = normalizeEmail(input.fields.email);
  const phone = normalizePhone(input.fields.phone);
  const dedupeHash = buildLeadDedupeHash({
    tenantId: tenant.id,
    trackingLinkId: tracking?.trackingLinkId ?? null,
    email,
    phone,
    companyName: input.fields.companyName ?? null,
    message: input.fields.message,
    idempotencyKey: params.idempotencyKey ?? null,
  });

  const existingLead = await prisma.lead.findFirst({
    where: {
      tenantId: tenant.id,
      dedupeHash,
    },
    select: {
      id: true,
    },
  });

  if (existingLead) {
    const existingInquiry = await prisma.inquiry.findFirst({
      where: {
        tenantId: tenant.id,
        leadId: existingLead.id,
        sourceType: InquirySourceType.FORM,
        body: input.fields.message,
        subject: input.fields.subject ?? null,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
      },
    });

    return {
      leadId: existingLead.id,
      inquiryId: existingInquiry?.id ?? null,
      reused: true,
    };
  }

  const contact = await getOrCreateContact({
    tenantId: tenant.id,
    fields: input.fields,
  });
  const preferredLocale = toPrismaLocale(
    input.fields.preferredLocale,
    tenant.defaultLocale,
  );

  const result = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        tenantId: tenant.id,
        contactId: contact.id,
        campaignId: tracking?.campaignId ?? null,
        sourceContentItemId: tracking?.contentItemId ?? null,
        trackingLinkId: tracking?.trackingLinkId ?? null,
        companyName: input.fields.companyName ?? null,
        country: input.fields.country ?? null,
        preferredLocale,
        status: LeadStatus.NEW,
        dedupeHash,
        formPayload: input.fields as Prisma.InputJsonValue,
      },
      select: {
        id: true,
      },
    });

    const inquiry = await tx.inquiry.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        sourceType: InquirySourceType.FORM,
        subject: input.fields.subject ?? null,
        body: input.fields.message,
        fromEmail: email,
        fromName: input.fields.name ?? null,
        rawPayload: {
          trackingSlug: input.trackingSlug ?? null,
          fields: input.fields,
        } as Prisma.InputJsonValue,
      },
      select: {
        id: true,
      },
    });

    return {
      leadId: lead.id,
      inquiryId: inquiry.id,
      reused: false,
    };
  });

  return result;
}
