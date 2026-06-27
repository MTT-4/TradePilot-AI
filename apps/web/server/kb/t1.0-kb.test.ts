import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { KnowledgeDocumentStatus } from "@prisma/client";
import * as xlsx from "xlsx";
import { getEnv } from "@/lib/env";
import {
  closeJobWorker,
  startJobWorker,
} from "@/server/jobs/worker";
import { getJobQueue } from "@/server/jobs/service";
import {
  createKnowledgeDocumentFromUpload,
  createKnowledgeDocumentFromUrl,
  getActiveMembershipForEmail,
  getKnowledgeChunksForTests,
  getKnowledgeChunkEmbeddingsForTests,
  getKnowledgeDocumentDetail,
  getKnowledgeDocumentRecordForTests,
  getParsedKnowledgeDocumentText,
  listKnowledgeDocuments,
  retryKnowledgeDocumentParse,
  semanticSearchKnowledgeChunks,
} from "@/server/kb/service";

const TEST_EMAIL = "owner-a@tradepilot.local";
const TEST_EMAIL_B = "owner-b@tradepilot.local";

const originalFetch = globalThis.fetch;

function buildMockEmbedding(text: string) {
  const vector = Array.from({ length: 1024 }, () => 0);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter(Boolean);

  for (const token of tokens) {
    let hash = 0;

    for (const character of token) {
      hash = (hash * 33 + character.charCodeAt(0)) % 1024;
    }

    vector[hash] += 1;
  }

  return vector;
}

function installMockEmbeddingFetch() {
  const env = getEnv();
  const baseUrl = env.LOCAL_BGE_BASE_URL.replace(/\/$/, "");

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === `${baseUrl}/embeddings`) {
      const rawBody =
        typeof init?.body === "string"
          ? init.body
          : init?.body instanceof Uint8Array
            ? Buffer.from(init.body).toString("utf8")
            : "";
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const inputText =
        typeof payload.input === "string"
          ? payload.input
          : Array.isArray(payload.input)
            ? String(payload.input[0] ?? "")
            : "";

      return new Response(
        JSON.stringify({
          model: "mock-bge-m3",
          data: [
            {
              embedding: buildMockEmbedding(inputText),
            },
          ],
          usage: {
            prompt_tokens: Math.max(1, Math.ceil(inputText.length / 4)),
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    return originalFetch(input as RequestInfo | URL, init);
  }) as typeof fetch;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDocumentStatus(params: {
  tenantContext: { tenantId: string; userId: string; role: "OWNER" | "ADMIN" | "OPERATOR" | "SALES" | "VIEWER" };
  documentId: string;
  expected: KnowledgeDocumentStatus;
  allowIntermediates?: KnowledgeDocumentStatus[];
}) {
  const seenStatuses = new Set<string>();

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const document = await getKnowledgeDocumentRecordForTests({
      tenantContext: params.tenantContext,
      documentId: params.documentId,
    });

    if (document) {
      seenStatuses.add(document.status);
    }

    if (document?.status === params.expected) {
      return {
        document,
        seenStatuses: Array.from(seenStatuses),
      };
    }

    if (
      document &&
      params.allowIntermediates &&
      !params.allowIntermediates.includes(document.status) &&
      document.status !== params.expected
    ) {
      throw new Error(`Unexpected document status: ${document.status}`);
    }

    await sleep(150);
  }

  throw new Error(`Timed out waiting for document status ${params.expected}.`);
}

describe("T1.0 knowledge documents", () => {
  let tenantContext: {
    tenantId: string;
    userId: string;
    role: "OWNER" | "ADMIN" | "OPERATOR" | "SALES" | "VIEWER";
  };
  let tenantContextB: {
    tenantId: string;
    userId: string;
    role: "OWNER" | "ADMIN" | "OPERATOR" | "SALES" | "VIEWER";
  };

  beforeAll(async () => {
    const membership = await getActiveMembershipForEmail(TEST_EMAIL);
    const membershipB = await getActiveMembershipForEmail(TEST_EMAIL_B);

    if (!membership || !membershipB) {
      throw new Error("Expected seeded tenant membership.");
    }

    tenantContext = {
      tenantId: membership.tenantId,
      userId: membership.userId,
      role: membership.role,
    };
    tenantContextB = {
      tenantId: membershipB.tenantId,
      userId: membershipB.userId,
      role: membershipB.role,
    };

    installMockEmbeddingFetch();
    await closeJobWorker();
  });

  afterAll(async () => {
    await closeJobWorker();
    await getJobQueue().close();
    globalThis.fetch = originalFetch;
  });

  it(
    "creates an uploaded knowledge document, parses it, and exposes list/detail state",
    async () => {
      const workbook = xlsx.utils.book_new();
      const sheet = xlsx.utils.aoa_to_sheet([
        ["SKU", "Description"],
        ["A-100", "Industrial pump"],
      ]);
      xlsx.utils.book_append_sheet(workbook, sheet, "Catalog");
      const workbookBuffer = xlsx.write(workbook, {
        bookType: "xlsx",
        type: "buffer",
      }) as Buffer;
      const file = new File([new Uint8Array(workbookBuffer)], "catalog.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const result = await createKnowledgeDocumentFromUpload({
        tenantContext,
        uploadedByUserId: tenantContext.userId,
        file,
        sensitivity: "public",
        title: "Catalog workbook",
        market: "MENA",
        product: "Pumps",
      });

      const initialDocument = await getKnowledgeDocumentRecordForTests({
        tenantContext,
        documentId: result.documentId,
      });
      expect(initialDocument?.status).toBe(KnowledgeDocumentStatus.UPLOADED);

      startJobWorker();

      await waitForDocumentStatus({
        tenantContext,
        documentId: result.documentId,
        expected: KnowledgeDocumentStatus.READY,
        allowIntermediates: [
          KnowledgeDocumentStatus.UPLOADED,
          KnowledgeDocumentStatus.PARSING,
          KnowledgeDocumentStatus.CHUNKING,
          KnowledgeDocumentStatus.EMBEDDING,
        ],
      });

      const parsedText = await getParsedKnowledgeDocumentText({
        tenantId: tenantContext.tenantId,
        documentId: result.documentId,
      });
      expect(parsedText).toContain("Industrial pump");

      const detail = await getKnowledgeDocumentDetail(
        tenantContext,
        result.documentId,
      );
      expect(detail.status).toBe("ready");
      expect(detail.chunkCount).toBeGreaterThan(0);
      expect(detail.pendingReviewCount).toBeGreaterThan(0);

      const list = await listKnowledgeDocuments(tenantContext);
      expect(list.items.some((item) => item.id === result.documentId)).toBe(true);
      const embeddings = await getKnowledgeChunkEmbeddingsForTests({
        tenantContext,
        documentId: result.documentId,
      });
      expect(
        embeddings.every((item) => item.embeddingText?.startsWith("[") ?? false),
      ).toBe(true);
    },
    15000,
  );

  it("marks the document failed when embedding fails after parsing", async () => {
    await closeJobWorker();
    const env = getEnv();
    const baseUrl = env.LOCAL_BGE_BASE_URL.replace(/\/$/, "");

    globalThis.fetch = (async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === `${baseUrl}/embeddings`) {
        return new Response(
          JSON.stringify({
            error: "local embedding unavailable",
          }),
          {
            status: 503,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }

      return originalFetch(input as RequestInfo | URL, init);
    }) as typeof fetch;

    try {
      const file = new File(
        ["Embedding failure should not leave this document stuck."],
        "embedding-failure.txt",
        {
          type: "text/plain",
        },
      );
      const result = await createKnowledgeDocumentFromUpload({
        tenantContext,
        uploadedByUserId: tenantContext.userId,
        file,
        sensitivity: "public",
        title: "Embedding failure fixture",
      });

      startJobWorker();

      await waitForDocumentStatus({
        tenantContext,
        documentId: result.documentId,
        expected: KnowledgeDocumentStatus.FAILED,
        allowIntermediates: [
          KnowledgeDocumentStatus.UPLOADED,
          KnowledgeDocumentStatus.PARSING,
          KnowledgeDocumentStatus.CHUNKING,
          KnowledgeDocumentStatus.EMBEDDING,
        ],
      });
    } finally {
      await closeJobWorker();
      installMockEmbeddingFetch();
    }
  }, 15000);

  it("parses a URL document and allows retry after a failure", async () => {
    let failMode = true;
    const server = createServer((request, response) => {
      if (request.url === "/knowledge" && !failMode) {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
        });
        response.end(
          "<html><head><title>Knowledge URL</title></head><body><h1>Factory profile</h1><p>Annual output 12000 units.</p></body></html>",
        );
        return;
      }

      response.writeHead(503, {
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("temporary failure");
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Failed to allocate test server port.");
    }

    const sourceUrl = `http://127.0.0.1:${address.port}/knowledge`;
    const result = await createKnowledgeDocumentFromUrl({
      tenantContext,
      uploadedByUserId: tenantContext.userId,
      url: sourceUrl,
      title: "Remote KB",
    });

    startJobWorker();

    await waitForDocumentStatus({
      tenantContext,
      documentId: result.documentId,
      expected: KnowledgeDocumentStatus.FAILED,
      allowIntermediates: [
        KnowledgeDocumentStatus.UPLOADED,
        KnowledgeDocumentStatus.PARSING,
      ],
    });
    failMode = false;

    const retryResult = await retryKnowledgeDocumentParse({
      tenantContext,
      requestedByUserId: tenantContext.userId,
      documentId: result.documentId,
    });
    expect(retryResult.documentId).toBe(result.documentId);
    expect(retryResult.jobId).not.toBe(result.jobId);

    const settled = await waitForDocumentStatus({
      tenantContext,
      documentId: result.documentId,
      expected: KnowledgeDocumentStatus.READY,
      allowIntermediates: [
        KnowledgeDocumentStatus.UPLOADED,
        KnowledgeDocumentStatus.PARSING,
        KnowledgeDocumentStatus.FAILED,
        KnowledgeDocumentStatus.CHUNKING,
        KnowledgeDocumentStatus.EMBEDDING,
      ],
    });
    expect(settled.document?.status).toBe(KnowledgeDocumentStatus.READY);

    const parsedText = await getParsedKnowledgeDocumentText({
      tenantId: tenantContext.tenantId,
      documentId: result.documentId,
    });
    expect(parsedText).toContain("Annual output 12000 units.");

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  it("writes tenant-scoped chunks with metadata and chunk sensitivity suggestions", async () => {
    const text = [
      "Model: TS-75",
      "Market: Middle East",
      "This compressor supports 7.5 bar pressure.",
      "",
      "Quote: internal reseller floor price only.",
      "Contract terms available after approval.",
    ].join("\n");
    const file = new File([text], "pricing-sheet.txt", {
      type: "text/plain",
    });
    const result = await createKnowledgeDocumentFromUpload({
      tenantContext,
      uploadedByUserId: tenantContext.userId,
      file,
      title: "Pricing sheet",
      product: "TS-75",
      market: "Middle East",
    });

    startJobWorker();

    await waitForDocumentStatus({
      tenantContext,
      documentId: result.documentId,
      expected: KnowledgeDocumentStatus.READY,
      allowIntermediates: [
        KnowledgeDocumentStatus.UPLOADED,
        KnowledgeDocumentStatus.PARSING,
        KnowledgeDocumentStatus.CHUNKING,
        KnowledgeDocumentStatus.EMBEDDING,
      ],
    });

    const chunks = await getKnowledgeChunksForTests({
      tenantContext,
      documentId: result.documentId,
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => chunk.tenantId === tenantContext.tenantId)).toBe(
      true,
    );
    expect(
      chunks.every((chunk) => chunk.namespace === `tenant:${tenantContext.tenantId}`),
    ).toBe(true);
    expect(
      chunks.some((chunk) => chunk.sensitivity === "INTERNAL_ONLY"),
    ).toBe(true);

    const firstMetadata = chunks[0]?.metadata as
      | {
          language?: string;
          product?: string | null;
          market?: string | null;
          isStructured?: boolean;
        }
      | undefined;
    expect(firstMetadata?.language).toBe("en");
    expect(firstMetadata?.product).toBe("TS-75");
    expect(firstMetadata?.market).toBe("Middle East");
    expect(typeof firstMetadata?.isStructured).toBe("boolean");
  });

  it("keeps semantic retrieval tenant-isolated after embeddings are written", async () => {
    const uniqueTag = `iso-${Date.now()}`;
    const fileA = new File(
      [
        `Solar inverter ${uniqueTag} for rooftop projects. Export-ready CE documents. Suitable for EPC partners in MENA.`,
      ],
      "tenant-a-solar.txt",
      { type: "text/plain" },
    );
    const fileB = new File(
      [
        `Hydraulic press ${uniqueTag} maintenance handbook for workshop safety checks and lubrication procedures.`,
      ],
      "tenant-b-press.txt",
      { type: "text/plain" },
    );
    const docA = await createKnowledgeDocumentFromUpload({
      tenantContext,
      uploadedByUserId: tenantContext.userId,
      file: fileA,
      title: `Solar inverter facts ${uniqueTag}`,
      product: `Solar inverter ${uniqueTag}`,
      market: `MENA-${uniqueTag}`,
      sensitivity: "public",
    });
    const docB = await createKnowledgeDocumentFromUpload({
      tenantContext: tenantContextB,
      uploadedByUserId: tenantContextB.userId,
      file: fileB,
      title: `Press handbook ${uniqueTag}`,
      product: `Hydraulic press ${uniqueTag}`,
      market: `EU-${uniqueTag}`,
      sensitivity: "public",
    });

    startJobWorker();

    await waitForDocumentStatus({
      tenantContext,
      documentId: docA.documentId,
      expected: KnowledgeDocumentStatus.READY,
      allowIntermediates: [
        KnowledgeDocumentStatus.UPLOADED,
        KnowledgeDocumentStatus.PARSING,
        KnowledgeDocumentStatus.CHUNKING,
        KnowledgeDocumentStatus.EMBEDDING,
      ],
    });
    await waitForDocumentStatus({
      tenantContext: tenantContextB,
      documentId: docB.documentId,
      expected: KnowledgeDocumentStatus.READY,
      allowIntermediates: [
        KnowledgeDocumentStatus.UPLOADED,
        KnowledgeDocumentStatus.PARSING,
        KnowledgeDocumentStatus.CHUNKING,
        KnowledgeDocumentStatus.EMBEDDING,
      ],
    });

    const resultsA = await semanticSearchKnowledgeChunks({
      tenantContext,
      userId: tenantContext.userId,
      query: `rooftop solar inverter ${uniqueTag} for EPC partners`,
      limit: 3,
      product: `Solar inverter ${uniqueTag}`,
      fetchImpl: globalThis.fetch,
    });
    const resultsB = await semanticSearchKnowledgeChunks({
      tenantContext: tenantContextB,
      userId: tenantContextB.userId,
      query: `rooftop solar inverter ${uniqueTag} for EPC partners`,
      limit: 3,
      product: `Solar inverter ${uniqueTag}`,
      fetchImpl: globalThis.fetch,
    });

    expect(resultsA.some((item) => item.documentId === docA.documentId)).toBe(true);
    expect(resultsA.every((item) => item.tenantId === tenantContext.tenantId)).toBe(
      true,
    );
    expect(resultsB.some((item) => item.documentId === docA.documentId)).toBe(false);
    expect(resultsB.every((item) => item.tenantId === tenantContextB.tenantId)).toBe(
      true,
    );
  });
});
