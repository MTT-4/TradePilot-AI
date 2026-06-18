import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEnv } from "@/lib/env";
import { KnowledgeDocumentStatus } from "@prisma/client";
import {
  closeJobWorker,
  startJobWorker,
} from "@/server/jobs/worker";
import { getJobQueue } from "@/server/jobs/service";
import {
  createKnowledgeDocumentFromUpload,
  getActiveMembershipForEmail,
  getKnowledgeDocumentRecordForTests,
  listKnowledgeReviews,
  reviewKnowledgeCard,
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
          data: [{ embedding: buildMockEmbedding(inputText) }],
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

describe("T1.5 knowledge reviews", () => {
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

  it("creates pending review cards for new chunks and exposes summary stats", async () => {
    const tag = `review-${Date.now()}`;
    const file = new File(
      [
        `Industrial pump ${tag} overview. Flow rate 120m3/h. Quote approval required for distributor pricing.`,
      ],
      "review-source.txt",
      { type: "text/plain" },
    );
    const result = await createKnowledgeDocumentFromUpload({
      tenantContext,
      uploadedByUserId: tenantContext.userId,
      file,
      title: `Review source ${tag}`,
      product: `Industrial pump ${tag}`,
      market: `GCC-${tag}`,
      sensitivity: "public",
    });

    startJobWorker();
    await waitForDocumentStatus({
      tenantContext,
      documentId: result.documentId,
      expected: KnowledgeDocumentStatus.READY,
    });

    const reviews = await listKnowledgeReviews({
      tenantContext,
      status: "pending",
    });
    const created = reviews.items.filter(
      (item) => item.document.id === result.documentId,
    );

    expect(created.length).toBeGreaterThan(0);
    expect(created[0]?.sourceCitation).toContain("Review source");
    expect(reviews.summary.documentsCount).toBeGreaterThan(0);
    expect(reviews.summary.cardsCount).toBeGreaterThan(0);
  });

  it(
    "supports approve and correct actions with sensitivity changes",
    async () => {
    const tag = `review-action-${Date.now()}`;
    const file = new File(
      [
        `Solar controller ${tag}. Initial extracted text for correction. Confidential contract appendix attached.`,
      ],
      "review-action.txt",
      { type: "text/plain" },
    );
    const result = await createKnowledgeDocumentFromUpload({
      tenantContext,
      uploadedByUserId: tenantContext.userId,
      file,
      title: `Review action ${tag}`,
      product: `Solar controller ${tag}`,
      market: `LATAM-${tag}`,
      sensitivity: "public",
    });

    startJobWorker();
    await waitForDocumentStatus({
      tenantContext,
      documentId: result.documentId,
      expected: KnowledgeDocumentStatus.READY,
    });

    const pending = await listKnowledgeReviews({
      tenantContext,
      status: "pending",
    });
    const target = pending.items.find((item) => item.document.id === result.documentId);

    if (!target) {
      throw new Error("Expected pending review for uploaded document.");
    }

    const corrected = await reviewKnowledgeCard({
      tenantContext,
      reviewId: target.id,
      reviewedByUserId: tenantContext.userId,
      action: "correct",
      correctedText: `Corrected solar controller ${tag} description for approved distributors only.`,
      sensitivity: "internal_only",
    });

    expect(corrected.status).toBe("corrected");
    expect(corrected.sensitivity).toBe("internal_only");

    const correctedList = await listKnowledgeReviews({
      tenantContext,
      status: "corrected",
    });
    const correctedItem = correctedList.items.find((item) => item.id === target.id);
    expect(correctedItem?.answer).toContain("Corrected solar controller");

    const approved = await reviewKnowledgeCard({
      tenantContext,
      reviewId: target.id,
      reviewedByUserId: tenantContext.userId,
      action: "approve",
      sensitivity: "internal_only",
    });

    expect(approved.status).toBe("approved");
    expect(approved.sensitivity).toBe("internal_only");
    },
    15000,
  );
});
