#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CLEANUP_REASON = "orphan_reply_task_cleanup";

function printUsage() {
  console.log(`Usage:
  node tools/ops/cleanup_orphan_reply_hitl.mjs [--apply] [--tenant <slug>]

Options:
  --apply         Actually mark orphan reply HITL tasks as CANCELLED
  --tenant <slug> Only inspect one tenant slug
  --help          Show this message

Default behavior is dry-run.`);
}

function parseArgs(argv) {
  const args = {
    apply: false,
    tenantSlug: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }

    if (token === "--apply") {
      args.apply = true;
      continue;
    }

    if (token === "--tenant") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--tenant requires a slug value");
      }
      args.tenantSlug = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function groupByTenant(tasks) {
  const grouped = new Map();

  for (const task of tasks) {
    const current = grouped.get(task.tenantId) ?? [];
    current.push(task);
    grouped.set(task.tenantId, current);
  }

  return grouped;
}

async function findOrphanTasks(tenantSlug) {
  const tasks = await prisma.hitlTask.findMany({
    where: {
      status: "PENDING",
      type: "REPLY_SEND",
      entityType: "reply",
      tenant: tenantSlug
        ? {
            slug: tenantSlug,
          }
        : undefined,
    },
    orderBy: [
      {
        tenantId: "asc",
      },
      {
        createdAt: "desc",
      },
    ],
    select: {
      id: true,
      tenantId: true,
      entityId: true,
      createdAt: true,
      payload: true,
      tenant: {
        select: {
          slug: true,
          name: true,
        },
      },
    },
  });

  const grouped = groupByTenant(tasks);
  const orphans = [];

  for (const [tenantId, tenantTasks] of grouped.entries()) {
    const replyIds = [...new Set(tenantTasks.map((task) => task.entityId))];
    const replies = await prisma.reply.findMany({
      where: {
        tenantId,
        id: {
          in: replyIds,
        },
      },
      select: {
        id: true,
        status: true,
      },
    });
    const replyMap = new Map(replies.map((reply) => [reply.id, reply]));

    for (const task of tenantTasks) {
      const reply = replyMap.get(task.entityId);

      if (!reply) {
        orphans.push({
          ...task,
          orphanReason: "missing_reply",
        });
        continue;
      }

      if (reply.status !== "PENDING_APPROVAL") {
        orphans.push({
          ...task,
          orphanReason: `reply_status_${reply.status.toLowerCase()}`,
        });
      }
    }
  }

  return {
    tasks,
    orphans,
  };
}

async function applyCleanup(orphans) {
  if (orphans.length === 0) {
    return {
      cancelledCount: 0,
    };
  }

  const orphanIds = orphans.map((task) => task.id);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.hitlTask.updateMany({
      where: {
        id: {
          in: orphanIds,
        },
      },
      data: {
        status: "CANCELLED",
        reason: CLEANUP_REASON,
        resolvedAt: now,
      },
    });

    await tx.auditLog.createMany({
      data: orphans.map((task) => ({
        tenantId: task.tenantId,
        actorUserId: null,
        action: "orphan_reply_hitl_cancelled",
        entityType: "hitl_task",
        entityId: task.id,
        metadata: {
          orphanReason: task.orphanReason,
          replyId: task.entityId,
        },
      })),
    });

    return updateResult;
  });

  return {
    cancelledCount: result.count,
  };
}

try {
  const { apply, tenantSlug } = parseArgs(process.argv.slice(2));
  const { tasks, orphans } = await findOrphanTasks(tenantSlug);
  const byTenant = new Map();

  for (const orphan of orphans) {
    const key = orphan.tenant.slug;
    const current = byTenant.get(key) ?? {
      tenantName: orphan.tenant.name,
      tenantSlug: orphan.tenant.slug,
      count: 0,
      taskIds: [],
    };
    current.count += 1;
    current.taskIds.push(orphan.id);
    byTenant.set(key, current);
  }

  const summary = {
    mode: apply ? "apply" : "dry-run",
    tenantScope: tenantSlug ?? "all",
    pendingReplyHitlTasks: tasks.length,
    orphanReplyHitlTasks: orphans.length,
    tenants: [...byTenant.values()],
    sample: orphans.slice(0, 10).map((task) => ({
      taskId: task.id,
      tenantSlug: task.tenant.slug,
      tenantName: task.tenant.name,
      replyId: task.entityId,
      orphanReason: task.orphanReason,
      createdAt: task.createdAt.toISOString(),
    })),
  };

  if (apply) {
    const result = await applyCleanup(orphans);
    console.log(
      JSON.stringify(
        {
          ...summary,
          cancelledCount: result.cancelledCount,
          cleanupReason: CLEANUP_REASON,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Unexpected cleanup error.",
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
