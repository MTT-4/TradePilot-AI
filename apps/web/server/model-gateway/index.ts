import {
  JobType,
  KnowledgeSensitivity,
  ModelRoute,
  ModelTaskType,
  Prisma,
} from "@prisma/client";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/server/api/errors";
import type { TenantContext } from "@/server/db/tenant-context";
import { getTenantPrisma } from "@/server/db/tenant-prisma";

type FetchLike = typeof fetch;

type KnowledgeChunkInput = {
  text: string;
  sensitivity: KnowledgeSensitivity;
  sourceCitation?: string | null;
};

type QueueOnLocalFailure = {
  type: JobType;
  input: Prisma.InputJsonValue;
  idempotencyKey?: string;
};

type GatewayCommonInput = {
  tenantContext: TenantContext;
  userId?: string;
  taskType: ModelTaskType;
  requestSummary?: string;
  sensitivity?: KnowledgeSensitivity;
  knowledgeChunks?: KnowledgeChunkInput[];
  queueOnLocalFailure?: QueueOnLocalFailure;
};

export type InvokeInput = GatewayCommonInput & {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
};

export type TranslateInput = GatewayCommonInput & {
  text: string;
  targetLocale: string;
  sourceLocale?: string;
};

export type EmbedInput = GatewayCommonInput & {
  text: string;
};

type ProviderTextResponse = {
  text: string;
  modelName: string;
  tokensInput?: number;
  tokensOutput?: number;
  costUsd?: number;
};

type ProviderEmbeddingResponse = {
  embedding: number[];
  modelName: string;
  tokensInput?: number;
  costUsd?: number;
};

type LoggedResult<TResult> = TResult & {
  route: ModelRoute;
  containsPii: boolean;
  invocationId: string;
};

type DataClassifierResult = {
  containsPii: boolean;
  reason: string;
};

const EMAIL_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_CANDIDATE_PATTERN =
  /(?:\+?\d[\d\s().-]{6,}\d)/g;
const PRIVACY_KEYWORDS = [
  "inquiry",
  "customer inquiry",
  "quotation",
  "quote",
  "contract",
  "confidential",
  "internal only",
  "private pricing",
  "reseller price",
  "floor price",
  "lead",
  "客户",
  "询盘",
  "报价",
  "合同",
  "仅内部",
  "内部资料",
  "联系人",
  "电话",
  "邮箱",
];

function trimSummary(summary: string | undefined, fallback: string) {
  const value = (summary ?? fallback).replace(/\s+/g, " ").trim();

  if (!value) {
    return undefined;
  }

  return value.slice(0, 240);
}

function buildKnowledgeContext(
  knowledgeChunks: KnowledgeChunkInput[] | undefined,
  allowInternalOnly: boolean,
) {
  const visibleChunks = (knowledgeChunks ?? []).filter((chunk) =>
    allowInternalOnly ? true : chunk.sensitivity === KnowledgeSensitivity.PUBLIC,
  );

  if (visibleChunks.length === 0) {
    return "";
  }

  const entries = visibleChunks.map((chunk, index) => {
    const citation = chunk.sourceCitation
      ? ` (${chunk.sourceCitation})`
      : "";

    return `${index + 1}. ${chunk.text}${citation}`;
  });

  return `Knowledge Context:\n${entries.join("\n")}`;
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function extractAssistantText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (
          item &&
          typeof item === "object" &&
          "type" in item &&
          item.type === "text" &&
          "text" in item
        ) {
          return typeof item.text === "string" ? item.text : "";
        }

        return "";
      })
      .join("")
      .trim();
  }

  return "";
}

function getCreditsDelta(
  costUsd: number | undefined,
  tokensInput: number | undefined,
  tokensOutput: number | undefined,
) {
  if (costUsd && Number.isFinite(costUsd) && costUsd > 0) {
    return new Prisma.Decimal(-(costUsd * 100).toFixed(2));
  }

  const tokenTotal = (tokensInput ?? 0) + (tokensOutput ?? 0);

  if (tokenTotal <= 0) {
    return new Prisma.Decimal("0");
  }

  return new Prisma.Decimal((-(tokenTotal / 1000)).toFixed(2));
}

async function parseProviderError(
  response: Response,
  fallbackMessage: string,
) {
  try {
    const payload = await response.json();

    if (
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
    ) {
      return payload.error.message;
    }
  } catch {
    return fallbackMessage;
  }

  return fallbackMessage;
}

async function callOpenAiCompatibleTextModel(params: {
  fetchImpl: FetchLike;
  baseUrl: string;
  model: string;
  apiKey?: string;
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
}) {
  const messages = [];

  if (params.systemPrompt?.trim()) {
    messages.push({
      role: "system",
      content: params.systemPrompt,
    });
  }

  messages.push({
    role: "user",
    content: params.userPrompt,
  });

  const response = await params.fetchImpl(
    `${params.baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.apiKey
          ? {
              Authorization: `Bearer ${params.apiKey}`,
            }
          : {}),
      },
      body: JSON.stringify({
        model: params.model,
        messages,
        temperature: params.temperature ?? 0.2,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      await parseProviderError(response, "Model request failed."),
    );
  }

  const payload = await response.json();
  const choice = payload?.choices?.[0];
  const text = extractAssistantText(choice?.message?.content);

  return {
    text,
    modelName: typeof payload?.model === "string" ? payload.model : params.model,
    tokensInput:
      typeof payload?.usage?.prompt_tokens === "number"
        ? payload.usage.prompt_tokens
        : undefined,
    tokensOutput:
      typeof payload?.usage?.completion_tokens === "number"
        ? payload.usage.completion_tokens
        : undefined,
    costUsd: undefined,
  } satisfies ProviderTextResponse;
}

async function callOpenAiCompatibleEmbeddingModel(params: {
  fetchImpl: FetchLike;
  baseUrl: string;
  model: string;
  apiKey?: string;
  input: string;
}) {
  const response = await params.fetchImpl(
    `${params.baseUrl.replace(/\/$/, "")}/embeddings`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.apiKey
          ? {
              Authorization: `Bearer ${params.apiKey}`,
            }
          : {}),
      },
      body: JSON.stringify({
        model: params.model,
        input: params.input,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      await parseProviderError(response, "Embedding request failed."),
    );
  }

  const payload = await response.json();
  const embedding = payload?.data?.[0]?.embedding;

  if (!Array.isArray(embedding)) {
    throw new Error("Embedding response did not include vector data.");
  }

  return {
    embedding,
    modelName: typeof payload?.model === "string" ? payload.model : params.model,
    tokensInput:
      typeof payload?.usage?.prompt_tokens === "number"
        ? payload.usage.prompt_tokens
        : undefined,
    costUsd: undefined,
  } satisfies ProviderEmbeddingResponse;
}

async function callGoogleTranslate(params: {
  fetchImpl: FetchLike;
  baseUrl: string;
  apiKey: string;
  text: string;
  targetLocale: string;
  sourceLocale?: string;
}) {
  const payload = {
    q: params.text,
    target: params.targetLocale,
    ...(params.sourceLocale
      ? {
          source: params.sourceLocale,
        }
      : {}),
    format: "text",
  };

  const response = await params.fetchImpl(
    `${params.baseUrl}?key=${encodeURIComponent(params.apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(
      await parseProviderError(response, "Translate request failed."),
    );
  }

  const body = await response.json();
  const translatedText =
    body?.data?.translations?.[0]?.translatedText;

  if (typeof translatedText !== "string") {
    throw new Error("Translate response did not include translatedText.");
  }

  return {
    text: translatedText,
    modelName: "google-translate",
    tokensInput: estimateTokens(params.text),
    tokensOutput: estimateTokens(translatedText),
    costUsd: undefined,
  } satisfies ProviderTextResponse;
}

async function recordInvocation(params: {
  tenantContext: TenantContext;
  userId?: string;
  route: ModelRoute;
  taskType: ModelTaskType;
  modelName: string;
  containsPii: boolean;
  reason: string;
  requestSummary?: string;
  latencyMs: number;
  tokensInput?: number;
  tokensOutput?: number;
  costUsd?: number;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const creditsDelta = getCreditsDelta(
    params.costUsd,
    params.tokensInput,
    params.tokensOutput,
  );

  return tenantPrisma.$transaction(async (tx) => {
    const current = await tx.creditLedger.aggregate({
      _sum: {
        deltaCredits: true,
      },
    });
    const currentBalance = current._sum.deltaCredits ?? new Prisma.Decimal("0");
    const balanceAfter = currentBalance.add(creditsDelta);
    const invocation = await tx.modelInvocation.create({
      data: {
        tenantId: params.tenantContext.tenantId,
        userId: params.userId,
        route: params.route,
        taskType: params.taskType,
        modelName: params.modelName,
        containsPii: params.containsPii,
        tokensInput: params.tokensInput,
        tokensOutput: params.tokensOutput,
        latencyMs: params.latencyMs,
        costUsd:
          params.costUsd !== undefined
            ? new Prisma.Decimal(params.costUsd.toFixed(4))
            : undefined,
        reason: params.reason,
        requestSummary: params.requestSummary,
      },
      select: {
        id: true,
      },
    });

    await tx.creditLedger.create({
      data: {
        tenantId: params.tenantContext.tenantId,
        userId: params.userId,
        modelInvocationId: invocation.id,
        deltaCredits: creditsDelta,
        balanceAfter,
        description: `${params.route.toLowerCase()} ${params.taskType.toLowerCase()}`,
      },
    });

    return invocation.id;
  });
}

async function queueLocalRetry(params: {
  tenantContext: TenantContext;
  userId?: string;
  queue: QueueOnLocalFailure;
  reason: string;
}) {
  const tenantPrisma = getTenantPrisma(params.tenantContext);

  if (params.queue.idempotencyKey) {
    const existing = await tenantPrisma.job.findFirst({
      where: {
        idempotencyKey: params.queue.idempotencyKey,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      return existing.id;
    }
  }

  const job = await tenantPrisma.job.create({
    data: {
      tenantId: params.tenantContext.tenantId,
      requestedByUserId: params.userId,
      type: params.queue.type,
      status: "QUEUED",
      progress: 0,
      attempts: 0,
      maxAttempts: 3,
      idempotencyKey: params.queue.idempotencyKey,
      input: params.queue.input,
      error: params.reason,
    },
    select: {
      id: true,
    },
  });

  return job.id;
}

function buildLocalUnavailableError(message: string, details?: unknown) {
  return new ApiError(
    503,
    "LOCAL_MODEL_UNAVAILABLE",
    message,
    details ?? {},
  );
}

function isLikelySensitiveText(text: string) {
  const normalized = text.trim();

  if (!normalized) {
    return false;
  }

  if (EMAIL_PATTERN.test(normalized) || containsPhoneNumber(normalized)) {
    return true;
  }

  const lower = normalized.toLowerCase();

  return PRIVACY_KEYWORDS.some((keyword) =>
    lower.includes(keyword.toLowerCase()),
  );
}

function containsPhoneNumber(text: string) {
  const candidates = text.match(PHONE_CANDIDATE_PATTERN) ?? [];

  return candidates.some((candidate) => {
    const digitsOnly = candidate.replace(/\D/g, "");

    if (digitsOnly.length < 7 || digitsOnly.length > 15) {
      return false;
    }

    if (/[+\s().-]/.test(candidate)) {
      return true;
    }

    return /\b(phone|tel|mobile|whatsapp|call|电话|手机)\b/i.test(text);
  });
}

async function classifySensitivity(params: {
  fetchImpl: FetchLike;
  tenantContext: TenantContext;
  userId?: string;
  taskType: ModelTaskType;
  text: string;
  sensitivity?: KnowledgeSensitivity;
  knowledgeChunks?: KnowledgeChunkInput[];
  requestSummary?: string;
}) {
  if (params.sensitivity === KnowledgeSensitivity.INTERNAL_ONLY) {
    return {
      containsPii: true,
      reason: "explicit_internal_only",
    } satisfies DataClassifierResult;
  }

  if (
    (params.knowledgeChunks ?? []).some(
      (chunk) => chunk.sensitivity === KnowledgeSensitivity.INTERNAL_ONLY,
    )
  ) {
    return {
      containsPii: true,
      reason: "internal_knowledge_attached",
    } satisfies DataClassifierResult;
  }

  if (isLikelySensitiveText(params.text)) {
    return {
      containsPii: true,
      reason: "rules_detected_sensitive_content",
    } satisfies DataClassifierResult;
  }

  if (params.sensitivity === KnowledgeSensitivity.PUBLIC) {
    return {
      containsPii: false,
      reason: "explicit_public",
    } satisfies DataClassifierResult;
  }

  const env = getEnv();
  const startedAt = Date.now();

  try {
    const result = await callOpenAiCompatibleTextModel({
      fetchImpl: params.fetchImpl,
      baseUrl: env.LOCAL_QWEN_BASE_URL,
      model: env.LOCAL_QWEN_MODEL,
      systemPrompt:
        "Classify whether the input contains customer personal data, inquiry content, internal business material, quotes, contracts, or confidential information. Reply with only JSON: {\"containsPii\":true|false,\"reason\":\"...\"}. Default to true when unsure.",
      userPrompt: params.text,
      temperature: 0,
    });
    const latencyMs = Date.now() - startedAt;
    let containsPii = true;
    let reason = "local_classifier_default_strict";

    try {
      const parsed = JSON.parse(result.text);

      if (parsed && typeof parsed === "object") {
        containsPii =
          typeof parsed.containsPii === "boolean"
            ? parsed.containsPii
            : true;
        reason =
          typeof parsed.reason === "string" && parsed.reason.trim()
            ? parsed.reason.trim()
            : reason;
      }
    } catch {
      containsPii = true;
      reason = "local_classifier_parse_failed";
    }

    await recordInvocation({
      tenantContext: params.tenantContext,
      userId: params.userId,
      route: ModelRoute.LOCAL_QWEN,
      taskType: ModelTaskType.CLASSIFY,
      modelName: result.modelName,
      containsPii,
      reason,
      requestSummary: trimSummary(
        params.requestSummary,
        `classifier ${params.text}`,
      ),
      latencyMs,
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
      costUsd: result.costUsd,
    });

    return {
      containsPii,
      reason,
    } satisfies DataClassifierResult;
  } catch {
    const latencyMs = Date.now() - startedAt;

    await recordInvocation({
      tenantContext: params.tenantContext,
      userId: params.userId,
      route: ModelRoute.LOCAL_QWEN,
      taskType: ModelTaskType.CLASSIFY,
      modelName: env.LOCAL_QWEN_MODEL,
      containsPii: true,
      reason: "classifier_local_unavailable_strict",
      requestSummary: trimSummary(
        params.requestSummary,
        `classifier ${params.text}`,
      ),
      latencyMs,
      tokensInput: estimateTokens(params.text),
      costUsd: 0,
    });

    return {
      containsPii: true,
      reason: "classifier_local_unavailable_strict",
    } satisfies DataClassifierResult;
  }
}

function getRouteForOperation(params: {
  operation: "invoke" | "translate" | "embed";
  containsPii: boolean;
}) {
  if (params.operation === "embed") {
    return ModelRoute.LOCAL_BGE;
  }

  if (params.containsPii) {
    return ModelRoute.LOCAL_QWEN;
  }

  if (params.operation === "translate") {
    return ModelRoute.GOOGLE_TRANSLATE;
  }

  return ModelRoute.OPENAI;
}

function getModelNameForRoute(route: ModelRoute) {
  const env = getEnv();

  switch (route) {
    case ModelRoute.OPENAI:
      return env.OPENAI_MODEL;
    case ModelRoute.GOOGLE_TRANSLATE:
      return "google-translate";
    case ModelRoute.LOCAL_QWEN:
      return env.LOCAL_QWEN_MODEL;
    case ModelRoute.LOCAL_BGE:
      return env.LOCAL_BGE_MODEL;
  }
}

async function handleLocalFailure(params: {
  tenantContext: TenantContext;
  userId?: string;
  queueOnLocalFailure?: QueueOnLocalFailure;
  reason: string;
}): Promise<never> {
  let jobId: string | undefined;

  if (params.queueOnLocalFailure) {
    jobId = await queueLocalRetry({
      tenantContext: params.tenantContext,
      userId: params.userId,
      queue: params.queueOnLocalFailure,
      reason: params.reason,
    });
  }

  throw buildLocalUnavailableError(
    "Local privacy model is unavailable. The request was not sent to any third-party provider.",
    jobId
      ? {
          jobId,
        }
      : {},
  );
}

export function createModelGateway(deps?: { fetchImpl?: FetchLike }) {
  const fetchImpl = deps?.fetchImpl ?? fetch;

  return {
    async invoke(input: InvokeInput) {
      const env = getEnv();
      const classification = await classifySensitivity({
        fetchImpl,
        tenantContext: input.tenantContext,
        userId: input.userId,
        taskType: input.taskType,
        text: `${input.systemPrompt ?? ""}\n${input.prompt}`.trim(),
        sensitivity: input.sensitivity,
        knowledgeChunks: input.knowledgeChunks,
        requestSummary: input.requestSummary,
      });
      const route = getRouteForOperation({
        operation: "invoke",
        containsPii: classification.containsPii,
      });
      const startedAt = Date.now();
      const knowledgeContext = buildKnowledgeContext(
        input.knowledgeChunks,
        route === ModelRoute.LOCAL_QWEN,
      );
      const userPrompt = [input.prompt, knowledgeContext]
        .filter(Boolean)
        .join("\n\n");

      try {
        const result =
          route === ModelRoute.OPENAI
            ? await callOpenAiCompatibleTextModel({
                fetchImpl,
                baseUrl: env.OPENAI_BASE_URL,
                apiKey: env.OPENAI_API_KEY,
                model: env.OPENAI_MODEL,
                systemPrompt: input.systemPrompt,
                userPrompt,
                temperature: input.temperature,
              })
            : await callOpenAiCompatibleTextModel({
                fetchImpl,
                baseUrl: env.LOCAL_QWEN_BASE_URL,
                model: env.LOCAL_QWEN_MODEL,
                systemPrompt: input.systemPrompt,
                userPrompt,
                temperature: input.temperature,
              });

        const invocationId = await recordInvocation({
          tenantContext: input.tenantContext,
          userId: input.userId,
          route,
          taskType: input.taskType,
          modelName: result.modelName,
          containsPii: classification.containsPii,
          reason: classification.reason,
          requestSummary: trimSummary(input.requestSummary, input.prompt),
          latencyMs: Date.now() - startedAt,
          tokensInput: result.tokensInput,
          tokensOutput: result.tokensOutput,
          costUsd: result.costUsd,
        });

        return {
          ...result,
          route,
          containsPii: classification.containsPii,
          invocationId,
        } satisfies LoggedResult<ProviderTextResponse>;
      } catch (error) {
        const latencyMs = Date.now() - startedAt;

        if (route === ModelRoute.LOCAL_QWEN) {
          await recordInvocation({
            tenantContext: input.tenantContext,
            userId: input.userId,
            route,
            taskType: input.taskType,
            modelName: getModelNameForRoute(route),
            containsPii: classification.containsPii,
            reason: `${classification.reason}:local_unavailable`,
            requestSummary: trimSummary(input.requestSummary, input.prompt),
            latencyMs,
            tokensInput: estimateTokens(userPrompt),
            costUsd: 0,
          });

          await handleLocalFailure({
            tenantContext: input.tenantContext,
            userId: input.userId,
            queueOnLocalFailure: input.queueOnLocalFailure,
            reason: String(error),
          });
        }

        throw new ApiError(500, "INTERNAL", String(error));
      }
    },

    async translate(input: TranslateInput) {
      const env = getEnv();
      const classification = await classifySensitivity({
        fetchImpl,
        tenantContext: input.tenantContext,
        userId: input.userId,
        taskType: input.taskType,
        text: input.text,
        sensitivity: input.sensitivity,
        knowledgeChunks: input.knowledgeChunks,
        requestSummary: input.requestSummary,
      });
      const route = getRouteForOperation({
        operation: "translate",
        containsPii: classification.containsPii,
      });
      const startedAt = Date.now();

      try {
        const result =
          route === ModelRoute.GOOGLE_TRANSLATE
            ? await callGoogleTranslate({
                fetchImpl,
                baseUrl: env.GOOGLE_TRANSLATE_BASE_URL,
                apiKey: env.GOOGLE_TRANSLATE_KEY,
                text: input.text,
                targetLocale: input.targetLocale,
                sourceLocale: input.sourceLocale,
              })
            : await callOpenAiCompatibleTextModel({
                fetchImpl,
                baseUrl: env.LOCAL_QWEN_BASE_URL,
                model: env.LOCAL_QWEN_MODEL,
                systemPrompt:
                  "Translate the text accurately while preserving product names, numbers, and business intent.",
                userPrompt: `Source locale: ${input.sourceLocale ?? "auto"}\nTarget locale: ${input.targetLocale}\n\n${input.text}`,
                temperature: 0.1,
              });

        const invocationId = await recordInvocation({
          tenantContext: input.tenantContext,
          userId: input.userId,
          route,
          taskType: input.taskType,
          modelName: result.modelName,
          containsPii: classification.containsPii,
          reason: classification.reason,
          requestSummary: trimSummary(input.requestSummary, input.text),
          latencyMs: Date.now() - startedAt,
          tokensInput: result.tokensInput,
          tokensOutput: result.tokensOutput,
          costUsd: result.costUsd,
        });

        return {
          ...result,
          route,
          containsPii: classification.containsPii,
          invocationId,
        } satisfies LoggedResult<ProviderTextResponse>;
      } catch (error) {
        const latencyMs = Date.now() - startedAt;

        if (route === ModelRoute.LOCAL_QWEN) {
          await recordInvocation({
            tenantContext: input.tenantContext,
            userId: input.userId,
            route,
            taskType: input.taskType,
            modelName: getModelNameForRoute(route),
            containsPii: classification.containsPii,
            reason: `${classification.reason}:local_unavailable`,
            requestSummary: trimSummary(input.requestSummary, input.text),
            latencyMs,
            tokensInput: estimateTokens(input.text),
            costUsd: 0,
          });

          await handleLocalFailure({
            tenantContext: input.tenantContext,
            userId: input.userId,
            queueOnLocalFailure: input.queueOnLocalFailure,
            reason: String(error),
          });
        }

        throw new ApiError(500, "INTERNAL", String(error));
      }
    },

    async embed(input: EmbedInput) {
      const env = getEnv();
      const classification = await classifySensitivity({
        fetchImpl,
        tenantContext: input.tenantContext,
        userId: input.userId,
        taskType: input.taskType,
        text: input.text,
        sensitivity: input.sensitivity,
        knowledgeChunks: input.knowledgeChunks,
        requestSummary: input.requestSummary,
      });
      const route = getRouteForOperation({
        operation: "embed",
        containsPii: classification.containsPii,
      });
      const startedAt = Date.now();

      try {
        const result = await callOpenAiCompatibleEmbeddingModel({
          fetchImpl,
          baseUrl: env.LOCAL_BGE_BASE_URL,
          model: env.LOCAL_BGE_MODEL,
          input: input.text,
        });
        const invocationId = await recordInvocation({
          tenantContext: input.tenantContext,
          userId: input.userId,
          route,
          taskType: input.taskType,
          modelName: result.modelName,
          containsPii: classification.containsPii,
          reason: classification.reason,
          requestSummary: trimSummary(input.requestSummary, input.text),
          latencyMs: Date.now() - startedAt,
          tokensInput: result.tokensInput,
          costUsd: result.costUsd,
        });

        return {
          ...result,
          route,
          containsPii: classification.containsPii,
          invocationId,
        } satisfies LoggedResult<ProviderEmbeddingResponse>;
      } catch (error) {
        const latencyMs = Date.now() - startedAt;

        await recordInvocation({
          tenantContext: input.tenantContext,
          userId: input.userId,
          route,
          taskType: input.taskType,
          modelName: getModelNameForRoute(route),
          containsPii: classification.containsPii,
          reason: `${classification.reason}:local_unavailable`,
          requestSummary: trimSummary(input.requestSummary, input.text),
          latencyMs,
          tokensInput: estimateTokens(input.text),
          costUsd: 0,
        });

        await handleLocalFailure({
          tenantContext: input.tenantContext,
          userId: input.userId,
          queueOnLocalFailure: input.queueOnLocalFailure,
          reason: String(error),
        });
      }
    },
  };
}
