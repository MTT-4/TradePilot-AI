import { MembershipRole, ModelRoute, Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import type { TenantContext } from "@/server/db/tenant-context";
import { getEnv } from "@/lib/env";

export const MODEL_POLICY_KEY = "model_policy";

export const modelPolicySchema = z.object({
  privateTextRoute: z.literal("local_qwen"),
  embeddingRoute: z.literal("local_bge"),
  translationRoute: z.enum(["google_translate", "local_qwen"]),
  externalTextRoute: z.enum(["openai", "local_qwen"]),
  localQwenModel: z.string().min(1),
  localBgeModel: z.string().min(1),
  openaiModel: z.string().min(1),
});

export type ModelPolicyConfig = z.infer<typeof modelPolicySchema>;

export const brandKitUpdateSchema = z.object({
  name: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  primaryColor: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/).optional().nullable(),
  secondaryColor: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/).optional().nullable(),
  tone: z.string().trim().max(120).optional().nullable(),
  logoUrl: z.string().trim().url().optional().or(z.literal("")).nullable(),
});

function normalizeHex(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value.startsWith("#") ? value.toUpperCase() : `#${value.toUpperCase()}`;
}

function normalizeOptionalText(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function getDefaultModelPolicy() {
  const env = getEnv();

  return {
    privateTextRoute: "local_qwen",
    embeddingRoute: "local_bge",
    translationRoute: "google_translate",
    externalTextRoute: "openai",
    localQwenModel: env.LOCAL_QWEN_MODEL,
    localBgeModel: env.LOCAL_BGE_MODEL,
    openaiModel: env.OPENAI_MODEL,
  } satisfies ModelPolicyConfig;
}

export async function getResolvedModelPolicy(tenantContext: TenantContext) {
  const tenantPrisma = getTenantPrisma(tenantContext);
  const record = await tenantPrisma.tenantSetting.findFirst({
    where: {
      key: MODEL_POLICY_KEY,
    },
    select: {
      value: true,
    },
  });

  const base = getDefaultModelPolicy();

  if (!record) {
    return base;
  }

  const parsed = modelPolicySchema.safeParse({
    ...base,
    ...(record.value && typeof record.value === "object" && !Array.isArray(record.value)
      ? (record.value as Record<string, unknown>)
      : {}),
  });

  return parsed.success ? parsed.data : base;
}

export async function upsertModelPolicy(params: {
  tenantContext: TenantContext;
  actorUserId: string;
  input: ModelPolicyConfig;
}) {
  if (
    params.tenantContext.role !== MembershipRole.OWNER &&
    params.tenantContext.role !== MembershipRole.ADMIN
  ) {
    throw new ApiError(403, "FORBIDDEN", "Only owner or admin can update model policy.");
  }

  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const existing = await tenantPrisma.tenantSetting.findFirst({
    where: {
      key: MODEL_POLICY_KEY,
    },
    select: {
      id: true,
      value: true,
    },
  });

  const payload = modelPolicySchema.parse(params.input);

  const record = existing
    ? await tenantPrisma.tenantSetting.update({
        where: {
          id: existing.id,
        },
        data: {
          value: payload as Prisma.InputJsonValue,
          updatedByUserId: params.actorUserId,
        },
        select: {
          id: true,
          value: true,
          updatedAt: true,
        },
      })
    : await tenantPrisma.tenantSetting.create({
        data: {
          tenantId: params.tenantContext.tenantId,
          key: MODEL_POLICY_KEY,
          value: payload as Prisma.InputJsonValue,
          updatedByUserId: params.actorUserId,
        },
        select: {
          id: true,
          value: true,
          updatedAt: true,
        },
      });

  await tenantPrisma.auditLog.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      actorUserId: params.actorUserId,
      action: "model_policy_updated",
      entityType: "tenant_setting",
      entityId: record.id,
      metadata: {
        before: existing?.value ?? null,
        after: payload,
      },
    },
  });

  return {
    ...payload,
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function upsertBrandKitSettings(params: {
  tenantContext: TenantContext;
  actorUserId: string;
  input: z.infer<typeof brandKitUpdateSchema>;
}) {
  if (
    params.tenantContext.role !== MembershipRole.OWNER &&
    params.tenantContext.role !== MembershipRole.ADMIN
  ) {
    throw new ApiError(403, "FORBIDDEN", "Only owner or admin can update brand settings.");
  }

  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const existing = await tenantPrisma.brandKit.findFirst({
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      name: true,
      companyName: true,
      primaryColor: true,
      secondaryColor: true,
      logoUrl: true,
      metadata: true,
    },
  });

  const normalizedTone = normalizeOptionalText(params.input.tone);
  const metadata = {
    ...(existing?.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
      ? (existing.metadata as Record<string, unknown>)
      : {}),
    tone: normalizedTone,
  };

  const payload = {
    name: params.input.name.trim(),
    companyName: params.input.companyName.trim(),
    primaryColor: normalizeHex(params.input.primaryColor),
    secondaryColor: normalizeHex(params.input.secondaryColor),
    logoUrl: normalizeOptionalText(params.input.logoUrl),
    metadata: metadata as Prisma.InputJsonValue,
  };

  const record = existing
    ? await tenantPrisma.brandKit.update({
        where: {
          id: existing.id,
        },
        data: payload,
        select: {
          id: true,
          name: true,
          companyName: true,
          primaryColor: true,
          secondaryColor: true,
          logoUrl: true,
          metadata: true,
          updatedAt: true,
        },
      })
    : await tenantPrisma.brandKit.create({
        data: {
          tenantId: params.tenantContext.tenantId,
          ...payload,
          createdByUserId: params.actorUserId,
        },
        select: {
          id: true,
          name: true,
          companyName: true,
          primaryColor: true,
          secondaryColor: true,
          logoUrl: true,
          metadata: true,
          updatedAt: true,
        },
      });

  await tenantPrisma.auditLog.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      actorUserId: params.actorUserId,
      action: "brand_kit_updated",
      entityType: "brand_kit",
      entityId: record.id,
      metadata: {
        before: existing ?? null,
        after: payload,
      },
    },
  });

  return {
    id: record.id,
    name: record.name,
    companyName: record.companyName,
    primaryColor: record.primaryColor,
    secondaryColor: record.secondaryColor,
    logoUrl: record.logoUrl,
    tone:
      record.metadata &&
      typeof record.metadata === "object" &&
      !Array.isArray(record.metadata) &&
      typeof (record.metadata as Record<string, unknown>).tone === "string"
        ? ((record.metadata as Record<string, unknown>).tone as string)
        : null,
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toModelRoute(value: string) {
  switch (value) {
    case "openai":
      return ModelRoute.OPENAI;
    case "google_translate":
      return ModelRoute.GOOGLE_TRANSLATE;
    case "local_qwen":
      return ModelRoute.LOCAL_QWEN;
    case "local_bge":
      return ModelRoute.LOCAL_BGE;
    default:
      throw new ApiError(400, "VALIDATION", `Unsupported model route: ${value}`);
  }
}
