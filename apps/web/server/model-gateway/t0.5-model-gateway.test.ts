import {
  JobType,
  KnowledgeSensitivity,
  ModelRoute,
  ModelTaskType,
} from "@prisma/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getPrismaClient } from "@/server/db/prisma";
import { createModelGateway } from "@/server/model-gateway";
import type { TenantContext } from "@/server/db/tenant-context";

const prisma = getPrismaClient();

let tenantContextA: TenantContext;

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createGatewayFetchMock(options?: {
  localQwenAvailable?: boolean;
  localBgeAvailable?: boolean;
  classifierContainsPii?: boolean;
}) {
  const counters = {
    openai: 0,
    google: 0,
    localQwen: 0,
    localBge: 0,
  };
  const requests: Array<{ url: string; body: unknown }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;

    requests.push({
      url,
      body,
    });

    if (url.startsWith(process.env.OPENAI_BASE_URL!)) {
      counters.openai += 1;

      return jsonResponse({
        model: process.env.OPENAI_MODEL,
        choices: [
          {
            message: {
              content: "OpenAI marketing output",
            },
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 12,
        },
      });
    }

    if (url.startsWith(process.env.GOOGLE_TRANSLATE_BASE_URL!)) {
      counters.google += 1;

      return jsonResponse({
        data: {
          translations: [
            {
              translatedText: "Translated marketing copy",
            },
          ],
        },
      });
    }

    if (url.startsWith(process.env.LOCAL_QWEN_BASE_URL!)) {
      counters.localQwen += 1;

      if (options?.localQwenAvailable === false) {
        return jsonResponse(
          {
            error: {
              message: "local qwen unavailable",
            },
          },
          503,
        );
      }

      const isClassifierCall =
        typeof body === "object" &&
        body !== null &&
        "messages" in body &&
        Array.isArray(body.messages) &&
        typeof body.messages[0]?.content === "string" &&
        body.messages[0].content.includes("Classify whether");

      if (isClassifierCall) {
        return jsonResponse({
          model: process.env.LOCAL_QWEN_MODEL,
          choices: [
            {
              message: {
                content: JSON.stringify({
                  containsPii: options?.classifierContainsPii ?? true,
                  reason: "local_classifier_detected_customer_context",
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 18,
            completion_tokens: 8,
          },
        });
      }

      return jsonResponse({
        model: process.env.LOCAL_QWEN_MODEL,
        choices: [
          {
            message: {
              content: "Local Qwen output",
            },
          },
        ],
        usage: {
          prompt_tokens: 24,
          completion_tokens: 16,
        },
      });
    }

    if (url.startsWith(process.env.LOCAL_BGE_BASE_URL!)) {
      counters.localBge += 1;

      if (options?.localBgeAvailable === false) {
        return jsonResponse(
          {
            error: {
              message: "local bge unavailable",
            },
          },
          503,
        );
      }

      return jsonResponse({
        model: process.env.LOCAL_BGE_MODEL,
        data: [
          {
            embedding: [0.12, 0.34, 0.56, 0.78],
          },
        ],
        usage: {
          prompt_tokens: 11,
        },
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });

  return {
    fetchMock,
    counters,
    requests,
  };
}

beforeAll(async () => {
  process.env.OPENAI_BASE_URL = "https://mock.openai.test/v1";
  process.env.OPENAI_MODEL = "gpt-4.1-mini";
  process.env.GOOGLE_TRANSLATE_BASE_URL =
    "https://mock.google.test/v2";
  process.env.LOCAL_QWEN_BASE_URL = "https://mock.local-qwen.test/v1";
  process.env.LOCAL_QWEN_MODEL = "qwen-mock";
  process.env.LOCAL_BGE_BASE_URL = "https://mock.local-bge.test/v1";
  process.env.LOCAL_BGE_MODEL = "bge-mock";
  process.env.OPENAI_API_KEY = "openai-test-key";
  process.env.GOOGLE_TRANSLATE_KEY = "google-test-key";

  const membership = await prisma.membership.findFirst({
    where: {
      tenant: {
        slug: "shenghai-machinery",
      },
      user: {
        email: "owner-a@tradepilot.local",
      },
      status: "ACTIVE",
    },
    select: {
      tenantId: true,
      userId: true,
      role: true,
    },
  });

  if (!membership) {
    throw new Error(
      "Seed data missing. Run `npm run prisma:seed` before T0.5 tests.",
    );
  }

  tenantContextA = membership;
});

describe("T0.5 model gateway privacy routing", () => {
  it("R2.1 routes internal_only knowledge to local_qwen and keeps third-party prompts clean", async () => {
    const { fetchMock, counters, requests } = createGatewayFetchMock();
    const gateway = createModelGateway({
      fetchImpl: fetchMock,
    });

    const result = await gateway.invoke({
      tenantContext: tenantContextA,
      userId: tenantContextA.userId,
      taskType: ModelTaskType.GENERATE,
      prompt: "Draft a product positioning paragraph for the Middle East market.",
      systemPrompt: "You are a marketing strategist.",
      sensitivity: KnowledgeSensitivity.PUBLIC,
      knowledgeChunks: [
        {
          text: "Distributor floor price for TS-75 is confidential and only available to approved resellers.",
          sensitivity: KnowledgeSensitivity.INTERNAL_ONLY,
          sourceCitation: "Quote sheet line 4",
        },
      ],
      requestSummary: "r2.1 internal knowledge route",
    });

    expect(result.route).toBe(ModelRoute.LOCAL_QWEN);
    expect(result.containsPii).toBe(true);
    expect(counters.openai).toBe(0);
    expect(counters.google).toBe(0);
    expect(counters.localQwen).toBe(1);

    const localRequest = requests.find((entry) =>
      entry.url.startsWith(process.env.LOCAL_QWEN_BASE_URL!),
    );
    expect(JSON.stringify(localRequest?.body)).toContain(
      "Distributor floor price for TS-75 is confidential",
    );

    const invocation = await prisma.modelInvocation.findUniqueOrThrow({
      where: {
        id: result.invocationId,
      },
      select: {
        route: true,
        containsPii: true,
      },
    });

    expect(invocation).toMatchObject({
      route: ModelRoute.LOCAL_QWEN,
      containsPii: true,
    });

    const ledger = await prisma.creditLedger.findFirst({
      where: {
        modelInvocationId: result.invocationId,
      },
      select: {
        id: true,
      },
    });

    expect(ledger?.id).toBeTruthy();
  });

  it("R2.2 sends inquiry-like content to local_qwen and never calls OpenAI", async () => {
    const { fetchMock, counters } = createGatewayFetchMock();
    const gateway = createModelGateway({
      fetchImpl: fetchMock,
    });

    const result = await gateway.invoke({
      tenantContext: tenantContextA,
      userId: tenantContextA.userId,
      taskType: ModelTaskType.GENERATE,
      prompt:
        "Customer inquiry from jane@example.com, phone +971 50 123 4567: We need a TS-75 quote for Dubai delivery.",
      requestSummary: "r2.2 privacy inquiry route",
    });

    expect(result.route).toBe(ModelRoute.LOCAL_QWEN);
    expect(result.containsPii).toBe(true);
    expect(counters.openai).toBe(0);
    expect(counters.google).toBe(0);
    expect(counters.localQwen).toBe(1);
  });

  it("R2.3 returns LOCAL_MODEL_UNAVAILABLE, queues a job, and never falls back", async () => {
    const { fetchMock, counters } = createGatewayFetchMock({
      localQwenAvailable: false,
    });
    const gateway = createModelGateway({
      fetchImpl: fetchMock,
    });

    await expect(
      gateway.invoke({
        tenantContext: tenantContextA,
        userId: tenantContextA.userId,
        taskType: ModelTaskType.GENERATE,
        prompt:
          "Inquiry from sam@example.com asking for internal distributor terms.",
        requestSummary: "r2.3 local unavailable",
        queueOnLocalFailure: {
          type: JobType.GENERATE_REPLY,
          idempotencyKey: `r2-3-${Date.now()}`,
          input: {
            inquiryId: "probe-inquiry",
          },
        },
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "LOCAL_MODEL_UNAVAILABLE",
    });

    expect(counters.openai).toBe(0);
    expect(counters.google).toBe(0);

    const queuedJob = await prisma.job.findFirstOrThrow({
      where: {
        tenantId: tenantContextA.tenantId,
        type: JobType.GENERATE_REPLY,
        input: {
          path: ["inquiryId"],
          equals: "probe-inquiry",
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        status: true,
      },
    });

    expect(queuedJob.status).toBe("QUEUED");
  });

  it("R2.4 marks sensitive embeddings as local_bge with containsPii=true", async () => {
    const { fetchMock } = createGatewayFetchMock();
    const gateway = createModelGateway({
      fetchImpl: fetchMock,
    });

    const result = await gateway.embed({
      tenantContext: tenantContextA,
      userId: tenantContextA.userId,
      taskType: ModelTaskType.EMBED,
      text: "Contact james@example.com about the confidential distributor agreement.",
      requestSummary: "r2.4 sensitive embedding",
    });

    if (!result) {
      throw new Error("Expected embed result.");
    }

    expect(result.route).toBe(ModelRoute.LOCAL_BGE);
    expect(result.containsPii).toBe(true);
    expect(result.embedding.length).toBe(4);

    const invocation = await prisma.modelInvocation.findUniqueOrThrow({
      where: {
        id: result.invocationId,
      },
      select: {
        route: true,
        containsPii: true,
      },
    });

    expect(invocation).toMatchObject({
      route: ModelRoute.LOCAL_BGE,
      containsPii: true,
    });
  });

  it("R2.5 runs classifier locally and never calls OpenAI or Google during classification", async () => {
    const { fetchMock, counters } = createGatewayFetchMock({
      classifierContainsPii: true,
    });
    const gateway = createModelGateway({
      fetchImpl: fetchMock,
    });

    const result = await gateway.invoke({
      tenantContext: tenantContextA,
      userId: tenantContextA.userId,
      taskType: ModelTaskType.GENERATE,
      prompt: "Review this customer note and prepare the safest possible response.",
      requestSummary: "r2.5 local classifier only",
    });

    expect(result.route).toBe(ModelRoute.LOCAL_QWEN);
    expect(result.containsPii).toBe(true);
    expect(counters.openai).toBe(0);
    expect(counters.google).toBe(0);
    expect(counters.localQwen).toBe(2);

    const classifierInvocation = await prisma.modelInvocation.findFirstOrThrow({
      where: {
        tenantId: tenantContextA.tenantId,
        taskType: ModelTaskType.CLASSIFY,
        requestSummary: {
          contains: "r2.5 local classifier only",
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        route: true,
      },
    });

    expect(classifierInvocation.route).toBe(ModelRoute.LOCAL_QWEN);
  });
});
