// 统一的中文标签字典：把后端返回的英文枚举值映射成界面可读的中文。
// 找不到映射时回退显示原值，保证不会因为新增枚举而显示空白。

function pick(value: string | null | undefined, dict: Record<string, string>) {
  if (!value) {
    return "—";
  }
  const key = value.toLowerCase();
  return dict[key] ?? value;
}

const STATUS: Record<string, string> = {
  // 通用流程状态
  pending: "待处理",
  processing: "处理中",
  queued: "排队中",
  ready: "就绪",
  completed: "已完成",
  failed: "失败",
  rejected: "已拒绝",
  expired: "已过期",
  archived: "已归档",
  // 内容 / 站点发布
  draft: "草稿",
  pending_publish: "待发布",
  published: "已发布",
  offline: "已下线",
  applied: "已应用",
  // 知识库审核
  approved: "已核准",
  corrected: "已修正",
  // 首响 / 询盘
  sent: "已发送",
  new: "新",
  contacted: "已联系",
  qualified: "已确认",
  quoted: "已报价",
  won: "赢单",
  lost: "丢单",
  // 成员
  active: "启用",
  invited: "待接受",
  suspended: "已停用",
};

const ROLE: Record<string, string> = {
  owner: "所有者",
  admin: "管理员",
  operator: "运营",
  sales: "销售",
  viewer: "只读",
};

const SENSITIVITY: Record<string, string> = {
  public: "可公开",
  internal_only: "仅内部",
};

const AUTOFILL_KIND: Record<string, string> = {
  product: "产品页",
  certification: "认证",
  blog: "博客",
};

const DATA_REQUEST_TYPE: Record<string, string> = {
  export: "导出",
  delete: "删除",
};

export function statusLabel(value: string | null | undefined) {
  return pick(value, STATUS);
}

export function roleLabel(value: string | null | undefined) {
  return pick(value, ROLE);
}

export function sensitivityLabel(value: string | null | undefined) {
  return pick(value, SENSITIVITY);
}

export function autofillKindLabel(value: string | null | undefined) {
  return pick(value, AUTOFILL_KIND);
}

export function dataRequestTypeLabel(value: string | null | undefined) {
  return pick(value, DATA_REQUEST_TYPE);
}
