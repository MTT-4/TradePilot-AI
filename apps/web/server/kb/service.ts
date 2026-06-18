import { createHash, randomUUID } from "node:crypto";
import {
  FileKind,
  FileSourceType,
  JobType,
  KnowledgeDocumentStatus,
  KnowledgeSensitivity,
  KnowledgeReviewStatus,
  LocaleCode,
  ModelTaskType,
  MembershipRole,
} from "@prisma/client";
import { ApiError } from "@/server/api/errors";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import type { TenantContext } from "@/server/db/tenant-context";
import { getPrismaClient } from "@/server/db/prisma";
import { getTenantObjectBuffer, putTenantObject } from "@/server/storage/object-store";
import { buildKnowledgeChunks } from "@/server/kb/chunker";
import { fetchAndParseKnowledgeUrl, parseKnowledgeBuffer } from "@/server/kb/parser";
import { createModelGateway } from "@/server/model-gateway";
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

function serializeVector(values: number[]) {
  return `[${values.join(",")}]`;
}

function normalizeQueryTokens(query: string) {
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "into",
    "onto",
    "that",
    "this",
    "only",
    "about",
    "after",
    "before",
  ]);

  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !stopwords.has(token)),
    ),
  ).slice(0, 8);
}

function computeKeywordScore(params: {
  queryTokens: string[];
  text: string;
  sourceCitation?: string | null;
  product?: string | null;
  market?: string | null;
}) {
  if (params.queryTokens.length === 0) {
    return 0;
  }

  const haystack = [
    params.text,
    params.sourceCitation ?? "",
    params.product ?? "",
    params.market ?? "",
  ]
    .join(" ")
    .toLowerCase();
  const matchedTokens = params.queryTokens.filter((token) =>
    haystack.includes(token),
  ).length;

  return matchedTokens / params.queryTokens.length;
}

function toApiChunkSensitivity(value: KnowledgeSensitivity) {
  return value.toLowerCase();
}

function buildNoEvidenceResult() {
  return {
    items: [],
    message:
      "No grounded knowledge found for this tenant and query. Add or review knowledge documents before generating content.",
  };
}

function toApiReviewStatus(value: KnowledgeReviewStatus) {
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

async function enqueueEmbedDocumentJob(params: {
  tenantContext: TenantContext;
  requestedByUserId: string;
  documentId: string;
}) {
  return enqueueTenantJob({
    tenantContext: params.tenantContext,
    requestedByUserId: params.requestedByUserId,
    type: JobType.EMBED_DOCUMENT,
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
      sensitivity: true,
      product: true,
      market: true,
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
  await params.reportProgress(88);

  await tenantPrisma.knowledgeChunk.deleteMany({
    where: {
      documentId: document.id,
    },
  });

  const chunks = buildKnowledgeChunks({
    tenantId: params.tenantId,
    documentId: document.id,
    title: parsed.resolvedTitle ?? document.title,
    locale: document.locale,
    sourceType: document.sourceType,
    sourceLabel: document.sourceLabel ?? parsed.sourceLabel,
    product: document.product,
    market: document.market,
    documentSensitivity: document.sensitivity,
    parsedText: parsed.text,
  });

  if (chunks.length === 0) {
    throw new Error("Knowledge document produced no chunks.");
  }

  await tenantPrisma.knowledgeChunk.createMany({
    data: chunks,
  });
  const createdChunks = await tenantPrisma.knowledgeChunk.findMany({
    where: {
      documentId: document.id,
    },
    orderBy: {
      chunkIndex: "asc",
    },
    select: {
      id: true,
      text: true,
      sourceCitation: true,
      sensitivity: true,
    },
  });

  await tenantPrisma.knowledgeReview.deleteMany({
    where: {
      documentId: document.id,
      status: KnowledgeReviewStatus.PENDING,
    },
  });
  await tenantPrisma.knowledgeReview.createMany({
    data: createdChunks.map((chunk, index) => ({
      tenantId: params.tenantId,
      documentId: document.id,
      chunkId: chunk.id,
      question: `Review extracted knowledge #${index + 1}`,
      answer: chunk.text,
      sourceCitation: chunk.sourceCitation,
      sensitivity: chunk.sensitivity,
      status: KnowledgeReviewStatus.PENDING,
    })),
  });
  await params.reportProgress(95);

  await tenantPrisma.knowledgeDocument.update({
    where: {
      id: document.id,
    },
    data: {
      status: KnowledgeDocumentStatus.EMBEDDING,
    },
  });
  await params.reportProgress(98);
  const embedJob = await enqueueEmbedDocumentJob({
    tenantContext,
    requestedByUserId: params.requestedByUserId ?? "system",
    documentId: document.id,
  });
  await params.reportProgress(99);

  return {
    documentId: document.id,
    nextStatus: KnowledgeDocumentStatus.EMBEDDING.toLowerCase(),
    parsedObjectKey,
    extractedCharacters: parsed.text.length,
    chunkCount: chunks.length,
    embedJobId: embedJob.jobId,
    locale: document.locale.toLowerCase(),
  };
}

async function updateKnowledgeChunkEmbedding(params: {
  tenantContext: TenantContext;
  chunkId: string;
  embedding: number[];
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);

  await tenantPrisma.$executeRawUnsafe(
    `
      UPDATE "knowledge_chunks"
      SET "embedding" = $1::vector,
          "updated_at" = NOW()
      WHERE "id" = $2
        AND "tenant_id" = $3
    `,
    serializeVector(params.embedding),
    params.chunkId,
    params.tenantContext.tenantId,
  );
}

export async function runEmbedDocumentJob(params: {
  tenantId: string;
  requestedByUserId?: string;
  documentId: string;
  reportProgress: (progress: number) => Promise<void>;
  fetchImpl?: typeof fetch;
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
      status: true,
      title: true,
      sensitivity: true,
    },
  });

  if (!document) {
    throw new Error("Knowledge document not found.");
  }

  const chunks = await tenantPrisma.knowledgeChunk.findMany({
    where: {
      documentId: document.id,
    },
    orderBy: {
      chunkIndex: "asc",
    },
    select: {
      id: true,
      chunkIndex: true,
      text: true,
      sensitivity: true,
    },
  });

  if (chunks.length === 0) {
    throw new Error("Knowledge document has no chunks to embed.");
  }

  await tenantPrisma.knowledgeDocument.update({
    where: {
      id: document.id,
    },
    data: {
      status: KnowledgeDocumentStatus.EMBEDDING,
    },
  });
  await params.reportProgress(10);

  const gateway = createModelGateway({
    fetchImpl: params.fetchImpl,
  });

  for (const [index, chunk] of chunks.entries()) {
    const result = await gateway.embed({
      tenantContext,
      userId: params.requestedByUserId,
      taskType: ModelTaskType.EMBED,
      text: chunk.text,
      sensitivity: chunk.sensitivity,
      requestSummary: `kb embed ${document.id}#${chunk.chunkIndex}`,
    });

    if (!result) {
      throw new Error("Embedding gateway returned no result.");
    }

    if (result.embedding.length !== 1024) {
      throw new Error(
        `Embedding dimension mismatch for chunk ${chunk.id}: expected 1024, got ${result.embedding.length}.`,
      );
    }

    await updateKnowledgeChunkEmbedding({
      tenantContext,
      chunkId: chunk.id,
      embedding: result.embedding,
    });

    const progress = 10 + Math.round(((index + 1) / chunks.length) * 85);
    await params.reportProgress(Math.min(progress, 95));
  }

  await tenantPrisma.knowledgeDocument.update({
    where: {
      id: document.id,
    },
    data: {
      status: KnowledgeDocumentStatus.READY,
    },
  });
  await params.reportProgress(99);

  return {
    documentId: document.id,
    nextStatus: KnowledgeDocumentStatus.READY.toLowerCase(),
    embeddedChunks: chunks.length,
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
  await tenantPrisma.knowledgeChunk.deleteMany({
    where: {
      documentId: params.documentId,
    },
  });
  await tenantPrisma.knowledgeReview.deleteMany({
    where: {
      documentId: params.documentId,
      status: KnowledgeReviewStatus.PENDING,
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
      sensitivity: true,
      product: true,
      market: true,
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

export async function getKnowledgeChunksForTests(params: {
  tenantContext: TenantContext;
  documentId: string;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);

  return tenantPrisma.knowledgeChunk.findMany({
    where: {
      documentId: params.documentId,
    },
    orderBy: {
      chunkIndex: "asc",
    },
    select: {
      id: true,
      tenantId: true,
      chunkIndex: true,
      namespace: true,
      text: true,
      sourceCitation: true,
      locale: true,
      product: true,
      market: true,
      sensitivity: true,
      metadata: true,
    },
  });
}

export async function getKnowledgeChunkEmbeddingsForTests(params: {
  tenantContext: TenantContext;
  documentId: string;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);

  return tenantPrisma.$queryRawUnsafe<
    Array<{
      id: string;
      chunkIndex: number;
      embeddingText: string | null;
    }>
  >(
    `
      SELECT "id",
             "chunk_index" AS "chunkIndex",
             CASE
               WHEN "embedding" IS NULL THEN NULL
               ELSE "embedding"::text
             END AS "embeddingText"
      FROM "knowledge_chunks"
      WHERE "tenant_id" = $1
        AND "document_id" = $2
      ORDER BY "chunk_index" ASC
    `,
    params.tenantContext.tenantId,
    params.documentId,
  );
}

export async function semanticSearchKnowledgeChunks(params: {
  tenantContext: TenantContext;
  userId?: string;
  query: string;
  limit?: number;
  allowInternalOnly?: boolean;
  product?: string | null;
  market?: string | null;
  fetchImpl?: typeof fetch;
}) {
  const gateway = createModelGateway({
    fetchImpl: params.fetchImpl,
  });
  const embeddingResult = await gateway.embed({
    tenantContext: params.tenantContext,
    userId: params.userId,
    taskType: ModelTaskType.EMBED,
    text: params.query,
    sensitivity: params.allowInternalOnly
      ? KnowledgeSensitivity.INTERNAL_ONLY
      : KnowledgeSensitivity.PUBLIC,
    requestSummary: `kb semantic search: ${params.query}`,
  });

  if (!embeddingResult) {
    throw new Error("Embedding gateway returned no result.");
  }
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const vectorLiteral = serializeVector(embeddingResult.embedding);
  const limit = Math.max(1, Math.min(params.limit ?? 5, 20));
  const sqlParts = [
    `
      SELECT "id",
             "tenant_id" AS "tenantId",
             "document_id" AS "documentId",
             "chunk_index" AS "chunkIndex",
             "namespace",
             "text",
             "source_citation" AS "sourceCitation",
             "locale",
             "product",
             "market",
             "sensitivity",
             "metadata",
             1 - ("embedding" <=> $1::vector) AS "score"
      FROM "knowledge_chunks"
      WHERE "tenant_id" = $2
        AND "embedding" IS NOT NULL
    `,
  ];
  const args: Array<string | number> = [vectorLiteral, params.tenantContext.tenantId];
  let parameterIndex = 3;

  if (!params.allowInternalOnly) {
    sqlParts.push(`AND "sensitivity" = 'public'`);
  }

  if (params.product) {
    sqlParts.push(`AND "product" = $${parameterIndex}`);
    args.push(params.product);
    parameterIndex += 1;
  }

  if (params.market) {
    sqlParts.push(`AND "market" = $${parameterIndex}`);
    args.push(params.market);
    parameterIndex += 1;
  }

  sqlParts.push(
    `ORDER BY "embedding" <=> $1::vector ASC LIMIT $${parameterIndex}`,
  );
  args.push(limit);

  return tenantPrisma.$queryRawUnsafe<
    Array<{
      id: string;
      tenantId: string;
      documentId: string;
      chunkIndex: number;
      namespace: string;
      text: string;
      sourceCitation: string | null;
      locale: LocaleCode;
      product: string | null;
      market: string | null;
      sensitivity: KnowledgeSensitivity;
      metadata: unknown;
      score: number;
    }>
  >(sqlParts.join("\n"), ...args);
}

export async function hybridSearchKnowledgeChunks(params: {
  tenantContext: TenantContext;
  userId?: string;
  query: string;
  limit?: number;
  allowInternalOnly?: boolean;
  product?: string | null;
  market?: string | null;
  fetchImpl?: typeof fetch;
}) {
  const normalizedQuery = params.query.trim();

  if (!normalizedQuery) {
    throw new ApiError(400, "VALIDATION", "Query must not be empty.");
  }

  const queryTokens = normalizeQueryTokens(normalizedQuery);
  const semanticResults = await semanticSearchKnowledgeChunks({
    ...params,
    query: normalizedQuery,
    limit: Math.max((params.limit ?? 5) * 3, 10),
  });
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const sqlParts = [
    `
      SELECT "id",
             "tenant_id" AS "tenantId",
             "document_id" AS "documentId",
             "chunk_index" AS "chunkIndex",
             "namespace",
             "text",
             "source_citation" AS "sourceCitation",
             "locale",
             "product",
             "market",
             "sensitivity",
             "metadata"
      FROM "knowledge_chunks"
      WHERE "tenant_id" = $1
    `,
  ];
  const args: Array<string | number> = [params.tenantContext.tenantId];
  let parameterIndex = 2;

  if (!params.allowInternalOnly) {
    sqlParts.push(`AND "sensitivity" = 'public'`);
  }

  if (params.product) {
    sqlParts.push(`AND "product" = $${parameterIndex}`);
    args.push(params.product);
    parameterIndex += 1;
  }

  if (params.market) {
    sqlParts.push(`AND "market" = $${parameterIndex}`);
    args.push(params.market);
    parameterIndex += 1;
  }

  if (queryTokens.length > 0) {
    const tokenConditions = queryTokens.map((token) => {
      const parameter = `$${parameterIndex}`;
      args.push(`%${token}%`);
      parameterIndex += 1;

      return `(
        LOWER("text") LIKE ${parameter}
        OR LOWER(COALESCE("source_citation", '')) LIKE ${parameter}
        OR LOWER(COALESCE("product", '')) LIKE ${parameter}
        OR LOWER(COALESCE("market", '')) LIKE ${parameter}
      )`;
    });

    sqlParts.push(`AND (${tokenConditions.join(" OR ")})`);
  } else {
    sqlParts.push(`AND FALSE`);
  }

  sqlParts.push(`LIMIT $${parameterIndex}`);
  args.push(Math.max((params.limit ?? 5) * 3, 10));

  const keywordResults = await tenantPrisma.$queryRawUnsafe<
    Array<{
      id: string;
      tenantId: string;
      documentId: string;
      chunkIndex: number;
      namespace: string;
      text: string;
      sourceCitation: string | null;
      locale: LocaleCode;
      product: string | null;
      market: string | null;
      sensitivity: KnowledgeSensitivity;
      metadata: unknown;
    }>
  >(sqlParts.join("\n"), ...args);

  const merged = new Map<
    string,
    {
      id: string;
      tenantId: string;
      documentId: string;
      chunkIndex: number;
      namespace: string;
      text: string;
      sourceCitation: string | null;
      locale: LocaleCode;
      product: string | null;
      market: string | null;
      sensitivity: KnowledgeSensitivity;
      metadata: unknown;
      semanticScore: number;
      keywordScore: number;
      score: number;
    }
  >();

  for (const result of semanticResults) {
    const keywordScore = computeKeywordScore({
      queryTokens,
      text: result.text,
      sourceCitation: result.sourceCitation,
      product: result.product,
      market: result.market,
    });
    const semanticScore = Math.max(0, result.score);
    const score = semanticScore + keywordScore * 0.35;

    merged.set(result.id, {
      ...result,
      semanticScore,
      keywordScore,
      score,
    });
  }

  for (const result of keywordResults) {
    const existing = merged.get(result.id);
    const keywordScore = computeKeywordScore({
      queryTokens,
      text: result.text,
      sourceCitation: result.sourceCitation,
      product: result.product,
      market: result.market,
    });

    if (existing) {
      existing.keywordScore = Math.max(existing.keywordScore, keywordScore);
      existing.score = existing.semanticScore + existing.keywordScore * 0.35;
      continue;
    }

    merged.set(result.id, {
      ...result,
      semanticScore: 0,
      keywordScore,
      score: keywordScore * 0.35,
    });
  }

  const ranked = Array.from(merged.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(params.limit ?? 5, 10)));

  const strongest = ranked[0];

  if (
    !strongest ||
    (strongest.keywordScore === 0 && strongest.semanticScore < 0.35) ||
    strongest.score < 0.15
  ) {
    return buildNoEvidenceResult();
  }

  return {
    items: ranked.map((item) => ({
      id: item.id,
      documentId: item.documentId,
      chunkIndex: item.chunkIndex,
      namespace: item.namespace,
      text: item.text,
      sourceCitation: item.sourceCitation,
      locale: item.locale.toLowerCase(),
      product: item.product,
      market: item.market,
      sensitivity: toApiChunkSensitivity(item.sensitivity),
      metadata: item.metadata,
      score: Number(item.score.toFixed(4)),
      semanticScore: Number(item.semanticScore.toFixed(4)),
      keywordScore: Number(item.keywordScore.toFixed(4)),
    })),
    message: null,
  };
}

export async function listKnowledgeReviews(params: {
  tenantContext: TenantContext;
  status?: "pending" | "approved" | "corrected";
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const where =
    params.status
      ? {
          status: params.status.toUpperCase() as KnowledgeReviewStatus,
        }
      : undefined;
  const [reviews, documentCount, reviewCount, approvedCount, internalOnlyCount, locales] =
    await Promise.all([
      tenantPrisma.knowledgeReview.findMany({
        where,
        orderBy: [
          {
            status: "asc",
          },
          {
            createdAt: "asc",
          },
        ],
        select: {
          id: true,
          question: true,
          answer: true,
          correctedText: true,
          sourceCitation: true,
          sensitivity: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          document: {
            select: {
              id: true,
              title: true,
              locale: true,
              sourceLabel: true,
              sourceType: true,
            },
          },
          chunk: {
            select: {
              id: true,
              chunkIndex: true,
              text: true,
            },
          },
          reviewedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      tenantPrisma.knowledgeDocument.count(),
      Promise.all([
        tenantPrisma.knowledgeReview.count(),
        tenantPrisma.knowledgeQaPair.count(),
      ]).then(([reviewsTotal, qaPairsTotal]) => reviewsTotal + qaPairsTotal),
      Promise.all([
        tenantPrisma.knowledgeReview.count({
          where: {
            status: {
              in: [
                KnowledgeReviewStatus.APPROVED,
                KnowledgeReviewStatus.CORRECTED,
              ],
            },
          },
        }),
        tenantPrisma.knowledgeQaPair.count({
          where: {
            status: {
              in: [
                KnowledgeReviewStatus.APPROVED,
                KnowledgeReviewStatus.CORRECTED,
              ],
            },
          },
        }),
      ]).then(([reviewsApproved, qaPairsApproved]) => reviewsApproved + qaPairsApproved),
      Promise.all([
        tenantPrisma.knowledgeReview.count({
          where: {
            sensitivity: KnowledgeSensitivity.INTERNAL_ONLY,
          },
        }),
        tenantPrisma.knowledgeQaPair.count({
          where: {
            sensitivity: KnowledgeSensitivity.INTERNAL_ONLY,
          },
        }),
      ]).then(([reviewsInternal, qaPairsInternal]) => reviewsInternal + qaPairsInternal),
      tenantPrisma.knowledgeDocument.findMany({
        distinct: ["locale"],
        select: {
          locale: true,
        },
      }),
    ]);

  return {
    summary: {
      documentsCount: documentCount,
      cardsCount: reviewCount,
      approvedCount,
      languagesCount: locales.length,
      internalOnlyCount,
    },
    items: reviews.map((review) => ({
      id: review.id,
      question: review.question ?? `Review card ${review.id}`,
      answer: review.correctedText ?? review.answer ?? review.chunk?.text ?? "",
      rawAnswer: review.answer ?? review.chunk?.text ?? "",
      correctedText: review.correctedText,
      sourceCitation: review.sourceCitation,
      sensitivity: toApiChunkSensitivity(review.sensitivity),
      status: toApiReviewStatus(review.status),
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      document: {
        id: review.document.id,
        title: review.document.title,
        locale: review.document.locale.toLowerCase(),
        sourceLabel: review.document.sourceLabel,
        sourceType: review.document.sourceType.toLowerCase(),
      },
      chunk: review.chunk
        ? {
            id: review.chunk.id,
            chunkIndex: review.chunk.chunkIndex,
            text: review.chunk.text,
          }
        : null,
      reviewedBy: review.reviewedBy,
    })),
  };
}

export async function reviewKnowledgeCard(params: {
  tenantContext: TenantContext;
  reviewId: string;
  reviewedByUserId: string;
  action: "approve" | "correct";
  correctedText?: string | null;
  sensitivity?: "public" | "internal_only" | null;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const review = await tenantPrisma.knowledgeReview.findUnique({
    where: {
      id: params.reviewId,
    },
    select: {
      id: true,
      documentId: true,
      chunkId: true,
      answer: true,
      question: true,
      sensitivity: true,
      status: true,
      sourceCitation: true,
    },
  });

  if (!review) {
    throw new ApiError(404, "NOT_FOUND", "Knowledge review not found.");
  }

  const nextSensitivity =
    parseKnowledgeSensitivity(params.sensitivity) ?? review.sensitivity;

  if (params.action === "correct" && !params.correctedText?.trim()) {
    throw new ApiError(
      400,
      "VALIDATION",
      "correctedText is required when action is correct.",
    );
  }

  const nextStatus =
    params.action === "approve"
      ? KnowledgeReviewStatus.APPROVED
      : KnowledgeReviewStatus.CORRECTED;
  const nextText = params.correctedText?.trim() ?? review.answer ?? "";

  const updated = await tenantPrisma.$transaction(async (tx) => {
    const updatedReview = await tx.knowledgeReview.update({
      where: {
        id: review.id,
      },
      data: {
        reviewedByUserId: params.reviewedByUserId,
        status: nextStatus,
        correctedText:
          params.action === "correct" ? nextText : null,
        sensitivity: nextSensitivity,
        answer: params.action === "correct" ? nextText : review.answer,
      },
      select: {
        id: true,
        status: true,
        sensitivity: true,
        correctedText: true,
      },
    });

    if (review.chunkId) {
      await tx.knowledgeChunk.update({
        where: {
          id: review.chunkId,
        },
        data: {
          text: params.action === "correct" ? nextText : undefined,
          sensitivity: nextSensitivity,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId: params.tenantContext.tenantId,
        actorUserId: params.reviewedByUserId,
        action:
          params.action === "approve"
            ? "knowledge_review_approved"
            : "knowledge_review_corrected",
        entityType: "knowledge_review",
        entityId: review.id,
        metadata: {
          reviewId: review.id,
          documentId: review.documentId,
          chunkId: review.chunkId,
          sensitivity: nextSensitivity.toLowerCase(),
          status: nextStatus.toLowerCase(),
          sourceCitation: review.sourceCitation,
        },
      },
    });

    return updatedReview;
  });

  return {
    reviewId: updated.id,
    status: updated.status.toLowerCase(),
    sensitivity: updated.sensitivity.toLowerCase(),
    correctedText: updated.correctedText,
  };
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
