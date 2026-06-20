export type HitlTaskItem = {
  id: string;
  type: string;
  status: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  reason?: string | null;
  createdAt: string;
  updatedAt?: string;
  resolvedAt?: string | null;
};

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatTaskType(type: string) {
  switch (type) {
    case "site_publish":
      return "站点上线审批";
    case "content_publish":
      return "内容发布审批";
    case "reply_send":
      return "首响发送审批";
    default:
      return "待审批任务";
  }
}

export function formatTaskDetail(task: Pick<HitlTaskItem, "type" | "payload">) {
  if (task.type === "site_publish") {
    return task.payload.mode === "autofill_candidate"
      ? "自动补全内容确认上线"
      : "站点草稿等待发布";
  }

  if (task.type === "content_publish") {
    return "内容待确认发布";
  }

  if (task.type === "reply_send") {
    return "首响草稿待确认发送";
  }

  return "等待人工确认";
}

export function resolveTaskHref(task: Pick<HitlTaskItem, "type" | "entityId" | "payload">) {
  if (task.type === "site_publish") {
    const siteId =
      typeof task.payload.siteId === "string" ? task.payload.siteId : task.entityId;

    return siteId ? `/sites?siteId=${siteId}` : "/sites";
  }

  if (task.type === "content_publish") {
    return `/design?itemId=${task.entityId}`;
  }

  if (task.type === "reply_send") {
    return "/replies";
  }

  return "/hitl";
}

export function canApproveTask(role: string | undefined, type: string) {
  if (!role) {
    return false;
  }

  if (type === "reply_send") {
    return ["owner", "admin", "operator", "sales"].includes(role);
  }

  if (type === "content_publish") {
    return ["owner", "admin", "operator"].includes(role);
  }

  if (type === "site_publish") {
    return ["owner", "admin"].includes(role);
  }

  return false;
}

export function canEdit(role: string | undefined) {
  return ["owner", "admin", "operator"].includes(role ?? "");
}
