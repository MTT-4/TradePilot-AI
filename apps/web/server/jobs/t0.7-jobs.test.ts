import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/server/db/prisma";
import type { TenantContext } from "@/server/db/tenant-context";
import {
  enqueueTenantJob,
  getJobQueue,
  getTenantJobById,
} from "@/server/jobs/service";
import { closeJobWorker, startJobWorker } from "@/server/jobs/worker";

const prisma = getPrismaClient();

let tenantContextA: TenantContext;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      "Seed data missing. Run `npm run prisma:seed` before T0.7 jobs tests.",
    );
  }

  tenantContextA = membership;
  await closeJobWorker();
});

afterAll(async () => {
  await closeJobWorker();
  await getJobQueue().close();
});

describe("T0.7 jobs", () => {
  it("runs an example job from queued to running to succeeded", async () => {
    const enqueueResult = await enqueueTenantJob({
      tenantContext: tenantContextA,
      requestedByUserId: tenantContextA.userId,
      type: "GENERATE_REPLY",
      idempotencyKey: `t0-7-progress-${Date.now()}`,
      input: {
        simulateMs: 220,
        inquiryId: "demo-inquiry",
      },
    });

    expect(enqueueResult.reused).toBe(false);

    const queuedJob = await getTenantJobById(
      tenantContextA,
      enqueueResult.jobId,
    );
    expect(queuedJob.status).toBe("QUEUED");
    expect(queuedJob.progress).toBe(0);

    const worker = startJobWorker();
    await worker.waitUntilReady();

    const seenStatuses = new Set<string>();
    let finalJob = queuedJob;

    for (let attempt = 0; attempt < 80; attempt += 1) {
      finalJob = await getTenantJobById(tenantContextA, enqueueResult.jobId);
      seenStatuses.add(finalJob.status);

      if (finalJob.status === "SUCCEEDED") {
        break;
      }

      await sleep(25);
    }

    expect(seenStatuses.has("RUNNING")).toBe(true);
    expect(finalJob.status).toBe("SUCCEEDED");
    expect(finalJob.progress).toBe(100);
    expect(finalJob.output).toMatchObject({
      handledType: "generate_reply",
    });
  });

  it("reuses the same job for duplicate idempotency keys", async () => {
    const idempotencyKey = `t0-7-idem-${Date.now()}`;

    const first = await enqueueTenantJob({
      tenantContext: tenantContextA,
      requestedByUserId: tenantContextA.userId,
      type: "GENERATE_REPLY",
      idempotencyKey,
      input: {
        simulateMs: 120,
      },
    });
    const second = await enqueueTenantJob({
      tenantContext: tenantContextA,
      requestedByUserId: tenantContextA.userId,
      type: "GENERATE_REPLY",
      idempotencyKey,
      input: {
        simulateMs: 120,
      },
    });

    expect(second.reused).toBe(true);
    expect(second.jobId).toBe(first.jobId);

    const matchingJobs = await prisma.job.findMany({
      where: {
        tenantId: tenantContextA.tenantId,
        idempotencyKey,
      },
      select: {
        id: true,
      },
    });

    expect(matchingJobs).toHaveLength(1);
  });
});
