import { getPrismaClient } from "@/server/db/prisma";
import type { TenantContext } from "@/server/db/tenant-context";

export async function getDesignQueue(params: {
  tenantContext: TenantContext;
}) {
  const prisma = getPrismaClient();
  const [items, pendingTasks] = await Promise.all([
    prisma.contentItem.findMany({
      where: {
        tenantId: params.tenantContext.tenantId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 24,
      select: {
        id: true,
        title: true,
        platform: true,
        mediaType: true,
        publishStatus: true,
        contentPackId: true,
        contentPack: {
          select: {
            title: true,
          },
        },
      },
    }),
    prisma.hitlTask.findMany({
      where: {
        tenantId: params.tenantContext.tenantId,
        status: "PENDING",
        type: "CONTENT_PUBLISH",
      },
      select: {
        entityId: true,
      },
    }),
  ]);
  const pendingItemIds = new Set(pendingTasks.map((task) => task.entityId));

  return {
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      platform: item.platform.toLowerCase(),
      mediaType: item.mediaType.toLowerCase(),
      publishStatus: item.publishStatus.toLowerCase(),
      contentPackId: item.contentPackId,
      contentPackTitle: item.contentPack.title,
      publishRequestPending: pendingItemIds.has(item.id),
      editUrl: `/content-packs/${item.contentPackId}/chat`,
    })),
  };
}
