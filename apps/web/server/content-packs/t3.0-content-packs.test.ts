import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ContentPackStatus, JobStatus, PublishStatus } from "@prisma/client";
import { getEnv } from "@/lib/env";
import { getPrismaClient } from "@/server/db/prisma";
import type { TenantContext } from "@/server/db/tenant-context";
import { closeJobWorker, startJobWorker } from "@/server/jobs/worker";
import { getTenantJobById, getJobQueue } from "@/server/jobs/service";
import {
  applyContentPackChatUpdate,
  createContentPackGenerationRequest,
  exportContentPack,
  generateContentItemImageAssets,
  getContentPackDetail,
  listPlatformRules,
  markContentItemPublished,
  unmarkContentItemPublished,
  updateContentItem,
} from "@/server/content-packs/service";
import { getTenantObjectBuffer } from "@/server/storage/object-store";

const prisma = getPrismaClient();
const originalFetch = globalThis.fetch;
const capturedPrompts: string[] = [];

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

function installMockContentPackFetch() {
  const env = getEnv();
  const embeddingsUrl = `${env.LOCAL_BGE_BASE_URL.replace(/\/$/, "")}/embeddings`;
  const chatUrl = `${env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const localChatUrl = `${env.LOCAL_QWEN_BASE_URL.replace(/\/$/, "")}/chat/completions`;

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

    if (url === chatUrl || url === localChatUrl) {
      const rawBody =
        typeof init?.body === "string"
          ? init.body
          : init?.body instanceof Uint8Array
            ? Buffer.from(init.body).toString("utf8")
            : "";
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const prompt = extractPromptContent(payload);
      capturedPrompts.push(prompt);

      return new Response(
        JSON.stringify({
          id: "mock-chatcmpl",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "fallback content pack response",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    return originalFetch(input, init);
  }) as typeof fetch;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJobStatus(params: {
  tenantContext: TenantContext;
  jobId: string;
  expected: JobStatus;
}) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const job = await getTenantJobById(params.tenantContext, params.jobId);

    if (job.status === params.expected) {
      return job;
    }

    if (job.status === JobStatus.FAILED) {
      throw new Error(`Job failed unexpectedly: ${job.error ?? "unknown"}`);
    }

    await sleep(50);
  }

  throw new Error(`Timed out waiting for job status ${params.expected}.`);
}

let tenantContext: TenantContext;

beforeAll(async () => {
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
      "Seed data missing. Run `npm run prisma:seed` before content pack tests.",
    );
  }

  tenantContext = membership;
  installMockContentPackFetch();
  await closeJobWorker();
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await closeJobWorker();
  await getJobQueue().close();
});

describe("T3.0 content packs", () => {
  it(
    "generates a 9-platform content pack with tracking links and video-script constraints",
    async () => {
      const rules = await listPlatformRules();
      expect(rules.items).toHaveLength(9);

      const queued = await createContentPackGenerationRequest({
        tenantContext,
        requestedByUserId: tenantContext.userId,
        input: {
          topic: `TS-75 screw air compressor distributor push ${Date.now()}`,
          market: "Middle East",
          locales: ["en", "ar"],
        },
      });

      const worker = startJobWorker();
      await worker.waitUntilReady();
      await waitForJobStatus({
        tenantContext,
        jobId: queued.jobId,
        expected: JobStatus.SUCCEEDED,
      });

      const detail = await getContentPackDetail(tenantContext, queued.packId);
      expect(detail.pack.status).toBe(ContentPackStatus.READY.toLowerCase());
      expect(detail.items).toHaveLength(9);
      expect(detail.items.every((item) => item.trackingLink?.slug)).toBe(true);
      expect(
        detail.items.every((item) => item.trackingLink?.resolvedUrl.includes("utm_source=")),
      ).toBe(true);

      const videoItems = detail.items.filter((item) => item.mediaType === "video_script");
      expect(videoItems).toHaveLength(6);
      expect(
        videoItems.every(
          (item) => {
            const constraints = item.spec.constraints as
              | {
                  renderedVideo?: boolean;
                  tts?: boolean;
                  subtitles?: boolean;
                }
              | undefined;

            return (
              constraints?.renderedVideo === false &&
              constraints.tts === false &&
              constraints.subtitles === false
            );
          },
        ),
      ).toBe(true);

      const imageLikeItems = detail.items.filter((item) => item.mediaType !== "video_script");
      expect(
        imageLikeItems.every((item) => typeof item.spec.imagePrompt === "string"),
      ).toBe(true);
    },
    20000,
  );

  it("supports chat updates, editing, publish marking, unmarking, and export", async () => {
    const queued = await createContentPackGenerationRequest({
      tenantContext,
      requestedByUserId: tenantContext.userId,
      input: {
        topic: `TS-75 technical proof pack ${Date.now()}`,
        market: "Russia",
        locales: ["en"],
        platforms: ["linkedin", "instagram", "tiktok"],
      },
    });

    const worker = startJobWorker();
    await worker.waitUntilReady();
    await waitForJobStatus({
      tenantContext,
      jobId: queued.jobId,
      expected: JobStatus.SUCCEEDED,
    });

    const initial = await getContentPackDetail(tenantContext, queued.packId);
    const linkedinItem = initial.items.find((item) => item.platform === "linkedin");
    const instagramItem = initial.items.find((item) => item.platform === "instagram");

    expect(linkedinItem).toBeTruthy();
    expect(instagramItem).toBeTruthy();

    const updatedByChat = await applyContentPackChatUpdate({
      tenantContext,
      packId: queued.packId,
      requestedByUserId: tenantContext.userId,
      input: {
        message: "Update LinkedIn with a more technical tone and stronger buyer proof.",
      },
    });

    const linkedinAfterChat = updatedByChat.items.find(
      (item) => item.platform === "linkedin",
    );
    const instagramAfterChat = updatedByChat.items.find(
      (item) => item.platform === "instagram",
    );

    expect(linkedinAfterChat?.body).toContain("Update request");
    expect(instagramAfterChat?.body).toBe(instagramItem?.body);

    const updatedItem = await updateContentItem({
      tenantContext,
      itemId: linkedinAfterChat!.id,
      requestedByUserId: tenantContext.userId,
      input: {
        body: `${linkedinAfterChat!.body} Final manual adjustment.`,
      },
    });
    expect(
      updatedItem.items.find((item) => item.id === linkedinAfterChat!.id)?.body,
    ).toContain("Final manual adjustment");

    const withImages = await generateContentItemImageAssets({
      tenantContext,
      itemId: linkedinAfterChat!.id,
      requestedByUserId: tenantContext.userId,
      input: {
        mode: "text_to_image",
      },
    });
    const imageItem = withImages.items.find((item) => item.id === linkedinAfterChat!.id);
    const generatedAssets = Array.isArray(imageItem?.spec.generatedAssets)
      ? imageItem.spec.generatedAssets
      : [];

    expect(generatedAssets).toHaveLength(2);
    expect(
      generatedAssets.every(
        (asset) =>
          typeof asset.previewUrl === "string" &&
          asset.previewUrl.startsWith("/api/files/"),
      ),
    ).toBe(true);

    const firstFileId = String(generatedAssets[0]?.fileId ?? "");
    const generatedFile = await prisma.file.findUniqueOrThrow({
      where: {
        id: firstFileId,
      },
      select: {
        objectKey: true,
      },
    });
    const generatedBuffer = await getTenantObjectBuffer({
      tenantId: tenantContext.tenantId,
      objectKey: generatedFile.objectKey,
    });

    expect(generatedBuffer.toString("utf8")).toContain("<svg");

    const published = await markContentItemPublished({
      tenantContext,
      itemId: linkedinAfterChat!.id,
      requestedByUserId: tenantContext.userId,
    });
    expect(
      published.items.find((item) => item.id === linkedinAfterChat!.id)?.publishStatus,
    ).toBe(PublishStatus.PUBLISHED.toLowerCase());

    const unpublished = await unmarkContentItemPublished({
      tenantContext,
      itemId: linkedinAfterChat!.id,
      requestedByUserId: tenantContext.userId,
    });
    expect(
      unpublished.items.find((item) => item.id === linkedinAfterChat!.id)?.publishStatus,
    ).toBe(PublishStatus.PENDING.toLowerCase());

    const csvExport = await exportContentPack({
      tenantContext,
      packId: queued.packId,
      format: "csv",
    });
    const csvText = csvExport.body.toString("utf8");

    expect(csvExport.contentType).toContain("text/csv");
    expect(csvText).toContain("platform,mediaType,title");
    expect(csvText).toContain("linkedin");
    expect(csvText).toContain("utm_source=");
  });
});
