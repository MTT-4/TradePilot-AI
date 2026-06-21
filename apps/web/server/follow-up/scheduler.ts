import { ApiError } from "@/server/api/errors";
import type { TenantContext } from "@/server/db/tenant-context";
import { getTenantPrisma } from "@/server/db/tenant-prisma";
import { createCrmActivity } from "@/server/crm/service";
import { assertLeadOwnerScope } from "@/server/skills/access";

/**
 * Skill: follow_up_scheduler（跟进节奏建议）+ Tool: follow_up_task（跟进任务）
 * 契约见 docs/skills/follow_up_scheduler/。纯本地、纯新增。
 *
 * 落地不新增表：跟进任务用现有 CrmActivity(type=follow_up) 表达，最近一条到期日写入 Lead.followUpDueAt。
 * 默认只生成可编辑计划（persist=false），不自动发送、不自动建任务，避免骚扰。
 */

const DEFAULT_OFFSETS = [1, 3, 7, 14, 30];

export type FollowUpStep = {
  dayOffset: number;
  dueDate: string; // YYYY-MM-DD
  channel: "email";
  action: string;
  status: "planned";
};

export type FollowUpPlan = {
  leadId: string;
  persisted: boolean;
  steps: FollowUpStep[];
  note: string;
};

function actionForOffset(offset: number): string {
  switch (offset) {
    case 1:
      return "首封回复后第 1 天：确认客户已收到资料，补充未尽问题。";
    case 3:
      return "第 3 天：跟进报价/样品意向，了解决策流程与关键关切。";
    case 7:
      return "第 7 天：提供案例/认证/参考客户，推动进入比价或打样。";
    case 14:
      return "第 14 天：阶段性跟进，确认预算与时间表，处理异议。";
    case 30:
      return "第 30 天：沉默客户唤醒，提供新进展或限时条件（不夸大、不催促）。";
    default:
      return `第 ${offset} 天：按客户节奏跟进。`;
  }
}

function toDateString(base: Date, offsetDays: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function resolveLeadId(params: {
  tenantContext: TenantContext;
  leadId?: string;
  inquiryId?: string;
}): Promise<string> {
  const prisma = getTenantPrisma(params.tenantContext);
  if (params.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: params.leadId },
      select: { id: true, ownerUserId: true },
    });
    if (!lead) {
      throw new ApiError(404, "NOT_FOUND", "Lead not found.");
    }
    assertLeadOwnerScope(params.tenantContext, lead.ownerUserId);
    return lead.id;
  }
  if (!params.inquiryId) {
    throw new ApiError(400, "VALIDATION", "leadId or inquiryId is required.");
  }
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: params.inquiryId },
    select: { leadId: true, lead: { select: { ownerUserId: true } } },
  });
  if (!inquiry) {
    throw new ApiError(404, "NOT_FOUND", "Inquiry not found.");
  }
  assertLeadOwnerScope(params.tenantContext, inquiry.lead.ownerUserId);
  return inquiry.leadId;
}

export async function generateFollowUpPlan(params: {
  tenantContext: TenantContext;
  userId?: string;
  input: {
    leadId?: string;
    inquiryId?: string;
    offsets?: number[];
    persist?: boolean;
    startDate?: string;
  };
}): Promise<FollowUpPlan> {
  const tenantPrisma = getTenantPrisma(params.tenantContext);
  const leadId = await resolveLeadId({
    tenantContext: params.tenantContext,
    leadId: params.input.leadId,
    inquiryId: params.input.inquiryId,
  });

  const base = params.input.startDate
    ? new Date(params.input.startDate)
    : new Date();
  if (Number.isNaN(base.getTime())) {
    throw new ApiError(400, "VALIDATION", "Invalid startDate.");
  }

  const offsets = (params.input.offsets ?? DEFAULT_OFFSETS)
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);

  const steps: FollowUpStep[] = offsets.map((offset) => ({
    dayOffset: offset,
    dueDate: toDateString(base, offset),
    channel: "email",
    action: actionForOffset(offset),
    status: "planned",
  }));

  const persist = params.input.persist === true;
  if (persist && steps.length > 0) {
    // 用现有 createCrmActivity 写可编辑的 follow_up 任务（含 SALES 归属校验）。
    for (const step of steps) {
      await createCrmActivity({
        tenantContext: params.tenantContext,
        input: {
          leadId,
          type: "follow_up",
          body: `[计划跟进 ${step.dueDate}] ${step.action}`,
        },
      });
    }
    // 最近一条到期日写入 Lead.followUpDueAt（租户内更新）。
    const earliest = steps[0]!.dueDate;
    await tenantPrisma.lead.updateMany({
      where: { id: leadId },
      data: { followUpDueAt: new Date(`${earliest}T00:00:00.000Z`) },
    });
  }

  return {
    leadId,
    persisted: persist,
    steps,
    note: persist
      ? "已生成可编辑跟进任务（CrmActivity），均为计划状态，不会自动发送。"
      : "仅生成跟进计划草案；如需建任务请带 persist=true。",
  };
}
