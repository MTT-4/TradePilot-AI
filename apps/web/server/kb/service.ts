import { createHash, randomUUID } from "node:crypto";
import {
  FileKind,
  FileSourceType,
  JobType,
  KnowledgeDocumentStatus,
  KnowledgeSensitivity,
  LocaleCode,
  MembershipRole,
} from "@prisma/client";
import { ApiError } from "@/server/api/errors";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import type { TenantContext } from "@/server/db/tenant-context";
import { getPrismaClient } from "@/server/db/prisma";
import { getTenantObjectBuffer, putTenantObject } from "@/server/storage/object-store";
import { fetchAndParseKnowledgeUrl, parseKnowledgeBuffer } from "@/server/kb/parser";
import {
  parseKnowledgeSensitivity,
  suggestKnowledgeSensitivity,
  toApiKnowledgeSensitivity,
} from "@/server/kb/sensitivity";
import {
  enqueueTenantJob,
  getSystemTenantContext,
} from "@/server/jobs/service";

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
}

function createObjectKey(prefix: string, name: string) {
  return `${prefix}/${randomUUID()}-${sanitizeFileName(name)}`;
}

export function buildKnowledgeParsedObjectKey(documentId: string) {
  return `kb/documents/${documentId}/parsed.txt`;
}

function parseLocaleCode(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();

  switch (normalized) {
    case undefined:
    case "":
      return LocaleCode.EN;
    case "en":
      return LocaleCode.EN;
    case "ar":
      return LocaleCode.AR;
    case "ru":
      return LocaleCode.RU;
    case "fr":
      return LocaleCode.FR;
    case "de":
      return LocaleCode.DE;
    case "pt":
      return LocaleCode.PT;
    case "zh":
      return LocaleCode.ZH;
    default:
      throw new ApiError(400, "VALIDATION", "Unsupported locale.");
  }
}

function normalizeUrl(url: string) {
  try {
    return new URL(url).toString();
  } catch {
    throw new ApiError(400, "VALIDATION", "Invalid source URL.");
  }
}

function deriveUrlTitle(url: string) {
  const parsed = new URL(url);
  const path = parsed.pathname === "/" ? "" : parsed.pathname;

  return `${parsed.hostname}${path}`;
}

function parseSensitivityOrSuggest(params: {
  value?: string | null;
  title?: string | null;
  sourceUrl?: string | null;
}) {
  return (
    parseKnowledgeSensitivity(params.value) ??
    suggestKnowledgeSensitivity({
      title: params.title,
      sourceUrl: params.sourceUrl,
    })
  );
}

function toApiDocumentStatus(value: KnowledgeDocumentStatus) {
  return value.toLowerCase();
}

function toApiLocale(value: LocaleCode) {
  return value.toLowerCase();
}

function toApiSourceType(value: FileSourceType) {
  return value.toLowerCase();
}

async function createKnowledgeDocumentRecord(params: {
  tenantContext: TenantContext;
  uploadedByUserId: string;
  title: string;
  sourceType: FileSourceType;
  sourceUrl?: string | null;
  sensitivity: KnowledgeSensitivity;
  locale: LocaleCode;
  product?: string | null;
  market?: string | null;
  sourceLabel?: string | null;
  fileId?: string | null;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);

  return tenantPrisma.knowledgeDocument.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      fileId: params.fileId,
      uploadedByUserId: params.uploadedByUserId,
      title: params.title,
      sourceType: params.sourceType,
      sourceUrl: params.sourceUrl,
      status: KnowledgeDocumentStatus.UPLOADED,
      sensitivity: params.sensitivity,
      locale: params.locale,
      product: params.product,
      market: params.market,
      sourceLabel: params.sourceLabel,
    },
    select: {
      id: true,
    },
  });
}

async function enqueueParseDocumentJob(params: {
  tenantContext: TenantContext;
  requestedByUserId: string;
  documentId: string;
}) {
  return enqueueTenantJob({
    tenantContext: params.tenantContext,
    requestedByUserId: params.requestedByUserId,
    type: JobType.PARSE_DOCUMENT,
    input: {
      documentId: params.documentId,
    },
    maxAttempts: 1,
  });
}

export async function createKnowledgeDocumentFromUpload(params: {
  tenantContext: TenantContext;
  uploadedByUserId: string;
  file: File;
  sensitivity?: string | null;
  locale?: string | null;
  title?: string | null;
  product?: string | null;
  market?: string | null;
  sourceLabel?: string | null;
}) {
  if (!params.file.size) {
    throw new ApiError(400, "VALIDATION", "Uploaded file must not be empty.");
  }

  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const buffer = Buffer.from(await params.file.arrayBuffer());
  const originalName = params.file.name || "document";
  const objectKey = createObjectKey("kb/uploads", originalName);
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const mimeType = params.file.type || "application/octet-stream";

  const storedObject = await putTenantObject({
    tenantId: params.tenantContext.tenantId,
    objectKey,
    body: buffer,
    contentType: mimeType,
  });

  const storedFile = await tenantPrisma.file.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      uploadedByUserId: params.uploadedByUserId,
      sourceType: FileSourceType.UPLOAD,
      kind: FileKind.DOCUMENT,
      originalName,
      mimeType,
      sizeBytes: buffer.byteLength,
      bucket: storedObject.bucket,
      objectKey,
      checksum,
    },
    select: {
      id: true,
    },
  });

  const title = params.title?.trim() || originalName;
  const document = await createKnowledgeDocumentRecord({
    tenantContext: params.tenantContext,
    uploadedByUserId: params.uploadedByUserId,
    fileId: storedFile.id,
    title,
    sourceType: FileSourceType.UPLOAD,
    sensitivity: parseSensitivityOrSuggest({
      value: params.sensitivity,
      title,
    }),
    locale: parseLocaleCode(params.locale),
    product: params.product,
    market: params.market,
    sourceLabel: params.sourceLabel,
  });
  const job = await enqueueParseDocumentJob({
    tenantContext: params.tenantContext,
    requestedByUserId: params.uploadedByUserId,
    documentId: document.id,
  });

  return {
    documentId: document.id,
    jobId: job.jobId,
  };
}

export async function createKnowledgeDocumentFromUrl(params: {
  tenantContext: TenantContext;
  uploadedByUserId: string;
  url: string;
  sensitivity?: string | null;
  locale?: string | null;
  title?: string | null;
  product?: string | null;
  market?: string | null;
  sourceLabel?: string | null;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const normalizedUrl = normalizeUrl(params.url);
  const manifestBody = JSON.stringify({ url: normalizedUrl }, null, 2);
  const objectKey = createObjectKey("kb/url-manifests", "source-url.json");

  const storedObject = await putTenantObject({
    tenantId: params.tenantContext.tenantId,
    objectKey,
    body: manifestBody,
    contentType: "application/json",
  });

  const file = await tenantPrisma.file.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      uploadedByUserId: params.uploadedByUserId,
      sourceType: FileSourceType.URL,
      kind: FileKind.DOCUMENT,
      originalName: params.title?.trim() || deriveUrlTitle(normalizedUrl),
      mimeType: "application/json",
      sizeBytes: Buffer.byteLength(manifestBody),
      bucket: storedObject.bucket,
      objectKey,
      sourceUrl: normalizedUrl,
    },
    select: {
      id: true,
    },
  });

  const title = params.title?.trim() || deriveUrlTitle(normalizedUrl);
  const document = await createKnowledgeDocumentRecord({
    tenantContext: params.tenantContext,
    uploadedByUserId: params.uploadedByUserId,
    fileId: file.id,
    title,
    sourceType: FileSourceType.URL,
    sourceUrl: normalizedUrl,
    sensitivity: parseSensitivityOrSuggest({
      value: params.sensitivity,
      title,
      sourceUrl: normalizedUrl,
    }),
    locale: parseLocaleCode(params.locale),
    product: params.product,
    market: params.market,
    sourceLabel: params.sourceLabel,
  });
  const job = await enqueueParseDocumentJob({
    tenantContext: params.tenantContext,
    requestedByUserId: params.uploadedByUserId,
    documentId: document.id,
  });

  return {
    documentId: document.id,
    jobId: job.jobId,
  };
}

export async function listKnowledgeDocuments(tenantContext: TenantContext) {
  const tenantPrisma = getTenantPrisma(tenantContext);
  const documents = await tenantPrisma.knowledgeDocument.findMany({
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      title: true,
      sourceType: true,
      sourceUrl: true,
      status: true,
      sensitivity: true,
      locale: true,
      product: true,
      market: true,
      sourceLabel: true,
      createdAt: true,
      updatedAt: true,
      file: {
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
        },
      },
    },
  });

  return {
    items: documents.map((document) => ({
      id: document.id,
      title: document.title,
      sourceType: toApiSourceType(document.sourceType),
      sourceUrl: document.sourceUrl,
      status: toApiDocumentStatus(document.status),
      sensitivity: toApiKnowledgeSensitivity(document.sensitivity),
      locale: toApiLocale(document.locale),
      product: document.product,
      market: document.market,
      sourceLabel: document.sourceLabel,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      file: document.file,
    })),
  };
}

export async function getKnowledgeDocumentDetail(
  tenantContext: TenantContext,
  documentId: string,
) {
  const tenantPrisma = getTenantPrisma(tenantContext);
  const document = await tenantPrisma.knowledgeDocument.findUnique({
    where: {
      id: documentId,
    },
    select: {
      id: true,
      title: true,
      sourceType: true,
      sourceUrl: true,
      status: true,
      sensitivity: true,
      locale: true,
      product: true,
      market: true,
      sourceLabel: true,
      createdAt: true,
      updatedAt: true,
      file: {
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          bucket: true,
          objectKey: true,
          checksum: true,
        },
      },
    },
  });

  if (!document) {
    throw new ApiError(404, "NOT_FOUND", "Knowledge document not found.");
  }

  const [chunkCount, pendingReviewCount] = await Promise.all([
    tenantPrisma.knowledgeChunk.count({
      where: {
        documentId,
      },
    }),
    tenantPrisma.knowledgeReview.count({
      where: {
        documentId,
        status: "PENDING",
      },
    }),
  ]);

  return {
    id: document.id,
    title: document.title,
    sourceType: toApiSourceType(document.sourceType),
    sourceUrl: document.sourceUrl,
    status: toApiDocumentStatus(document.status),
    sensitivity: toApiKnowledgeSensitivity(document.sensitivity),
    locale: toApiLocale(document.locale),
    product: document.product,
    market: document.market,
    sourceLabel: document.sourceLabel,
    chunkCount,
    pendingReviewCount,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    file: document.file,
  };
}

export async function retryKnowledgeDocumentParse(params: {
  tenantContext: TenantContext;
  requestedByUserId: string;
  documentId: string;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const document = await tenantPrisma.knowledgeDocument.findUnique({
    where: {
      id: params.documentId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!document) {
    throw new ApiError(404, "NOT_FOUND", "Knowledge document not found.");
  }

  if (document.status !== KnowledgeDocumentStatus.FAILED) {
    throw new ApiError(
      409,
      "CONFLICT",
      "Only failed knowledge documents can be retried.",
    );
  }

  await tenantPrisma.knowledgeDocument.update({
    where: {
      id: params.documentId,
    },
    data: {
      status: KnowledgeDocumentStatus.UPLOADED,
    },
  });

  const job = await enqueueParseDocumentJob({
    tenantContext: params.tenantContext,
    requestedByUserId: params.requestedByUserId,
    documentId: params.documentId,
  });

  return {
    documentId: params.documentId,
    jobId: job.jobId,
  };
}

export async function runParseDocumentJob(params: {
  tenantId: string;
  requestedByUserId?: string;
  documentId: string;
  reportProgress: (progress: number) => Promise<void>;
}) {
  const tenantContext = getSystemTenantContext(
    params.tenantId,
    params.requestedByUserId,
  );
  const tenantPrisma = getTenantPrisma(tenantContext);
  const document = await tenantPrisma.knowledgeDocument.findUnique({
    where: {
      id: params.documentId,
    },
    select: {
      id: true,
      title: true,
      sourceType: true,
      sourceUrl: true,
      sourceLabel: true,
      locale: true,
      file: {
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          objectKey: true,
        },
      },
    },
  });

  if (!document) {
    throw new Error("Knowledge document not found.");
  }

  await tenantPrisma.knowledgeDocument.update({
    where: {
      id: document.id,
    },
    data: {
      status: KnowledgeDocumentStatus.PARSING,
    },
  });
  await params.reportProgress(15);

  const parsed =
    document.sourceType === FileSourceType.URL
      ? await fetchAndParseKnowledgeUrl({
          url: document.sourceUrl ?? (() => {
            throw new Error("URL knowledge document is missing source URL.");
          })(),
          fallbackTitle: document.title,
        })
      : await (async () => {
          if (!document.file) {
            throw new Error("Uploaded knowledge document is missing file metadata.");
          }

          const buffer = await getTenantObjectBuffer({
            tenantId: params.tenantId,
            objectKey: document.file.objectKey,
          });

          return parseKnowledgeBuffer({
            buffer,
            fileName: document.file.originalName,
            mimeType: document.file.mimeType,
            fallbackTitle: document.title,
          });
        })();

  await params.reportProgress(80);

  const parsedObjectKey = buildKnowledgeParsedObjectKey(document.id);
  await putTenantObject({
    tenantId: params.tenantId,
    objectKey: parsedObjectKey,
    body: parsed.text,
    contentType: "text/plain; charset=utf-8",
  });

  await tenantPrisma.knowledgeDocument.update({
    where: {
      id: document.id,
    },
    data: {
      status: KnowledgeDocumentStatus.CHUNKING,
      title: parsed.resolvedTitle ?? document.title,
      sourceLabel: document.sourceLabel ?? parsed.sourceLabel,
    },
  });
  await params.reportProgress(95);

  return {
    documentId: document.id,
    nextStatus: KnowledgeDocumentStatus.CHUNKING.toLowerCase(),
    parsedObjectKey,
    extractedCharacters: parsed.text.length,
    locale: document.locale.toLowerCase(),
  };
}

export async function markKnowledgeDocumentParseFailed(params: {
  tenantId: string;
  requestedByUserId?: string;
  documentId: string;
}) {
  const tenantContext = {
    tenantId: params.tenantId,
    userId: params.requestedByUserId ?? "system",
    role: MembershipRole.OWNER,
  };
  const tenantPrisma = getTenantPrisma(tenantContext);

  await tenantPrisma.knowledgeDocument.updateMany({
    where: {
      id: params.documentId,
    },
    data: {
      status: KnowledgeDocumentStatus.FAILED,
    },
  });
}

export async function getParsedKnowledgeDocumentText(params: {
  tenantId: string;
  documentId: string;
}) {
  const buffer = await getTenantObjectBuffer({
    tenantId: params.tenantId,
    objectKey: buildKnowledgeParsedObjectKey(params.documentId),
  });

  return buffer.toString("utf8");
}

export async function getKnowledgeDocumentRecordForTests(params: {
  tenantContext: TenantContext;
  documentId: string;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);

  return tenantPrisma.knowledgeDocument.findUnique({
    where: {
      id: params.documentId,
    },
    select: {
      id: true,
      status: true,
      sourceType: true,
      title: true,
      file: {
        select: {
          id: true,
          mimeType: true,
          objectKey: true,
        },
      },
    },
  });
}

export async function getActiveMembershipForEmail(email: string) {
  const prisma = getPrismaClient();

  return prisma.membership.findFirst({
    where: {
      status: "ACTIVE",
      user: {
        email,
      },
    },
    select: {
      tenantId: true,
      userId: true,
      role: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}
