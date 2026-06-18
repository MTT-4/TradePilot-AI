import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KnowledgeDocumentStatus } from "@prisma/client";
import { getEnv } from "@/lib/env";
import {
  closeJobWorker,
  startJobWorker,
} from "@/server/jobs/worker";
import { getJobQueue } from "@/server/jobs/service";
import {
  createKnowledgeDocumentFromUpload,
  getActiveMembershipForEmail,
  hybridSearchKnowledgeChunks,
} from "@/server/kb/service";

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
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

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
  tenantContext: {
    tenantId: string;
    userId: string;
    role: "OWNER" | "ADMIN" | "OPERATOR" | "SALES" | "VIEWER";
  };
  documentId: string;
  expected: KnowledgeDocumentStatus;
}) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await hybridSearchKnowledgeChunks({
      tenantContext: params.tenantContext,
      userId: params.tenantContext.userId,
      query: "status probe",
      limit: 1,
      fetchImpl: globalThis.fetch,
    }).catch(() => null);

    void result;

    const { getKnowledgeDocumentRecordForTests } = await import("@/server/kb/service");
    const document = await getKnowledgeDocumentRecordForTests({
      tenantContext: params.tenantContext,
      documentId: params.documentId,
    });

    if (document?.status === params.expected) {
      return;
    }

    await sleep(150);
  }

  throw new Error(`Timed out waiting for ${params.expected}.`);
}

describe("T1.4 knowledge search", () => {
  let tenantContext: {
    tenantId: string;
    userId: string;
    role: "OWNER" | "ADMIN" | "OPERATOR" | "SALES" | "VIEWER";
  };

  beforeAll(async () => {
    const membership = await getActiveMembershipForEmail("owner-a@tradepilot.local");

    if (!membership) {
      throw new Error("Expected seeded tenant membership.");
    }

    tenantContext = {
      tenantId: membership.tenantId,
      userId: membership.userId,
      role: membership.role,
    };

    installMockEmbeddingFetch();
    await closeJobWorker();
  });

  afterAll(async () => {
    await closeJobWorker();
    await getJobQueue().close();
    globalThis.fetch = originalFetch;
  });

  it("returns grounded chunks for relevant public queries and empty results for unsupported queries", async () => {
    const uniqueTag = `search-${Date.now()}`;
    const file = new File(
      [
        `Solar inverter ${uniqueTag} for EPC rooftop installations in MENA. CE documentation available. Distributor training included.`,
      ],
      "search-public.txt",
      { type: "text/plain" },
    );
    const result = await createKnowledgeDocumentFromUpload({
      tenantContext,
      uploadedByUserId: tenantContext.userId,
      file,
      title: `Search public facts ${uniqueTag}`,
      product: `Solar inverter ${uniqueTag}`,
      market: `MENA-${uniqueTag}`,
      sensitivity: "public",
    });

    startJobWorker();
    await waitForDocumentStatus({
      tenantContext,
      documentId: result.documentId,
      expected: KnowledgeDocumentStatus.READY,
    });

    const grounded = await hybridSearchKnowledgeChunks({
      tenantContext,
      userId: tenantContext.userId,
      query: `solar inverter ${uniqueTag} rooftop distributor in mena`,
      limit: 3,
      product: `Solar inverter ${uniqueTag}`,
      fetchImpl: globalThis.fetch,
    });
    expect(grounded.items.length).toBeGreaterThan(0);
    expect(grounded.items[0]?.text.toLowerCase()).toContain("solar inverter");
    expect(grounded.message).toBeNull();

    const empty = await hybridSearchKnowledgeChunks({
      tenantContext,
      userId: tenantContext.userId,
      query: "subsea cryogenic turbine for arctic drilling",
      limit: 3,
      product: `Solar inverter ${uniqueTag}`,
      fetchImpl: globalThis.fetch,
    });
    expect(empty.items).toEqual([]);
    expect(empty.message).toContain("No grounded knowledge found");
  });

  it("exposes internal-only chunks only when allowInternalOnly is enabled", async () => {
    const uniqueTag = `internal-${Date.now()}`;
    const file = new File(
      [
        `Internal quote sheet ${uniqueTag}. Reseller floor price for TS-120 inverter is confidential. Contract approval required.`,
      ],
      "search-internal.txt",
      { type: "text/plain" },
    );
    const result = await createKnowledgeDocumentFromUpload({
      tenantContext,
      uploadedByUserId: tenantContext.userId,
      file,
      title: `Internal quote sheet ${uniqueTag}`,
      product: `TS-120 inverter ${uniqueTag}`,
      market: `MENA-${uniqueTag}`,
      sensitivity: "internal_only",
    });

    startJobWorker();
    await waitForDocumentStatus({
      tenantContext,
      documentId: result.documentId,
      expected: KnowledgeDocumentStatus.READY,
    });

    const publicResults = await hybridSearchKnowledgeChunks({
      tenantContext,
      userId: tenantContext.userId,
      query: `reseller floor price ${uniqueTag} contract approval`,
      limit: 3,
      allowInternalOnly: false,
      product: `TS-120 inverter ${uniqueTag}`,
      fetchImpl: globalThis.fetch,
    });
    expect(publicResults.items).toEqual([]);

    const internalResults = await hybridSearchKnowledgeChunks({
      tenantContext,
      userId: tenantContext.userId,
      query: `reseller floor price ${uniqueTag} contract approval`,
      limit: 3,
      allowInternalOnly: true,
      product: `TS-120 inverter ${uniqueTag}`,
      fetchImpl: globalThis.fetch,
    });
    expect(internalResults.items.length).toBeGreaterThan(0);
    expect(internalResults.items[0]?.sensitivity).toBe("internal_only");
  });
});
