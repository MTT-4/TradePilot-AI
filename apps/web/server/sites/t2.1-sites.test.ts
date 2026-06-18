import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobStatus, KnowledgeDocumentStatus } from "@prisma/client";
import { getEnv } from "@/lib/env";
import { getTenantJobById, getJobQueue } from "@/server/jobs/service";
import { closeJobWorker, startJobWorker } from "@/server/jobs/worker";
import {
  createKnowledgeDocumentFromUpload,
  getActiveMembershipForEmail,
  getKnowledgeDocumentRecordForTests,
} from "@/server/kb/service";
import {
  applySiteChatUpdate,
  approveHitlTask,
  createSiteGenerationRequest,
  getPublicSiteLocalePageData,
  getSiteProjectDetail,
  listHitlTasks,
  requestSitePublish,
  rollbackSiteProject,
  generateSiteAutofillCandidates,
  updateAutofillCandidate,
} from "@/server/sites/service";

const originalFetch = globalThis.fetch;
const capturedPrompts: string[] = [];
const capturedTranslateRequests: Array<{
  source?: string;
  target?: string;
  text: string;
}> = [];

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

function extractPromptContent(body: unknown) {
  if (
    !body ||
    typeof body !== "object" ||
    !("messages" in body) ||
    !Array.isArray(body.messages)
  ) {
    return "";
  }

  return body.messages
    .map((message) =>
      message && typeof message === "object" && "content" in message
        ? String(message.content)
        : "",
    )
    .join("\n");
}

function extractLocales(prompt: string) {
  const match = prompt.match(/Source locale:\s*([^\n]+)/i);

  if (!match) {
    return ["en"];
  }

  return match[1]
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function extractCitations(prompt: string) {
  return prompt
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/\(([^()]+)\)$/);
      return match?.[1]?.trim() ?? null;
    })
    .filter((item): item is string => Boolean(item));
}

function buildPreviewChecks() {
  return [
    {
      key: "seo",
      label: "SEO",
      status: "pass",
      detail: "TDK 已生成。",
    },
    {
      key: "geo",
      label: "GEO",
      status: "pass",
      detail: "保留公开知识溯源。",
    },
    {
      key: "mobile",
      label: "移动端",
      status: "pass",
      detail: "首屏在窄屏下可读。",
    },
    {
      key: "form",
      label: "询盘表单",
      status: "pass",
      detail: "CTA 已收敛。",
    },
  ] as const;
}

function buildLocaleDraft(params: {
  locale: string;
  citations: string[];
  headline: string;
  includeTrustSection?: boolean;
}) {
  const sections = [
    {
      id: "hero",
      heading: params.headline,
      body: "Built from public product knowledge for export buyers.",
      bullets: ["Public-proof messaging", "Single CTA", "Export-focused draft"],
      sourceCitations: params.citations.slice(0, 1),
    },
    {
      id: "proof",
      heading: "Why buyers respond",
      body: "The draft highlights availability, capability, and export readiness.",
      bullets: ["Capability proof", "Use-case framing", "Qualification CTA"],
      sourceCitations: params.citations.slice(0, 2),
    },
  ];

  if (params.includeTrustSection) {
    sections.push({
      id: "trust",
      heading: "Buyer trust",
      body: "Adds a compact trust block without inventing unsupported customer names.",
      bullets: ["Neutral trust framing", "No fabricated testimonials"],
      sourceCitations: params.citations.slice(0, 1),
    });
  }

  return {
    locale: params.locale,
    title: `Draft ${params.locale.toUpperCase()}`,
    headline: params.headline,
    subheadline: "Conversion-oriented copy grounded in public knowledge only.",
    ctaLabel: "Request distributor pricing",
    sections,
    faq: [
      {
        question: "Is this content public-only?",
        answer: "Yes. Internal-only knowledge was excluded from retrieval.",
        sourceCitations: params.citations.slice(0, 1),
      },
    ],
    seoTitle: `Draft ${params.locale.toUpperCase()} | TradePilot`,
    seoDescription: `Public-only landing draft for ${params.locale.toUpperCase()}.`,
  };
}

function installMockSiteFetch() {
  const env = getEnv();
  const embeddingsUrl = `${env.LOCAL_BGE_BASE_URL.replace(/\/$/, "")}/embeddings`;
  const chatUrl = `${env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const translateUrl = env.GOOGLE_TRANSLATE_BASE_URL;

  globalThis.fetch = (async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === embeddingsUrl) {
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

    if (url === chatUrl) {
      const rawBody =
        typeof init?.body === "string"
          ? init.body
          : init?.body instanceof Uint8Array
            ? Buffer.from(init.body).toString("utf8")
            : "";
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const prompt = extractPromptContent(payload);
      const locales = extractLocales(prompt);
      const citations = extractCitations(prompt);
      const isChatUpdate = prompt.includes("User change request:");
      capturedPrompts.push(prompt);

      const responsePayload = {
        projectName: "Public Knowledge Site Draft",
        assistantReply: isChatUpdate
          ? "已按要求加入信任模块，并保留公开知识约束。"
          : "已基于公开知识生成站点草稿。",
        pages: [
          {
            pageType: "landing",
            slug: "home",
            title: "Landing",
            isHomepage: true,
            sections: isChatUpdate ? ["hero", "proof", "trust"] : ["hero", "proof"],
          },
        ],
        locales: locales.map((locale) =>
          buildLocaleDraft({
            locale,
            citations,
            headline: isChatUpdate
              ? `Updated ${locale.toUpperCase()} headline`
              : `${locale.toUpperCase()} landing headline`,
            includeTrustSection: isChatUpdate,
          }),
        ),
        previewChecks: buildPreviewChecks(),
        citations: citations.slice(0, 2).map((citation) => ({
          sourceCitation: citation,
          excerpt: `Excerpt from ${citation}`,
        })),
      };

      return new Response(
        JSON.stringify({
          model: "mock-gpt-4.1-mini",
          choices: [
            {
              message: {
                content: JSON.stringify(responsePayload),
              },
            },
          ],
          usage: {
            prompt_tokens: 128,
            completion_tokens: 256,
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

    if (url.startsWith(translateUrl)) {
      const rawBody =
        typeof init?.body === "string"
          ? init.body
          : init?.body instanceof Uint8Array
            ? Buffer.from(init.body).toString("utf8")
            : "";
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const source = typeof payload.source === "string" ? payload.source : undefined;
      const target = typeof payload.target === "string" ? payload.target : undefined;
      const text = typeof payload.q === "string" ? payload.q : "";
      capturedTranslateRequests.push({
        source,
        target,
        text,
      });

      return new Response(
        JSON.stringify({
          data: {
            translations: [
              {
                translatedText: `[${target}] ${text}`,
              },
            ],
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

async function waitForJobStatus(params: {
  tenantContext: {
    tenantId: string;
    userId: string;
    role: "OWNER" | "ADMIN" | "OPERATOR" | "SALES" | "VIEWER";
  };
  jobId: string;
  expected: JobStatus;
}) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const job = await getTenantJobById(params.tenantContext, params.jobId);

    if (job.status === params.expected) {
      return job;
    }

    if (job.status === JobStatus.FAILED) {
      throw new Error(`Job failed: ${job.error ?? "unknown error"}`);
    }

    await sleep(150);
  }

  throw new Error(`Timed out waiting for job ${params.expected}.`);
}

describe("T2.1 site generation", () => {
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

    installMockSiteFetch();
    await closeJobWorker();
  });

  afterAll(async () => {
    await closeJobWorker();
    await getJobQueue().close();
    globalThis.fetch = originalFetch;
  });

  it(
    "generates a draft from public knowledge only and stores locale previews",
    async () => {
      const tag = `site-public-${Date.now()}`;
      const publicTitle = `Public certificate ${tag}`;
      const internalTitle = `Internal quote ${tag}`;

      const publicDocument = await createKnowledgeDocumentFromUpload({
        tenantContext,
        uploadedByUserId: tenantContext.userId,
        file: new File(
          [
            `Solar pump ${tag} is CE certified and export ready for GCC distributors. Service response within 48 hours.`,
          ],
          "public-site.txt",
          { type: "text/plain" },
        ),
        title: publicTitle,
        product: `Solar pump ${tag}`,
        market: `GCC-${tag}`,
        sensitivity: "public",
      });
      const internalDocument = await createKnowledgeDocumentFromUpload({
        tenantContext,
        uploadedByUserId: tenantContext.userId,
        file: new File(
          [
            `Internal-only floor pricing for solar pump ${tag}. Distributor rebate schedule and confidential quote terms.`,
          ],
          "internal-site.txt",
          { type: "text/plain" },
        ),
        title: internalTitle,
        product: `Solar pump ${tag}`,
        market: `GCC-${tag}`,
        sensitivity: "internal_only",
      });

      startJobWorker();
      await waitForDocumentStatus({
        tenantContext,
        documentId: publicDocument.documentId,
        expected: KnowledgeDocumentStatus.READY,
      });
      await waitForDocumentStatus({
        tenantContext,
        documentId: internalDocument.documentId,
        expected: KnowledgeDocumentStatus.READY,
      });

      const queued = await createSiteGenerationRequest({
        tenantContext,
        requestedByUserId: tenantContext.userId,
        brief: {
          market: `GCC-${tag}`,
          product: `Solar pump ${tag}`,
          locales: ["en", "ar", "ru"],
          style: "industrial clean",
          cta: "Request distributor pricing",
        },
      });

      await waitForJobStatus({
        tenantContext,
        jobId: queued.jobId,
        expected: JobStatus.SUCCEEDED,
      });

      const detail = await getSiteProjectDetail(tenantContext, queued.siteId);
      expect(detail.project.status).toBe("draft");
      expect(detail.locales.map((item) => item.locale)).toEqual(["en", "ar", "ru"]);
      expect(detail.locales.find((item) => item.locale === "ar")?.direction).toBe("rtl");
      expect(detail.locales.every((item) => item.urlPath.endsWith(`/${item.locale}`))).toBe(true);
      expect(detail.locales.every((item) => item.urlPath.startsWith("/site/"))).toBe(true);
      expect(detail.version?.citations.length).toBeGreaterThan(0);
      expect(
        detail.version?.citations.some((item) => item.sourceCitation.includes(publicTitle)),
      ).toBe(true);
      expect(
        detail.version?.citations.some((item) => item.sourceCitation.includes(internalTitle)),
      ).toBe(false);
      expect(capturedPrompts.some((prompt) => prompt.includes(publicTitle))).toBe(true);
      expect(capturedPrompts.some((prompt) => prompt.includes(internalTitle))).toBe(false);
      expect(capturedTranslateRequests.some((item) => item.target === "ar")).toBe(true);
      expect(capturedTranslateRequests.some((item) => item.target === "ru")).toBe(true);
      expect(
        (
          detail.locales.find((item) => item.locale === "ar")?.translatedContent as {
            headline: string;
          }
        ).headline.startsWith("[ar]"),
      ).toBe(true);
      expect(
        (
          detail.locales.find((item) => item.locale === "ru")?.translatedContent as {
            headline: string;
          }
        ).headline.startsWith("[ru]"),
      ).toBe(true);
      expect(detail.version?.hreflangs).toHaveLength(3);
      expect(detail.version?.previewChecks.map((item) => item.key)).toEqual([
        "seo",
        "geo",
        "mobile",
        "form",
        "share",
      ]);

      const publicPage = await getPublicSiteLocalePageData({
        slug: detail.project.slug,
        locale: "ar",
        allowDraft: true,
      });
      expect(publicPage.locale.direction).toBe("rtl");
      expect(publicPage.locale.quickAnswer.length).toBeGreaterThan(0);
      expect(publicPage.absoluteUrl.endsWith(`/site/${detail.project.slug}/ar`)).toBe(true);
      expect(publicPage.version?.robots.allowAiBots).toBe(true);
      expect(JSON.stringify(publicPage.jsonLd)).toContain("FAQPage");
    },
    20000,
  );

  it(
    "creates a new version when chat updates the site draft",
    async () => {
      const tag = `site-chat-${Date.now()}`;
      const publicTitle = `Public manual ${tag}`;

    const publicDocument = await createKnowledgeDocumentFromUpload({
      tenantContext,
      uploadedByUserId: tenantContext.userId,
      file: new File(
        [
          `Industrial compressor ${tag} includes CE documents, fast export packing, and multilingual support.`,
        ],
        "public-chat.txt",
        { type: "text/plain" },
      ),
      title: publicTitle,
      product: `Industrial compressor ${tag}`,
      market: `MENA-${tag}`,
      sensitivity: "public",
    });

    startJobWorker();
    await waitForDocumentStatus({
      tenantContext,
      documentId: publicDocument.documentId,
      expected: KnowledgeDocumentStatus.READY,
    });

    const queued = await createSiteGenerationRequest({
      tenantContext,
      requestedByUserId: tenantContext.userId,
      brief: {
        market: `MENA-${tag}`,
        product: `Industrial compressor ${tag}`,
        locales: ["en", "ar"],
        style: "credible technical",
        cta: "Request distributor pricing",
      },
    });

    await waitForJobStatus({
      tenantContext,
      jobId: queued.jobId,
      expected: JobStatus.SUCCEEDED,
    });

    const updated = await applySiteChatUpdate({
      tenantContext,
      siteId: queued.siteId,
      message: "Add a compact buyer trust block without inventing customer names.",
      requestedByUserId: tenantContext.userId,
      fetchImpl: globalThis.fetch,
    });

    expect(updated.version?.versionNumber).toBe(2);
    expect(
      updated.locales.every((locale) =>
        (
          locale.translatedContent as {
            sections: Array<{ id: string }>;
          }
        ).sections.some((section) => section.id === "trust"),
      ),
    ).toBe(true);
    expect(
      updated.version?.conversation.some((item) =>
        item.role === "user" && item.content.includes("buyer trust block"),
      ),
    ).toBe(true);
      expect(
        updated.version?.conversation.some((item) =>
          item.role === "assistant" && item.content.includes("信任模块"),
        ),
      ).toBe(true);
    },
    20000,
  );

  it(
    "requires HITL approval before a site goes live and supports rollback",
    async () => {
      const tag = `site-publish-${Date.now()}`;
      const publicDoc = await createKnowledgeDocumentFromUpload({
        tenantContext,
        uploadedByUserId: tenantContext.userId,
        file: new File(
          [`Pressure vessel ${tag} is export ready and carries public compliance support.`],
          "publish-site.txt",
          { type: "text/plain" },
        ),
        title: `Publish source ${tag}`,
        product: `Pressure vessel ${tag}`,
        market: `EU-${tag}`,
        sensitivity: "public",
      });

      startJobWorker();
      await waitForDocumentStatus({
        tenantContext,
        documentId: publicDoc.documentId,
        expected: KnowledgeDocumentStatus.READY,
      });

      const queued = await createSiteGenerationRequest({
        tenantContext,
        requestedByUserId: tenantContext.userId,
        brief: {
          market: `EU-${tag}`,
          product: `Pressure vessel ${tag}`,
          locales: ["en", "ar"],
          style: "credible technical",
          cta: "Request distributor pricing",
        },
      });
      await waitForJobStatus({
        tenantContext,
        jobId: queued.jobId,
        expected: JobStatus.SUCCEEDED,
      });

      const initial = await getSiteProjectDetail(tenantContext, queued.siteId);
      await expect(
        getPublicSiteLocalePageData({
          slug: initial.project.slug,
          locale: "en",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      const publishRequest = await requestSitePublish({
        tenantContext,
        siteId: queued.siteId,
        requestedByUserId: tenantContext.userId,
      });
      expect(publishRequest.hitlTaskId).toBeTruthy();

      const pendingTasks = await listHitlTasks({
        tenantContext,
        status: "pending",
      });
      expect(
        pendingTasks.items.some((item) => item.id === publishRequest.hitlTaskId),
      ).toBe(true);

      await approveHitlTask({
        tenantContext,
        hitlTaskId: publishRequest.hitlTaskId,
        approvedByUserId: tenantContext.userId,
      });

      const published = await getSiteProjectDetail(tenantContext, queued.siteId);
      expect(published.project.status).toBe("published");
      expect(
        published.locales.every((item) => item.publishStatus === "published"),
      ).toBe(true);

      const livePage = await getPublicSiteLocalePageData({
        slug: published.project.slug,
        locale: "en",
      });
      expect(livePage.project.status).toBe("published");

      const edited = await applySiteChatUpdate({
        tenantContext,
        siteId: queued.siteId,
        message: "Add a compact buyer trust block without inventing customer names.",
        requestedByUserId: tenantContext.userId,
        fetchImpl: globalThis.fetch,
      });
      expect(edited.project.status).toBe("draft");
      expect(edited.version?.versionNumber).toBeGreaterThan(1);

      const rolledBack = await rollbackSiteProject({
        tenantContext,
        siteId: queued.siteId,
        versionId: published.version!.id,
        requestedByUserId: tenantContext.userId,
      });
      expect(rolledBack.project.status).toBe("published");
      expect(rolledBack.version?.versionNumber).toBeGreaterThan(edited.version!.versionNumber);
      expect(
        rolledBack.locales.every((locale) =>
          (
            locale.translatedContent as {
              sections: Array<{ id: string }>;
            }
          ).sections.every((section) => section.id !== "trust"),
        ),
      ).toBe(true);

      const rolledBackLivePage = await getPublicSiteLocalePageData({
        slug: rolledBack.project.slug,
        locale: "en",
      });
      expect(rolledBackLivePage.project.status).toBe("published");
      expect(
        rolledBackLivePage.locale.translatedContent.sections.every(
          (section) => section.id !== "trust",
        ),
      ).toBe(true);
    },
    20000,
  );

  it(
    "generates autofill candidates that require approval before they are applied",
    async () => {
      const tag = `site-autofill-${Date.now()}`;
      const publicDoc = await createKnowledgeDocumentFromUpload({
        tenantContext,
        uploadedByUserId: tenantContext.userId,
        file: new File(
          [
            `Industrial dryer ${tag} offers corrosion-resistant assembly, CE support, and export packaging for distributors.`,
          ],
          "autofill-site.txt",
          { type: "text/plain" },
        ),
        title: `Autofill source ${tag}`,
        product: `Industrial dryer ${tag}`,
        market: `LATAM-${tag}`,
        sensitivity: "public",
      });

      startJobWorker();
      await waitForDocumentStatus({
        tenantContext,
        documentId: publicDoc.documentId,
        expected: KnowledgeDocumentStatus.READY,
      });

      const queued = await createSiteGenerationRequest({
        tenantContext,
        requestedByUserId: tenantContext.userId,
        brief: {
          market: `LATAM-${tag}`,
          product: `Industrial dryer ${tag}`,
          locales: ["en", "ru"],
          style: "industrial clean",
          cta: "Request distributor pricing",
        },
      });
      await waitForJobStatus({
        tenantContext,
        jobId: queued.jobId,
        expected: JobStatus.SUCCEEDED,
      });

      await requestSitePublish({
        tenantContext,
        siteId: queued.siteId,
        requestedByUserId: tenantContext.userId,
      }).then((task) =>
        approveHitlTask({
          tenantContext,
          hitlTaskId: task.hitlTaskId,
          approvedByUserId: tenantContext.userId,
        }),
      );

      const generated = await generateSiteAutofillCandidates({
        tenantContext,
        siteId: queued.siteId,
        requestedByUserId: tenantContext.userId,
        fetchImpl: globalThis.fetch,
      });
      expect(generated.version?.autofillCandidates.length).toBeGreaterThan(0);

      const candidate = generated.version!.autofillCandidates[0]!;
      const updated = await updateAutofillCandidate({
        tenantContext,
        siteId: queued.siteId,
        candidateId: candidate.id,
        requestedByUserId: tenantContext.userId,
        body: `${candidate.body} Edited candidate body for approval.`,
      });
      const updatedCandidate = updated.version!.autofillCandidates.find(
        (item: { id: string }) => item.id === candidate.id,
      );
      expect(updatedCandidate?.body).toContain("Edited candidate body");

      const task = await requestSitePublish({
        tenantContext,
        siteId: queued.siteId,
        requestedByUserId: tenantContext.userId,
        mode: "autofill_candidate",
        candidateId: candidate.id,
      });
      const beforeApprove = await getSiteProjectDetail(tenantContext, queued.siteId);
      expect(
        beforeApprove.locales.every((locale) =>
          (
            locale.translatedContent as {
              sections: Array<{ id: string }>;
            }
          ).sections.every(
            (section) => section.id !== `autofill-${candidate.id}`,
          ),
        ),
      ).toBe(true);

      await approveHitlTask({
        tenantContext,
        hitlTaskId: task.hitlTaskId,
        approvedByUserId: tenantContext.userId,
      });

      const afterApprove = await getSiteProjectDetail(tenantContext, queued.siteId);
      expect(afterApprove.project.status).toBe("published");
      expect(
        afterApprove.locales.every((locale) =>
          (
            locale.translatedContent as {
              sections: Array<{ id: string }>;
            }
          ).sections.some(
            (section) => section.id === `autofill-${candidate.id}`,
          ),
        ),
      ).toBe(true);
      expect(
        afterApprove.version?.autofillCandidates.find(
          (item: { id: string }) => item.id === candidate.id,
        )
          ?.status,
      ).toBe("applied");
    },
    20000,
  );
});
