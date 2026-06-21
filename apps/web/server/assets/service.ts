import { ContentAssetKind } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import type { TenantContext } from "@/server/db/tenant-context";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import { putTenantObject } from "@/server/storage/object-store";

export const contentAssetKindSchema = z.enum([
  "reference",
  "product",
  "brand",
  "document",
]);

function normalizeSlugPart(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function toPrismaAssetKind(kind: z.infer<typeof contentAssetKindSchema>) {
  return kind.toUpperCase() as ContentAssetKind;
}

function toApiAssetKind(kind: ContentAssetKind) {
  return kind.toLowerCase();
}

export function serializeContentAsset(asset: {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: ContentAssetKind;
  createdAt: Date;
}) {
  return {
    id: asset.id,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    kind: toApiAssetKind(asset.kind),
    createdAt: asset.createdAt.toISOString(),
  };
}

export async function listContentAssets(params: {
  tenantContext: TenantContext;
  limit?: number;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const items = await tenantPrisma.contentAsset.findMany({
    orderBy: {
      createdAt: "desc",
    },
    take: params.limit ?? 24,
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      kind: true,
      createdAt: true,
    },
  });

  return {
    items: items.map((item) => serializeContentAsset(item)),
  };
}

export async function createContentAsset(params: {
  tenantContext: TenantContext;
  createdByUserId?: string;
  file: File;
  kind?: string;
}) {
  if (!params.file.size) {
    throw new ApiError(400, "VALIDATION", "Asset file must not be empty.");
  }

  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const normalizedKind = contentAssetKindSchema.parse(
    params.kind?.trim().toLowerCase() || "reference",
  );
  const buffer = Buffer.from(await params.file.arrayBuffer());
  const fileName = params.file.name.trim() || "asset";
  const mimeType = params.file.type || "application/octet-stream";
  const objectKey = `content-assets/${normalizedKind}/${Date.now()}-${normalizeSlugPart(fileName) || "asset"}`;

  await putTenantObject({
    tenantId: params.tenantContext.tenantId,
    objectKey,
    body: buffer,
    contentType: mimeType,
  });

  const asset = await tenantPrisma.contentAsset.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      createdByUserId: params.createdByUserId,
      kind: toPrismaAssetKind(normalizedKind),
      fileName,
      mimeType,
      sizeBytes: buffer.byteLength,
      objectKey,
    },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      kind: true,
      createdAt: true,
    },
  });

  await tenantPrisma.auditLog.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      actorUserId: params.createdByUserId,
      action: "content_asset_uploaded",
      entityType: "content_asset",
      entityId: asset.id,
      metadata: {
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        kind: normalizedKind,
        sizeBytes: asset.sizeBytes,
      },
    },
  });

  return serializeContentAsset(asset);
}

export async function getContentAssetsByIds(params: {
  tenantContext: TenantContext;
  assetIds?: string[];
}) {
  const normalizedIds = Array.from(
    new Set((params.assetIds ?? []).map((id) => id.trim()).filter(Boolean)),
  );

  if (normalizedIds.length === 0) {
    return [];
  }

  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const items = await tenantPrisma.contentAsset.findMany({
    where: {
      id: {
        in: normalizedIds,
      },
    },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      kind: true,
    },
  });

  if (items.length !== normalizedIds.length) {
    throw new ApiError(404, "NOT_FOUND", "One or more content assets were not found.");
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  return normalizedIds.map((id) => byId.get(id)!);
}

export function buildAssetPromptSection(assets: Array<{
  fileName: string;
  mimeType: string;
  kind: ContentAssetKind;
}>) {
  if (!assets.length) {
    return "";
  }

  return [
    "Uploaded reference assets:",
    ...assets.map(
      (asset, index) =>
        `${index + 1}. ${asset.fileName} [${asset.kind.toLowerCase()} · ${asset.mimeType}]`,
    ),
    "Use them only as naming and visual-reference hints. Do not invent unseen technical facts from the assets.",
  ].join("\n");
}
