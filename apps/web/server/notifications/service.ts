import { HitlTaskType, type NotificationStatus } from "@prisma/client";
import { getPrismaClient } from "@/server/db/prisma";
import type { TenantContext } from "@/server/db/tenant-context";

function formatTaskTitle(type: string) {
  switch (type) {
    case HitlTaskType.SITE_PUBLISH:
      return "站点待审批";
    case HitlTaskType.CONTENT_PUBLISH:
      return "内容待审批";
    case HitlTaskType.REPLY_SEND:
      return "首响待审批";
    default:
      return "待审批任务";
  }
}

function buildTaskLink(task: {
  type: HitlTaskType;
  entityId: string;
  payload: Record<string, unknown>;
}) {
  if (task.type === HitlTaskType.SITE_PUBLISH) {
    const siteId =
      typeof task.payload.siteId === "string" ? task.payload.siteId : task.entityId;

    return siteId ? `/sites?siteId=${siteId}` : "/hitl";
  }

  if (task.type === HitlTaskType.CONTENT_PUBLISH) {
    return `/design?itemId=${task.entityId}`;
  }

  if (task.type === HitlTaskType.REPLY_SEND) {
    return "/hitl";
  }

  return "/hitl";
}

export async function listNotifications(params: {
  tenantContext: TenantContext;
  status?: "unread" | "read";
}) {
  const prisma = getPrismaClient();
  const notifications = await prisma.notification.findMany({
    where: {
      tenantId: params.tenantContext.tenantId,
      userId: params.tenantContext.userId,
      status: params.status ? (params.status.toUpperCase() as NotificationStatus) : undefined,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 20,
    select: {
      id: true,
      type: true,
      status: true,
      title: true,
      body: true,
      linkUrl: true,
      payload: true,
      createdAt: true,
      readAt: true,
    },
  });
  const hitlTasks = await prisma.hitlTask.findMany({
    where: {
      tenantId: params.tenantContext.tenantId,
      status: "PENDING",
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 20,
    select: {
      id: true,
      type: true,
      entityType: true,
      entityId: true,
      payload: true,
      createdAt: true,
    },
  });

  const taskNotifications =
    params.tenantContext.role === "VIEWER" || params.status === "read"
      ? []
      : hitlTasks.map((task) => ({
          id: `hitl-${task.id}`,
          type: "hitl_pending",
          status: "unread",
          title: formatTaskTitle(task.type),
          body: `${task.entityType} ${task.entityId} 等待处理。`,
          linkUrl: buildTaskLink({
            type: task.type,
            entityId: task.entityId,
            payload: (task.payload ?? {}) as Record<string, unknown>,
          }),
          payload: {
            hitlTaskId: task.id,
            taskType: task.type.toLowerCase(),
          },
          createdAt: task.createdAt.toISOString(),
          readAt: null,
        }));

  return {
    unreadCount:
      notifications.filter((item) => item.status === "UNREAD").length +
      taskNotifications.length,
    items: [
      ...taskNotifications,
      ...notifications.map((item) => ({
        id: item.id,
        type: item.type.toLowerCase(),
        status: item.status.toLowerCase(),
        title: item.title,
        body: item.body,
        linkUrl: item.linkUrl,
        payload: item.payload,
        createdAt: item.createdAt.toISOString(),
        readAt: item.readAt?.toISOString() ?? null,
      })),
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  };
}
