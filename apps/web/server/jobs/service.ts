import {
  MembershipRole,
  type JobStatus,
  type JobType,
} from "@prisma/client";
import { Queue, type JobsOptions } from "bullmq";
import { JOB_QUEUE_NAME } from "@/server/jobs/config";
import { getRedisConnectionOptions } from "@/server/jobs/redis";
import { ApiError } from "@/server/api/errors";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import type { TenantContext } from "@/server/db/tenant-context";

type EnqueueTenantJobInput = {
  tenantContext: TenantContext;
  requestedByUserId?: string;
  type: JobType;
  input?: Record<string, unknown>;
  idempotencyKey?: string;
  maxAttempts?: number;
};

type ListTenantJobsFilters = {
  status?: JobStatus;
  type?: JobType;
  limit?: number;
};

export type QueuePayload = {
  dbJobId: string;
  tenantId: string;
  requestedByUserId?: string;
  type: JobType;
  input: Record<string, unknown>;
  maxAttempts: number;
};

let jobQueueSingleton: Queue<QueuePayload> | null = null;

export function getJobQueue() {
  if (!jobQueueSingleton) {
    jobQueueSingleton = new Queue<QueuePayload>(JOB_QUEUE_NAME, {
      connection: getRedisConnectionOptions(),
    });
  }

  return jobQueueSingleton;
}

export async function enqueueTenantJob({
  tenantContext,
  requestedByUserId,
  type,
  input = {},
  idempotencyKey,
  maxAttempts = 3,
}: EnqueueTenantJobInput) {
  const tenantPrisma = getTenantPrisma(tenantContext);

  if (idempotencyKey) {
    const existing = await tenantPrisma.job.findFirst({
      where: {
        idempotencyKey,
      },
      select: {
        id: true,
        status: true,
        progress: true,
        error: true,
      },
    });

    if (existing) {
      return {
        jobId: existing.id,
        reused: true,
        status: existing.status,
        progress: existing.progress,
        error: existing.error,
      };
    }
  }

  const dbJob = await tenantPrisma.job.create({
    data: {
      tenantId: tenantContext.tenantId,
      requestedByUserId,
      type,
      status: "QUEUED",
      progress: 0,
      attempts: 0,
      maxAttempts,
      idempotencyKey,
      input,
    },
    select: {
      id: true,
      status: true,
      progress: true,
      error: true,
    },
  });

  const queue = getJobQueue();
  const options: JobsOptions = {
    jobId: dbJob.id,
    attempts: maxAttempts,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  };

  try {
    await queue.add(
      type,
      {
        dbJobId: dbJob.id,
        tenantId: tenantContext.tenantId,
        requestedByUserId,
        type,
        input,
        maxAttempts,
      },
      options,
    );
  } catch (error) {
    await tenantPrisma.job.update({
      where: {
        id: dbJob.id,
      },
      data: {
        status: "FAILED",
        error: String(error),
      },
    });

    throw new ApiError(500, "INTERNAL", "Failed to enqueue background job.");
  }

  return {
    jobId: dbJob.id,
    reused: false,
    status: dbJob.status,
    progress: dbJob.progress,
    error: dbJob.error,
  };
}

export async function getTenantJobById(
  tenantContext: TenantContext,
  jobId: string,
) {
  const tenantPrisma = getTenantPrisma(tenantContext);
  const job = await tenantPrisma.job.findUnique({
    where: {
      id: jobId,
    },
    select: {
      id: true,
      type: true,
      status: true,
      progress: true,
      attempts: true,
      maxAttempts: true,
      error: true,
      output: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!job) {
    throw new ApiError(404, "NOT_FOUND", "Job not found.");
  }

  return job;
}

export async function listTenantJobs(
  tenantContext: TenantContext,
  filters: ListTenantJobsFilters = {},
) {
  const tenantPrisma = getTenantPrisma(tenantContext);
  const jobs = await tenantPrisma.job.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.type ? { type: filters.type } : {}),
    },
    orderBy: [
      {
        createdAt: "desc",
      },
      {
        updatedAt: "desc",
      },
    ],
    take: filters.limit ?? 50,
    select: {
      id: true,
      type: true,
      status: true,
      progress: true,
      attempts: true,
      maxAttempts: true,
      error: true,
      input: true,
      output: true,
      requestedByUserId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return jobs;
}

export function getSystemTenantContext(
  tenantId: string,
  requestedByUserId?: string,
): TenantContext {
  return {
    tenantId,
    userId: requestedByUserId ?? "system",
    role: MembershipRole.OWNER,
  };
}
