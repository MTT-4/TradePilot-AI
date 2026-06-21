import { Worker, type Job } from "bullmq";
import { JobType } from "@prisma/client";
import { JOB_QUEUE_NAME } from "@/server/jobs/config";
import { getRedisConnectionOptions } from "@/server/jobs/redis";
import {
  getSystemTenantContext,
  type QueuePayload,
} from "@/server/jobs/service";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import {
  markKnowledgeDocumentParseFailed,
  runEmbedDocumentJob,
  runParseDocumentJob,
} from "@/server/kb/service";
import { runGenerateContentPackJob } from "@/server/content-packs/service";
import { runGenerateSiteJob } from "@/server/sites/service";

type JobProgressReporter = {
  reportProgress(progress: number): Promise<void>;
};

let jobWorkerSingleton: Worker<QueuePayload> | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateJobState(params: {
  payload: QueuePayload;
  status?: "RUNNING" | "RETRYING" | "SUCCEEDED" | "FAILED";
  progress?: number;
  attempts?: number;
  error?: string | null;
  output?: Record<string, unknown>;
}) {
  const tenantContext = getSystemTenantContext(
    params.payload.tenantId,
    params.payload.requestedByUserId,
  );
  const tenantPrisma = getTenantPrisma(tenantContext);

  await tenantPrisma.job.update({
    where: {
      id: params.payload.dbJobId,
    },
    data: {
      status: params.status,
      progress: params.progress,
      attempts: params.attempts,
      error: params.error,
      output: params.output,
    },
  });
}

async function processDemoJob(
  bullJob: Job<QueuePayload>,
  reporter: JobProgressReporter,
) {
  const type = bullJob.data.type;
  const input = bullJob.data.input;
  const simulateMs = Math.max(50, Number(input.simulateMs ?? 120));

  await reporter.reportProgress(20);
  await sleep(simulateMs / 2);
  await reporter.reportProgress(60);
  await sleep(simulateMs / 2);
  await reporter.reportProgress(90);

  return {
    handledType: type.toLowerCase(),
    input,
    processedAt: new Date().toISOString(),
  };
}

async function queueProcessor(bullJob: Job<QueuePayload>) {
  await updateJobState({
    payload: bullJob.data,
    status: "RUNNING",
    progress: 5,
    attempts: bullJob.attemptsMade + 1,
    error: null,
  });

  try {
    const reporter = {
      async reportProgress(progress: number) {
        await bullJob.updateProgress(progress);
        await updateJobState({
          payload: bullJob.data,
          progress,
          attempts: bullJob.attemptsMade + 1,
        });
      },
    };
    const output =
      bullJob.data.type === JobType.PARSE_DOCUMENT
        ? await runParseDocumentJob({
            tenantId: bullJob.data.tenantId,
            requestedByUserId: bullJob.data.requestedByUserId,
            documentId: String(bullJob.data.input.documentId ?? ""),
            reportProgress: reporter.reportProgress,
          })
        : bullJob.data.type === JobType.EMBED_DOCUMENT
          ? await runEmbedDocumentJob({
              tenantId: bullJob.data.tenantId,
              requestedByUserId: bullJob.data.requestedByUserId,
              documentId: String(bullJob.data.input.documentId ?? ""),
              reportProgress: reporter.reportProgress,
            })
          : bullJob.data.type === JobType.GENERATE_CONTENT_PACK
            ? await runGenerateContentPackJob({
                tenantId: bullJob.data.tenantId,
                requestedByUserId: bullJob.data.requestedByUserId,
                contentPackId: String(bullJob.data.input.contentPackId ?? ""),
                request: bullJob.data.input.request as {
                  campaignId?: string;
                  topic: string;
                  market?: string;
                  locales: Array<"en" | "ar" | "ru" | "fr" | "de" | "pt">;
                  platforms?: Array<
                    | "linkedin"
                    | "facebook"
                    | "instagram"
                    | "reels"
                    | "tiktok"
                    | "youtube"
                    | "shorts"
                    | "vk_clips"
                    | "rutube"
                  >;
                  assetIds?: string[];
                  knowledgeDocumentIds?: string[];
                  referenceBrandKit?: boolean;
                },
                reportProgress: reporter.reportProgress,
              })
          : bullJob.data.type === JobType.GENERATE_SITE
            ? await runGenerateSiteJob({
                tenantId: bullJob.data.tenantId,
                requestedByUserId: bullJob.data.requestedByUserId,
                siteId: String(bullJob.data.input.siteId ?? ""),
                brief: bullJob.data.input.brief as {
                  market: string;
                  product: string;
                  locales: Array<"en" | "ar" | "ru" | "fr" | "de" | "pt">;
                  style: string;
                  cta: string;
                },
                assetIds: Array.isArray(bullJob.data.input.assetIds)
                  ? bullJob.data.input.assetIds.map((item) => String(item))
                  : [],
                knowledgeDocumentIds: Array.isArray(
                  bullJob.data.input.knowledgeDocumentIds,
                )
                  ? bullJob.data.input.knowledgeDocumentIds.map((item) => String(item))
                  : [],
                referenceBrandKit: Boolean(bullJob.data.input.referenceBrandKit),
                reportProgress: reporter.reportProgress,
              })
          : await processDemoJob(bullJob, reporter);

    await updateJobState({
      payload: bullJob.data,
      status: "SUCCEEDED",
      progress: 100,
      attempts: bullJob.attemptsMade + 1,
      error: null,
      output,
    });

    return output;
  } catch (error) {
    if (bullJob.data.type === JobType.PARSE_DOCUMENT) {
      await markKnowledgeDocumentParseFailed({
        tenantId: bullJob.data.tenantId,
        requestedByUserId: bullJob.data.requestedByUserId,
        documentId: String(bullJob.data.input.documentId ?? ""),
      });
    }

    const nextStatus =
      bullJob.attemptsMade + 1 < (bullJob.opts.attempts ?? 1)
        ? "RETRYING"
        : "FAILED";

    await updateJobState({
      payload: bullJob.data,
      status: nextStatus,
      progress: 100,
      attempts: bullJob.attemptsMade + 1,
      error: String(error),
    });

    throw error;
  }
}

export function startJobWorker(options?: { autorun?: boolean }) {
  if (!jobWorkerSingleton) {
    jobWorkerSingleton = new Worker<QueuePayload>(
      JOB_QUEUE_NAME,
      queueProcessor,
      {
        connection: getRedisConnectionOptions(),
        autorun: options?.autorun ?? true,
      },
    );
  }

  return jobWorkerSingleton;
}

export async function closeJobWorker() {
  if (jobWorkerSingleton) {
    const worker = jobWorkerSingleton;
    jobWorkerSingleton = null;
    await worker.close();
  }
}
