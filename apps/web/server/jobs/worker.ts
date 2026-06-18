import { Worker, type Job } from "bullmq";
import { JOB_QUEUE_NAME } from "@/server/jobs/config";
import { getRedisConnectionOptions } from "@/server/jobs/redis";
import {
  getSystemTenantContext,
  type QueuePayload,
} from "@/server/jobs/service";
import { getTenantPrisma } from "@/server/db/tenant-prisma";

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
    const output = await processDemoJob(bullJob, {
      async reportProgress(progress) {
        await bullJob.updateProgress(progress);
        await updateJobState({
          payload: bullJob.data,
          progress,
          attempts: bullJob.attemptsMade + 1,
        });
      },
    });

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
