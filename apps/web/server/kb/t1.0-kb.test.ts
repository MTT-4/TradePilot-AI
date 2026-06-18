import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { KnowledgeDocumentStatus } from "@prisma/client";
import * as xlsx from "xlsx";
import {
  closeJobWorker,
  startJobWorker,
} from "@/server/jobs/worker";
import { getJobQueue } from "@/server/jobs/service";
import {
  createKnowledgeDocumentFromUpload,
  createKnowledgeDocumentFromUrl,
  getActiveMembershipForEmail,
  getKnowledgeDocumentDetail,
  getKnowledgeDocumentRecordForTests,
  getParsedKnowledgeDocumentText,
  listKnowledgeDocuments,
  retryKnowledgeDocumentParse,
} from "@/server/kb/service";

const TEST_EMAIL = "owner-a@tradepilot.local";

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

  beforeAll(async () => {
    const membership = await getActiveMembershipForEmail(TEST_EMAIL);

    if (!membership) {
      throw new Error("Expected seeded tenant membership.");
    }

    tenantContext = {
      tenantId: membership.tenantId,
      userId: membership.userId,
      role: membership.role,
    };

    await closeJobWorker();
  });

  afterAll(async () => {
    await closeJobWorker();
    await getJobQueue().close();
  });

  it("creates an uploaded knowledge document, parses it, and exposes list/detail state", async () => {
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
      expected: KnowledgeDocumentStatus.CHUNKING,
      allowIntermediates: [
        KnowledgeDocumentStatus.UPLOADED,
        KnowledgeDocumentStatus.PARSING,
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
    expect(detail.status).toBe("chunking");
    expect(detail.chunkCount).toBe(0);
    expect(detail.pendingReviewCount).toBe(0);

    const list = await listKnowledgeDocuments(tenantContext);
    expect(list.items.some((item) => item.id === result.documentId)).toBe(true);
  });

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
      expected: KnowledgeDocumentStatus.CHUNKING,
      allowIntermediates: [
        KnowledgeDocumentStatus.UPLOADED,
        KnowledgeDocumentStatus.PARSING,
        KnowledgeDocumentStatus.FAILED,
      ],
    });
    expect(settled.document?.status).toBe(KnowledgeDocumentStatus.CHUNKING);

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
});
