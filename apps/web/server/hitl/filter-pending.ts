import { HitlTaskType, ReplyStatus } from "@prisma/client";

type PendingHitlTask = {
  type: HitlTaskType;
  entityType: string;
  entityId: string;
};

type ReplyReader = {
  findMany(args: {
    where: {
      tenantId: string;
      id: {
        in: string[];
      };
      status: ReplyStatus;
    };
    select: {
      id: true;
    };
  }): Promise<Array<{ id: string }>>;
};

export async function filterLivePendingHitlTasks<T extends PendingHitlTask>(params: {
  tenantId: string;
  tasks: T[];
  replyReader: ReplyReader;
}) {
  const replyTasks = params.tasks.filter(
    (task) =>
      task.type === HitlTaskType.REPLY_SEND && task.entityType === "reply",
  );

  if (replyTasks.length === 0) {
    return params.tasks;
  }

  const replyIds = Array.from(new Set(replyTasks.map((task) => task.entityId)));
  const replies = await params.replyReader.findMany({
    where: {
      tenantId: params.tenantId,
      id: {
        in: replyIds,
      },
      status: ReplyStatus.PENDING_APPROVAL,
    },
    select: {
      id: true,
    },
  });
  const liveReplyIds = new Set(replies.map((reply) => reply.id));

  return params.tasks.filter(
    (task) =>
      task.type !== HitlTaskType.REPLY_SEND ||
      task.entityType !== "reply" ||
      liveReplyIds.has(task.entityId),
  );
}
